import { useState, useEffect, useMemo, useCallback } from "react";
import ImageUploadField from "./ImageUploadField";
import WebPageBuilder from "./WebPageBuilder";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const nf = (n: number) =>
  new Intl.NumberFormat("es-PY").format(Math.round(Number(n || 0)));

const todayPY = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const firstDayOfMonth = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
};

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const normalizeEmail = (s: string | null | undefined) =>
  (s || "").trim().toLowerCase();

const normalizeRole = (s: string | null | undefined) => {
  const r = (s || "").trim().toLowerCase();

  if (["admin", "administrador"].includes(r)) return "admin";
  if (["provider", "proveedor"].includes(r)) return "provider";
  if (["seller", "vendedor"].includes(r)) return "seller";
  if (["despachante", "dispatcher"].includes(r)) return "despachante";
  if (["delivery", "repartidor"].includes(r)) return "delivery";

  return r;
};

const parsePrivateEmails = (value: string | null | undefined) =>
  (value || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

type Tab = "general" | "favoritos" | "privados";
type ViewMode = "grid" | "compact";
type SortMode =
  | "recientes"
  | "mas_vendidos"
  | "mas_entregados"
  | "mayor_facturacion"
  | "mayor_ganancia"
  | "stock_bajo";

interface Product {
  id: string;
  title: string;
  sku: string | null;
  provider_price_gs: number | null;
  suggested_price_gs: number | null;
  real_cost_gs: number | null;
  stock: number | null;
  real_stock: number | null;
  image_url: string | null;
  image_url_2: string | null;
  image_url_3: string | null;
  description: string | null;
  provider_email: string | null;
  private_to_emails: string | null;
  is_private: boolean | null;
  is_private_stock?: boolean | null;
  created_at?: string | null;
  warehouse_city: string | null;
  warranty_info: string | null;
  additional_resources: string | null;
}

interface DeliveryStock {
  id: string;
  delivery_email: string;
  product_id: string;
  quantity: number;
}

interface DeliveryStockMovement {
  id: string;
  delivery_email: string;
  product_id: string;
  quantity_change: number;
  reason: string;
  order_id: string | null;
  created_at: string;
}

interface ProductMetrics {
  product_id: string;
  sku: string;
  sold_count: number;
  delivered_count: number;
  cancelled_count: number;
  returned_count: number;
  no_answer_count: number;
  billed_count: number;
  gross_revenue_gs: number;
  real_revenue_gs: number;
  product_cost_gs: number;
  gross_profit_gs: number;
}

interface AdSpend {
  id: string;
  user_email: string;
  provider_email: string | null;
  product_id: string | null;
  spend_date: string;
  amount_gs: number;
  note: string | null;
  created_at?: string | null;
}

const emptyMetrics: ProductMetrics = {
  product_id: "",
  sku: "",
  sold_count: 0,
  delivered_count: 0,
  cancelled_count: 0,
  returned_count: 0,
  no_answer_count: 0,
  billed_count: 0,
  gross_revenue_gs: 0,
  real_revenue_gs: 0,
  product_cost_gs: 0,
  gross_profit_gs: 0,
};

const emptyProduct: Omit<Product, "id"> = {
  title: "",
  sku: "",
  provider_price_gs: 0,
  suggested_price_gs: 0,
  real_cost_gs: 0,
  stock: 0,
  real_stock: 0,
  image_url: "",
  image_url_2: "",
  image_url_3: "",
  description: "",
  provider_email: "",
  private_to_emails: "",
  is_private: false,
  is_private_stock: false,
  warehouse_city: "",
  warranty_info: "",
  additional_resources: "",
};

const isPrivateProduct = (p: Product) =>
  Boolean(p.is_private_stock ?? p.is_private);

const canUserSeeProduct = (
  p: Product,
  role: string,
  myEmail: string,
  deliveryStocks: DeliveryStock[] = []
) => {
  const userEmail = normalizeEmail(myEmail);
  const providerEmail = normalizeEmail(p.provider_email);
  const privateEmails = parsePrivateEmails(p.private_to_emails);
  const isPrivate = isPrivateProduct(p);

  if (!userEmail || !role) return false;
  if (role === "admin") return true;
  if (role === "provider") return providerEmail === userEmail;
  if (role === "delivery") {
    return deliveryStocks.some(
      (ds) =>
        ds.delivery_email === userEmail &&
        ds.product_id === p.id &&
        ds.quantity > 0
    );
  }
  if (["seller", "despachante"].includes(role)) {
    if (!isPrivate) return true;
    return privateEmails.includes(userEmail);
  }
  return false;
};

const statusNorm = (s: string | null | undefined) => norm(String(s || ""));

const isDeliveredStatus = (s: string | null | undefined) => {
  const v = statusNorm(s);
  return [
    "entregado","entregada","delivered","delivery_ok",
    "completado","completada","encomienda entregada","encomienda_entregada",
  ].includes(v);
};

const isCancelledStatus = (s: string | null | undefined) => {
  const v = statusNorm(s);
  return ["cancelado", "cancelada", "cancelled", "canceled"].includes(v);
};

const isReturnedStatus = (s: string | null | undefined) => {
  const v = statusNorm(s);
  return ["devuelto","devuelta","returned","devolucion","devolucion total"].includes(v);
};

const isNoAnswerStatus = (s: string | null | undefined) => {
  const v = statusNorm(s);
  return ["no contesta","no_contesta","no answer","no_answer","sin respuesta"].includes(v);
};

const isBilledStatus = (s: string | null | undefined) => {
  const v = statusNorm(s);
  return ["facturado", "facturada", "billed", "invoiced"].includes(v);
};

const getOrderValue = (order: any, keys: string[]) => {
  for (const key of keys) {
    if (order?.[key] !== undefined && order?.[key] !== null && String(order?.[key]).trim() !== "") {
      return order[key];
    }
  }
  return null;
};

const getOrderSku = (order: any) =>
  String(getOrderValue(order, ["sku","product_sku","producto_sku","productSku","codigo","codigo_producto","product_code"]) || "").trim();

const getOrderProductId = (order: any) =>
  String(getOrderValue(order, ["product_id","producto_id","productId","product"]) || "").trim();

const getOrderStatus = (order: any) =>
  String(getOrderValue(order, ["estado_1","status","order_status","estado","estado_pedido","delivery_status","shipping_status"]) || "").trim();

const getOrderProviderEmail = (order: any) =>
  normalizeEmail(getOrderValue(order, ["provider_email","proveedor_email","supplier_email","email_proveedor"]));

const getOrderSellerEmail = (order: any) =>
  normalizeEmail(getOrderValue(order, ["seller_email","vendedor_email","email_vendedor","created_by_email","user_email"]));

const getOrderQuantity = (order: any) =>
  Number(getOrderValue(order, ["pack_qty","quantity","qty","cantidad","units","unidades"]) || 1);

const getOrderAmount = (order: any, fallbackPrice: number) =>
  Number(getOrderValue(order, ["total_gs","total_amount_gs","amount_gs","total","monto_total","precio_total","price_gs","precio"]) || fallbackPrice || 0);

// ─── Galería de imágenes ───────────────────────────────────────────────────────
const ProductImageGallery = ({
  images, title, onViewFullscreen, currentIndex = 0, onIndexChange,
}: {
  images: string[];
  title: string;
  onViewFullscreen: (url: string) => void;
  currentIndex: number;
  onIndexChange: (index: number) => void;
}) => {
  const [isHovered, setIsHovered] = useState(false);

  if (!images.length) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center text-white/50">
          <div className="text-4xl mb-2">📷</div>
          <div className="text-[10px]">Sin imagen</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full group overflow-hidden"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="w-full h-full flex items-center justify-center cursor-pointer bg-gradient-to-br from-gray-800 to-gray-900"
        onClick={() => onViewFullscreen(images[currentIndex])}
      >
        <img
          src={images[currentIndex]}
          alt={title}
          className="w-full h-full object-contain object-center transition-transform duration-300 group-hover:scale-105 select-none"
          loading="lazy"
        />
      </div>
      {images.length > 1 && (
        <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm text-white text-[10px] px-2 py-1 rounded-full font-mono">
          {currentIndex + 1} / {images.length}
        </div>
      )}
      {images.length > 1 && isHovered && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); onIndexChange((currentIndex - 1 + images.length) % images.length); }}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-all opacity-0 group-hover:opacity-100"
          >◀</button>
          <button
            onClick={(e) => { e.stopPropagation(); onIndexChange((currentIndex + 1) % images.length); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-all opacity-0 group-hover:opacity-100"
          >▶</button>
        </>
      )}
    </div>
  );
};

// ─── Modal fullscreen imagen ───────────────────────────────────────────────────
const ImageFullscreenModal = ({
  images, initialIndex, title, onClose,
}: {
  images: string[];
  initialIndex: number;
  title: string;
  onClose: () => void;
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
      else if (e.key === "ArrowRight") setCurrentIndex((prev) => (prev + 1) % images.length);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [images.length, onClose]);

  return createPortal(
    <div className="fixed inset-0 bg-black/95 z-[9999] flex items-center justify-center" onClick={onClose}>
      <div className="relative w-full h-full flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm text-white flex items-center justify-center hover:bg-white/20 transition-all">✕</button>
        <div className="absolute top-4 left-4 z-20 text-white bg-black/50 backdrop-blur-sm px-4 py-2 rounded-lg">
          <h3 className="text-sm font-bold">{title}</h3>
          <p className="text-xs opacity-75">{currentIndex + 1} / {images.length}</p>
        </div>
        <div className="relative w-full h-full flex items-center justify-center p-8">
          <img src={images[currentIndex]} alt={`${title} - ${currentIndex + 1}`} className="max-w-full max-h-[85vh] object-contain" />
        </div>
        {images.length > 1 && (
          <>
            <button onClick={() => setCurrentIndex((prev) => (prev - 1 + images.length) % images.length)} className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm text-white flex items-center justify-center hover:bg-white/20 transition-all text-2xl">◀</button>
            <button onClick={() => setCurrentIndex((prev) => (prev + 1) % images.length)} className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm text-white flex items-center justify-center hover:bg-white/20 transition-all text-2xl">▶</button>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 bg-black/50 backdrop-blur-sm px-3 py-2 rounded-full">
              {images.map((img, idx) => (
                <div key={idx} onClick={() => setCurrentIndex(idx)} className={`w-12 h-12 rounded-lg overflow-hidden cursor-pointer transition-all ${idx === currentIndex ? "ring-2 ring-white scale-110" : "opacity-50 hover:opacity-100"}`}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
            <a href={images[currentIndex]} download target="_blank" rel="noopener noreferrer" className="absolute bottom-4 right-4 z-20 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm text-white flex items-center justify-center hover:bg-white/20 transition-all">⬇</a>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};

// ─── Modal asignación de stock a delivery ─────────────────────────────────────
const AssignDeliveryStockModal = ({
  product, deliveryStocks, deliveries, onClose, onSave, onRefresh,
}: {
  product: Product;
  deliveryStocks: DeliveryStock[];
  deliveries: { email: string; name: string }[];
  onClose: () => void;
  onSave: (assignments: { delivery_email: string; quantity: number }[]) => void;
  onRefresh: () => Promise<void>;
}) => {
  const [assignments, setAssignments] = useState<{ delivery_email: string; quantity: number }[]>(() =>
    deliveries.map((d) => ({
      delivery_email: d.email,
      quantity: deliveryStocks.find((ds) => ds.delivery_email === d.email)?.quantity || 0,
    }))
  );
  const [activeSubTab, setActiveSubTab] = useState<"asignar" | "movimientos">("asignar");
  const [localMovements, setLocalMovements] = useState<DeliveryStockMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);

  const loadMovements = useCallback(async () => {
    if (!product.id) return;
    setLoadingMovements(true);
    const { data, error } = await supabase
      .from("delivery_stock_movements")
      .select("*")
      .eq("product_id", product.id)
      .order("created_at", { ascending: false });
    setLoadingMovements(false);
    if (error) {
      console.error("Error cargando movimientos:", error);
      toast.error("Error al cargar movimientos");
      return;
    }
    setLocalMovements(data || []);
  }, [product.id]);

  useEffect(() => {
    loadMovements();
  }, [loadMovements]);

  useEffect(() => {
    if (activeSubTab === "movimientos") {
      loadMovements();
    }
  }, [activeSubTab, loadMovements]);

  const updateQuantity = (email: string, quantity: number) => {
    setAssignments((prev) =>
      prev.map((a) => (a.delivery_email === email ? { ...a, quantity: Math.max(0, quantity) } : a))
    );
  };

  const handleRefresh = async () => {
    await onRefresh();
    await loadMovements();
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/80 z-[10001] flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative bg-gradient-to-br from-[#0a0d14] via-[#0f1320] to-[#05070b] rounded-2xl max-w-2xl w-full shadow-2xl border border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-white/10">
          <h3 className="text-xl font-bold text-white">📦 Asignar stock a deliveries</h3>
          <p className="text-sm text-white/50 mt-1">Producto: {product.title} (SKU: {product.sku})</p>
        </div>

        <div className="flex border-b border-white/10 px-5">
          <button
            onClick={() => setActiveSubTab("asignar")}
            className={`py-2 px-4 text-sm font-medium transition-all ${activeSubTab === "asignar" ? "text-primary border-b-2 border-primary" : "text-white/50 hover:text-white/80"}`}
          >
            📦 Asignar stock
          </button>
          <button
            onClick={() => setActiveSubTab("movimientos")}
            className={`py-2 px-4 text-sm font-medium transition-all ${activeSubTab === "movimientos" ? "text-primary border-b-2 border-primary" : "text-white/50 hover:text-white/80"}`}
          >
            📋 Historial ({localMovements.length})
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[500px] overflow-y-auto">
          {activeSubTab === "asignar" && (
            <>
              {deliveries.length === 0 ? (
                <div className="text-center py-8 text-white/40">No hay deliveries registrados en el sistema</div>
              ) : (
                deliveries.map((delivery) => {
                  const assignment = assignments.find((a) => a.delivery_email === delivery.email);
                  return (
                    <div key={delivery.email} className="flex items-center justify-between gap-4 p-3 bg-white/5 rounded-xl border border-white/10">
                      <div className="flex-1">
                        <div className="font-medium text-white">{delivery.name}</div>
                        <div className="text-xs text-white/40">{delivery.email}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateQuantity(delivery.email, (assignment?.quantity || 0) - 1)} className="w-8 h-8 rounded-full bg-white/10 text-white/80 hover:bg-white/20 transition-all">-</button>
                        <input
                          type="number"
                          className="w-20 text-center py-2 rounded-lg bg-white/10 border border-white/20 text-white font-mono focus:outline-none focus:border-primary"
                          value={assignment?.quantity || 0}
                          onChange={(e) => updateQuantity(delivery.email, parseInt(e.target.value) || 0)}
                        />
                        <button onClick={() => updateQuantity(delivery.email, (assignment?.quantity || 0) + 1)} className="w-8 h-8 rounded-full bg-white/10 text-white/80 hover:bg-white/20 transition-all">+</button>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {activeSubTab === "movimientos" && (
            <div className="space-y-2">
              <button onClick={handleRefresh} className="w-full mb-2 py-1 text-xs rounded-lg bg-white/10 text-white/60 hover:bg-white/20 transition-all flex items-center justify-center gap-2">
                <span>🔄</span> Refrescar movimientos
              </button>
              {loadingMovements ? (
                <div className="text-center py-8 text-white/40">
                  <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                  <p className="mt-2">Cargando movimientos...</p>
                </div>
              ) : localMovements.length === 0 ? (
                <div className="text-center py-8 text-white/40">No hay movimientos registrados aún</div>
              ) : (
                localMovements.map((mov) => (
                  <div key={mov.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-sm ${mov.quantity_change > 0 ? "text-green-400" : "text-red-400"}`}>
                          {mov.quantity_change > 0 ? `+${mov.quantity_change}` : mov.quantity_change}
                        </span>
                        <span className="text-sm text-white/70">{mov.reason}</span>
                      </div>
                      <div className="text-xs text-white/40 mt-1">{mov.delivery_email}</div>
                      <div className="text-xs text-white/30 mt-0.5">{new Date(mov.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-white/10 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl bg-white/10 text-white/80 font-medium hover:bg-white/20 transition-all">Cerrar</button>
          {activeSubTab === "asignar" && (
            <button onClick={() => onSave(assignments)} className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 transition-all">
              Guardar asignación
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Modal detalles del producto ──────────────────────────────────────────────
const ProductDetailModal = ({
  product, metrics, productAdSpend, onClose, onEdit, onDelete,
  canEdit, canSeeRealStock, canSeeRealCost, onLoadProduct, getImages, nf,
  providerName, providerPhone, isDelivery, deliveryStockQuantity,
  showDeliveryStock, deliveryStocksList, onRefreshDeliveryStock, onOpenAssignStock,
}: {
  product: Product;
  metrics: ProductMetrics;
  productAdSpend: number;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
  canSeeRealStock: boolean;
  canSeeRealCost: boolean;
  onLoadProduct?: (sku: string) => void;
  getImages: (p: Product) => string[];
  nf: (n: number) => string;
  providerName?: string;
  providerPhone?: string;
  isDelivery?: boolean;
  deliveryStockQuantity?: number;
  showDeliveryStock?: boolean;
  deliveryStocksList?: { delivery_email: string; quantity: number; delivery_name: string }[];
  onRefreshDeliveryStock?: () => Promise<void>;
  onOpenAssignStock?: () => void;
}) => {
  const [activeTab, setActiveTab] = useState<"detalles" | "garantias" | "recursos" | "metricas" | "delivery_stock">("detalles");
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [metricsFromDate, setMetricsFromDate] = useState(firstDayOfMonth());
  const [metricsToDate, setMetricsToDate] = useState(todayPY());
  const [customMetrics, setCustomMetrics] = useState<ProductMetrics | null>(null);
  const [customMetricsLoading, setCustomMetricsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const images = getImages(product);
  const stockCritical = isDelivery
    ? (deliveryStockQuantity || 0) <= 3
    : Number(product.stock || 0) <= 3;
  const gainPerUnit = Number(product.suggested_price_gs || 0) - Number(product.real_cost_gs || 0);
  const netProfit = (customMetrics?.gross_profit_gs || metrics.gross_profit_gs) - productAdSpend;

  const handleRefreshDeliveryStock = async () => {
    setRefreshing(true);
    await onRefreshDeliveryStock?.();
    setRefreshing(false);
  };

  const loadMetricsByDate = useCallback(async () => {
    if (!metricsFromDate || !metricsToDate) return;
    setCustomMetricsLoading(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .gte("created_at", `${metricsFromDate}T00:00:00`)
        .lte("created_at", `${metricsToDate}T23:59:59`);
      if (error) throw error;

      let m = { ...emptyMetrics, product_id: product.id, sku: product.sku || "" };
      for (const order of data || []) {
        const orderSku = getOrderSku(order);
        if (orderSku !== product.sku) continue;
        const qty = getOrderQuantity(order);
        const unitFallbackPrice = Number(product.provider_price_gs || 0) * qty;
        const saleAmount = getOrderAmount(order, unitFallbackPrice);
        const realCost = Number(product.real_cost_gs || 0) * qty;
        const status = getOrderStatus(order);
        const delivered = isDeliveredStatus(status);
        const cancelled = isCancelledStatus(status);
        const returned = isReturnedStatus(status);
        const noAnswer = isNoAnswerStatus(status);
        const billed = isBilledStatus(status);
        m.sold_count += qty;
        if (delivered) m.delivered_count += qty;
        if (cancelled) m.cancelled_count += qty;
        if (returned) m.returned_count += qty;
        if (noAnswer) m.no_answer_count += qty;
        if (billed) m.billed_count += qty;
        m.gross_revenue_gs += saleAmount;
        if (delivered) {
          m.real_revenue_gs += saleAmount;
          m.product_cost_gs += realCost;
          m.gross_profit_gs += saleAmount - realCost;
        }
      }
      setCustomMetrics(m);
    } catch (error) {
      console.error("Error cargando métricas por fecha:", error);
      toast.error("No se pudieron cargar las métricas");
    } finally {
      setCustomMetricsLoading(false);
    }
  }, [product, metricsFromDate, metricsToDate]);

  useEffect(() => {
    if (activeTab === "metricas") loadMetricsByDate();
  }, [activeTab, metricsFromDate, metricsToDate, loadMetricsByDate]);

  const displayMetrics = customMetrics || metrics;

  const setToday = () => { setMetricsFromDate(todayPY()); setMetricsToDate(todayPY()); };
  const setThisMonth = () => { setMetricsFromDate(firstDayOfMonth()); setMetricsToDate(todayPY()); };
  const setLastMonth = () => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    setMetricsFromDate(`${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-01`);
    setMetricsToDate(`${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, "0")}-${lastMonthEnd.getDate()}`);
  };

  const requestSample = () => {
    if (providerPhone) {
      const message = encodeURIComponent(`Hola! Me gustaría solicitar una MUESTRA del producto: ${product.title} (SKU: ${product.sku})`);
      window.open(`https://wa.me/${providerPhone.replace(/[^0-9]/g, "")}?text=${message}`, "_blank");
    } else {
      toast.info("No hay número de teléfono del proveedor para solicitar muestra");
    }
  };

  const viewReport = () => {
    toast.info(`Informe de ventas para ${product.title}: ${displayMetrics.sold_count} vendidos, ${displayMetrics.delivered_count} entregados`);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/80 z-[10000] flex items-center justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="relative bg-gradient-to-br from-[#0a0d14] via-[#0f1320] to-[#05070b] rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-white/10" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-[#0f1320]/95 backdrop-blur-md border-b border-white/10 p-5 z-10">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-white uppercase">{product.title}</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm text-white/50 font-mono">SKU: {product.sku || "—"}</span>
                <div className="flex gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/70">Hogar</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/70">Limpieza</span>
                </div>
              </div>
              <div className="text-xs text-white/40 mt-1">Tipo de producto: Simple</div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/80 flex items-center justify-center transition-all">✕</button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Imagen */}
          <div className="bg-[#1a1f2e] rounded-xl p-6 flex items-center justify-center min-h-[280px] border border-white/10">
            {images.length > 0 ? (
              <img src={images[currentImageIndex]} alt={product.title} className="max-h-[200px] object-contain cursor-pointer" />
            ) : (
              <div className="text-center text-white/40">
                <div className="text-6xl mb-2">📷</div>
                <div className="text-sm">Sin imagen del producto</div>
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex justify-center gap-2">
              {images.map((img, idx) => (
                <div key={idx} onClick={() => setCurrentImageIndex(idx)} className={`w-16 h-16 rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${idx === currentImageIndex ? "border-primary" : "border-white/20 hover:border-white/40"}`}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}

          {/* Disponibilidad y Stock */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="text-xs text-white/50 uppercase mb-1">Producto disponible en:</div>
              <div className="font-medium text-white">{product.warehouse_city || "Caaguazú / Asunción"}</div>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-xs text-white/50 uppercase mb-1">Stock disponible</div>
                  <div className={`font-bold text-xl ${stockCritical ? "text-red-400" : "text-white"}`}>
                    {isDelivery ? (deliveryStockQuantity || 0) : (product.stock || 0)} unidades
                  </div>
                </div>
                {canSeeRealStock && !isDelivery && (
                  <div className="text-right">
                    <div className="text-xs text-white/50 uppercase mb-1">Stock real / Privado</div>
                    <div className="font-bold text-xl text-white">{product.real_stock || 0} unidades</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Precios */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="text-xs text-white/50 uppercase mb-1">Precio del proveedor</div>
              <div className="text-2xl font-bold text-white">{nf(Number(product.provider_price_gs || 0))} Gs</div>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="text-xs text-white/50 uppercase mb-1">Precio sugerido</div>
              <div className="text-2xl font-bold text-primary">{nf(Number(product.suggested_price_gs || 0))} Gs</div>
              <div className="text-xs text-white/40 mt-1">*Precio sugerido para vender</div>
            </div>
          </div>

          {/* Botones de acción */}
          <div className="flex flex-wrap gap-3">
            <button onClick={requestSample} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2">
              <span>🎁</span> Solicitar muestra
            </button>
            <button onClick={viewReport} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2">
              <span>📊</span> Ver informe
            </button>
          </div>

          {/* Vendido por */}
          <div className="border-t border-white/10 pt-4">
            <div className="text-xs text-white/50 uppercase mb-2">Vendido por:</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-white uppercase">{providerName || product.provider_email || "PROVEEDOR"}</div>
                <div className="text-sm text-white/40">Bodegas: {product.warehouse_city || "CAAGUAZÚ, ASUNCIÓN"}</div>
              </div>
              {providerPhone && (
                <a href={`https://wa.me/${providerPhone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" className="text-green-500 hover:text-green-400 text-sm flex items-center gap-1">
                  <span>💬</span> Contactar
                </a>
              )}
            </div>
          </div>

          {/* TABS */}
          <div className="border-b border-white/10">
            <div className="flex gap-6 overflow-x-auto">
              {(["detalles", "garantias", "recursos", "metricas"] as const).map((t) => (
                <button key={t} onClick={() => setActiveTab(t)} className={`pb-3 text-sm font-medium transition-all whitespace-nowrap ${activeTab === t ? "text-primary border-b-2 border-primary" : "text-white/50 hover:text-white/80"}`}>
                  {t === "detalles" && "Detalles"}
                  {t === "garantias" && "Garantías"}
                  {t === "recursos" && "Recursos adicionales"}
                  {t === "metricas" && "📊 Métricas"}
                </button>
              ))}
              {showDeliveryStock && (
                <button onClick={() => setActiveTab("delivery_stock")} className={`pb-3 text-sm font-medium transition-all whitespace-nowrap ${activeTab === "delivery_stock" ? "text-primary border-b-2 border-primary" : "text-white/50 hover:text-white/80"}`}>
                  🚚 Stock en deliveries
                </button>
              )}
            </div>
          </div>

          {/* CONTENIDO DE TABS */}
          <div className="min-h-[200px]">
            {activeTab === "detalles" && (
              <div className="prose prose-sm prose-invert max-w-none">
                <p className="text-white/80 whitespace-pre-wrap leading-relaxed">
                  {product.description || "✨ Descripción no cargada por el proveedor."}
                </p>
                {canSeeRealCost && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <h4 className="text-sm font-semibold text-white mb-2">Información comercial</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-white/50">Costo real:</span>
                        <span className="font-medium text-white">{nf(Number(product.real_cost_gs || 0))} Gs</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/50">Ganancia por unidad (según sugerido):</span>
                        <span className="font-medium text-green-400">{nf(gainPerUnit)} Gs</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "garantias" && (
              <div className="prose prose-sm prose-invert max-w-none">
                <p className="text-white/80 whitespace-pre-wrap">
                  {product.warranty_info || "El proveedor no ha cargado condiciones de garantía aún."}
                </p>
              </div>
            )}

            {activeTab === "recursos" && (
              <div className="prose prose-sm prose-invert max-w-none">
                <div className="text-white/80 whitespace-pre-wrap">
                  {product.additional_resources ? (
                    <div dangerouslySetInnerHTML={{ __html: product.additional_resources.replace(/\n/g, "<br/>") }} />
                  ) : (
                    "El proveedor no ha cargado recursos adicionales aún."
                  )}
                </div>
              </div>
            )}

            {activeTab === "metricas" && (
              <div className="space-y-4">
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-xs text-white/50 uppercase mb-2">Filtrar por fecha</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                    <button onClick={setToday} className="text-xs py-1.5 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 transition-all">Hoy</button>
                    <button onClick={setThisMonth} className="text-xs py-1.5 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 transition-all">Este mes</button>
                    <button onClick={setLastMonth} className="text-xs py-1.5 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 transition-all">Mes pasado</button>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-white/50">Desde</label>
                      <input type="date" className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:border-primary" value={metricsFromDate} onChange={(e) => setMetricsFromDate(e.target.value)} />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-white/50">Hasta</label>
                      <input type="date" className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:border-primary" value={metricsToDate} onChange={(e) => setMetricsToDate(e.target.value)} />
                    </div>
                  </div>
                </div>
                {customMetricsLoading ? (
                  <div className="text-center py-8">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                    <p className="text-sm text-white/50 mt-2">Cargando métricas...</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        { val: displayMetrics.sold_count, label: "Vendidos", color: "text-white" },
                        { val: displayMetrics.delivered_count, label: "Entregados", color: "text-green-400" },
                        { val: displayMetrics.cancelled_count, label: "Cancelados", color: "text-red-400" },
                        { val: displayMetrics.returned_count, label: "Devueltos", color: "text-orange-400" },
                        { val: displayMetrics.no_answer_count, label: "Sin respuesta", color: "text-yellow-400" },
                        { val: displayMetrics.billed_count, label: "Facturados", color: "text-blue-400" },
                      ].map(({ val, label, color }) => (
                        <div key={label} className="bg-white/5 rounded-xl p-3 text-center border border-white/10">
                          <div className={`text-2xl font-black ${color}`}>{val}</div>
                          <div className="text-[10px] text-white/50">{label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="bg-white/5 rounded-xl p-4 space-y-2 border border-white/10">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">Facturación real:</span>
                        <span className="font-bold text-white">{nf(displayMetrics.real_revenue_gs)} Gs</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">Ganancia bruta:</span>
                        <span className="font-bold text-green-400">{nf(displayMetrics.gross_profit_gs)} Gs</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">Gasto publicitario:</span>
                        <span className="font-bold text-orange-400">{nf(productAdSpend)} Gs</span>
                      </div>
                      <div className="flex justify-between text-sm pt-2 border-t border-white/10">
                        <span className="text-white/70 font-medium">Ganancia neta:</span>
                        <span className={`font-bold text-lg ${netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{nf(netProfit)} Gs</span>
                      </div>
                    </div>
                    <div className="text-xs text-white/40 text-center">📅 Período: {metricsFromDate} al {metricsToDate}</div>
                  </>
                )}
              </div>
            )}

            {activeTab === "delivery_stock" && showDeliveryStock && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <button onClick={onOpenAssignStock} className="px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium transition-all flex items-center gap-2 border border-emerald-500/30">
                    <span>📦</span> Asignar / Modificar stock
                  </button>
                  <button
                    onClick={handleRefreshDeliveryStock}
                    disabled={refreshing}
                    className="px-4 py-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {refreshing ? (
                      <><span className="inline-block animate-spin">🔄</span> Recargando...</>
                    ) : (
                      <><span>🔄</span> Recargar</>
                    )}
                  </button>
                </div>

                {deliveryStocksList && deliveryStocksList.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-white/5 border-b border-white/10">
                        <tr>
                          <th className="text-left py-3 px-3 text-white/60 font-medium">Delivery</th>
                          <th className="text-center py-3 px-3 text-white/60 font-medium">Stock actual</th>
                          <th className="text-right py-3 px-3 text-white/60 font-medium">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deliveryStocksList.map((ds) => (
                          <tr key={ds.delivery_email} className="border-b border-white/5 hover:bg-white/5 transition-all">
                            <td className="py-3 px-3">
                              <div className="font-medium text-white">{ds.delivery_name}</div>
                              <div className="text-xs text-white/40">{ds.delivery_email}</div>
                            </td>
                            <td className="text-center py-3 px-3">
                              <span className={`font-bold ${ds.quantity <= 3 ? "text-red-400" : "text-white"}`}>{ds.quantity}</span>
                            </td>
                            <td className="text-right py-3 px-3">
                              {ds.quantity <= 3 ? (
                                <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400">⚠️ Stock bajo</span>
                              ) : ds.quantity > 0 ? (
                                <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400">✅ Con stock</span>
                              ) : (
                                <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/50">❌ Sin stock</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-white/40">
                    <div className="text-4xl mb-3">🚚</div>
                    <p>No hay deliveries con stock asignado</p>
                    <p className="text-xs mt-1">Usá el botón "Asignar / Modificar stock" para asignar</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Botones edición/eliminación */}
          {canEdit && (
            <div className="flex gap-3 pt-4 border-t border-white/10">
              <button onClick={onEdit} className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-2 px-4 rounded-lg transition-all border border-white/10">
                ✏️ Editar producto
              </button>
              <button
                onClick={() => {
                  if (confirm(`¿Eliminar "${product.title}" permanentemente?`)) { onDelete(); onClose(); }
                }}
                className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 font-medium py-2 px-4 rounded-lg transition-all border border-red-500/30"
              >
                🗑️ Eliminar producto
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Vista principal ───────────────────────────────────────────────────────────
export default function ProductsView({ onLoadProduct }: { onLoadProduct?: (sku: string) => void }) {
  const { profile } = useAuth();
  const role = normalizeRole(profile?.role);
  const myEmail = normalizeEmail(profile?.email);
  const [mainView, setMainView] = useState<"productos" | "paginas">("productos");

  const [products, setProducts] = useState<Product[]>([]);
  const [profiles, setProfiles] = useState<{ email: string; name: string | null; logo_url: string | null; phone: string | null }[]>([]);
  const [deliveryStocks, setDeliveryStocks] = useState<DeliveryStock[]>([]);
  const [deliveryUsers, setDeliveryUsers] = useState<{ email: string; name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("general");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("recientes");
  const [fromDate, setFromDate] = useState(firstDayOfMonth());
  const [toDate, setToDate] = useState(todayPY());
  const [selectedProvider, setSelectedProvider] = useState<string>("todos");
  const [selectedProductId, setSelectedProductId] = useState<string>("todos");
  const [showTopSection, setShowTopSection] = useState(false);
  const [adSpendFromDate, setAdSpendFromDate] = useState(todayPY());
  const [adSpendToDate, setAdSpendToDate] = useState(todayPY());
  const [adAmount, setAdAmount] = useState<number>(0);
  const [adNote, setAdNote] = useState<string>("");
  const [adTargetType, setAdTargetType] = useState<"global" | "producto">("global");
  const [adTargetProductId, setAdTargetProductId] = useState<string>("");
  const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());
  const [editProduct, setEditProduct] = useState<(Product & { isNew?: boolean }) | null>(null);
  const [selectedProductDetail, setSelectedProductDetail] = useState<Product | null>(null);
  const [imgIndex, setImgIndex] = useState<Record<string, number>>({});
  const [viewingImage, setViewingImage] = useState<{ url: string; title: string; index?: number } | null>(null);
  const [metricsByProduct, setMetricsByProduct] = useState<Record<string, ProductMetrics>>({});
  const [adSpends, setAdSpends] = useState<AdSpend[]>([]);
  const [syncingStock, setSyncingStock] = useState(false);
  const [showAssignStockModal, setShowAssignStockModal] = useState<Product | null>(null);
  const [deliveryStocksForEdit, setDeliveryStocksForEdit] = useState<{ delivery_email: string; quantity: number }[]>([]);

  const canSeeRealStock = ["admin", "provider", "despachante"].includes(role);
  const canEdit = ["admin", "provider", "despachante"].includes(role);
  const canSeeRealCost = ["admin", "provider"].includes(role);
  const canLoadOrder = ["seller", "despachante", "delivery"].includes(role);
  const canSeeMoney = ["admin", "provider", "seller", "despachante"].includes(role);
  const isDelivery = role === "delivery";
  const canAssignStock = ["admin", "provider"].includes(role);
  const canSeeDeliveryStock = ["admin", "provider"].includes(role);

  const loadDeliveryUsers = useCallback(async () => {
    if (!canAssignStock) return;
    const { data, error } = await supabase.from("profiles").select("email, name").eq("role", "delivery");
    if (!error && data) {
      setDeliveryUsers(data.map((d) => ({ email: d.email, name: d.name || d.email })));
    }
  }, [canAssignStock]);

  const loadDeliveryStocks = useCallback(async (): Promise<void> => {
    const { data, error } = await supabase.from("delivery_stock").select("*");
    if (!error && data) {
      setDeliveryStocks(data as DeliveryStock[]);
    }
  }, []);

  const saveDeliveryStockAssignments = async (
    productId: string,
    assignments: { delivery_email: string; quantity: number }[]
  ) => {
    for (const assignment of assignments) {
      const existing = deliveryStocks.find(
        (ds) => ds.delivery_email === assignment.delivery_email && ds.product_id === productId
      );
      const oldQuantity = existing?.quantity || 0;
      const quantityChange = assignment.quantity - oldQuantity;

      if (existing) {
        if (assignment.quantity > 0) {
          await supabase.from("delivery_stock").update({ quantity: assignment.quantity }).eq("id", existing.id);
        } else {
          await supabase.from("delivery_stock").delete().eq("id", existing.id);
        }
      } else if (assignment.quantity > 0) {
        await supabase.from("delivery_stock").insert({
          delivery_email: assignment.delivery_email,
          product_id: productId,
          quantity: assignment.quantity,
        });
      }

      if (quantityChange !== 0) {
        await supabase.from("delivery_stock_movements").insert({
          delivery_email: assignment.delivery_email,
          product_id: productId,
          quantity_change: quantityChange,
          reason: quantityChange > 0
            ? "➕ Asignación de stock por admin/proveedor"
            : "➖ Reducción de stock por admin/proveedor",
          order_id: null,
        });
      }
    }

    await loadDeliveryStocks();
    toast.success("Stock asignado correctamente");
    setShowAssignStockModal(null);
  };

  const loadFavorites = useCallback(async () => {
    if (!myEmail) return;
    try {
      const { data, error } = await supabase.from("user_favorites").select("product_id").eq("user_email", myEmail);
      if (error) throw error;
      setUserFavorites(new Set(data?.map((f) => f.product_id) || []));
    } catch (error) {
      console.error("Error cargando favoritos:", error);
    }
  }, [myEmail]);

  const toggleFavorite = async (productId: string) => {
    if (!myEmail) { toast.error("Debes iniciar sesión"); return; }
    const isFavorite = userFavorites.has(productId);
    try {
      if (isFavorite) {
        const { error } = await supabase.from("user_favorites").delete().eq("user_email", myEmail).eq("product_id", productId);
        if (error) throw error;
        setUserFavorites((prev) => { const s = new Set(prev); s.delete(productId); return s; });
        toast.success("❌ Eliminado de tus favoritos");
      } else {
        const { error } = await supabase.from("user_favorites").insert({ user_email: myEmail, product_id: productId });
        if (error) throw error;
        setUserFavorites((prev) => new Set([...prev, productId]));
        toast.success("⭐ Agregado a tus favoritos");
      }
    } catch (error) {
      console.error("Error:", error);
      toast.error("No se pudo actualizar favorito");
    }
  };

  const load = useCallback(async () => {
    if (!role || !myEmail) { setProducts([]); setProfiles([]); setLoading(false); return; }
    setLoading(true);
    const [prodRes, profRes, stockRes] = await Promise.all([
      supabase.from("products").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("email, name, logo_url, phone"),
      supabase.from("delivery_stock").select("*"),
    ]);
    if (prodRes.error) { console.error(prodRes.error); toast.error(prodRes.error.message); setLoading(false); return; }
    if (profRes.error) { console.error(profRes.error); toast.error(profRes.error.message); setLoading(false); return; }
    const allProducts = (prodRes.data || []) as Product[];
    const deliveryStocksData = (stockRes.data || []) as DeliveryStock[];
    setDeliveryStocks(deliveryStocksData);
    const visibleProducts = allProducts.filter((p) => canUserSeeProduct(p, role, myEmail, deliveryStocksData));
    setProducts(visibleProducts);
    setProfiles(profRes.data || []);
    setLoading(false);
  }, [role, myEmail]);

  // El stock de los pedidos lo descuenta la base de datos (order_stock_ledger);
  // acá sólo se refresca la vista cuando cambia el stock de un delivery.
  useEffect(() => {
    if (!role || !myEmail) return;

    const channel = supabase
      .channel("delivery-stock-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_stock" }, () => {
        void loadDeliveryStocks();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [role, myEmail, loadDeliveryStocks]);

  useEffect(() => {
    load();
    loadFavorites();
    loadDeliveryUsers();
    loadDeliveryStocks();
  }, [load, loadFavorites, loadDeliveryUsers, loadDeliveryStocks]);

  const visibleProductIds = useMemo(() => products.map((p) => p.id), [products]);

  const loadAdSpends = useCallback(async () => {
    if (!myEmail || !adSpendFromDate || !adSpendToDate) return;
    try {
      let query = supabase.from("ad_spend").select("*").gte("spend_date", adSpendFromDate).lte("spend_date", adSpendToDate).order("spend_date", { ascending: false });
      if (role !== "admin") query = query.eq("user_email", myEmail);
      if (role === "provider") query = query.eq("provider_email", myEmail);
      if (selectedProvider !== "todos") query = query.eq("provider_email", selectedProvider);
      if (selectedProductId !== "todos") query = query.eq("product_id", selectedProductId);
      const { data, error } = await query;
      if (error) throw error;
      setAdSpends((data || []) as AdSpend[]);
    } catch (error: any) {
      console.error("Error cargando publicidad:", error);
      toast.error(error?.message || "No se pudo cargar gasto publicitario");
    }
  }, [myEmail, role, adSpendFromDate, adSpendToDate, selectedProvider, selectedProductId]);

  const loadMetrics = useCallback(async () => {
    if (!role || !myEmail || visibleProductIds.length === 0 || !fromDate || !toDate) {
      setMetricsByProduct({});
      return;
    }
    setMetricsLoading(true);
    try {
      const productMapBySku = new Map<string, Product>();
      const productMapById = new Map<string, Product>();
      products.forEach((p) => {
        if (p.sku) productMapBySku.set(String(p.sku).trim(), p);
        productMapById.set(p.id, p);
      });
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .gte("created_at", `${fromDate}T00:00:00`)
        .lte("created_at", `${toDate}T23:59:59`);
      if (error) throw error;

      const next: Record<string, ProductMetrics> = {};
      products.forEach((p) => { next[p.id] = { ...emptyMetrics, product_id: p.id, sku: p.sku || "" }; });

      (data || []).forEach((order: any) => {
        const orderSku = getOrderSku(order);
        const orderProductId = getOrderProductId(order);
        const orderProviderEmail = getOrderProviderEmail(order);
        const orderSellerEmail = getOrderSellerEmail(order);
        const product = productMapById.get(orderProductId) || productMapBySku.get(orderSku) || products.find((p) => String(p.sku || "").trim() === orderSku);
        if (!product) return;
        const productProviderEmail = normalizeEmail(product.provider_email);
        if (!canUserSeeProduct(product, role, myEmail, deliveryStocks)) return;
        if (role === "provider" && productProviderEmail !== myEmail && orderProviderEmail !== myEmail) return;
        if (role === "seller" && orderSellerEmail && orderSellerEmail !== myEmail) return;
        if (selectedProvider !== "todos" && productProviderEmail !== selectedProvider && orderProviderEmail !== selectedProvider) return;
        if (selectedProductId !== "todos" && product.id !== selectedProductId) return;

        const m = next[product.id] || { ...emptyMetrics, product_id: product.id, sku: product.sku || orderSku };
        const qty = getOrderQuantity(order);
        const unitFallbackPrice = Number(product.provider_price_gs || 0) * qty;
        const saleAmount = getOrderAmount(order, unitFallbackPrice);
        const realCost = Number(product.real_cost_gs || 0) * qty;
        const status = getOrderStatus(order);
        const billed = Boolean(order.is_billed || order.facturado || order.billed || order.invoiced || isBilledStatus(status));
        const delivered = isDeliveredStatus(status);
        const cancelled = isCancelledStatus(status);
        const returned = isReturnedStatus(status);
        const noAnswer = isNoAnswerStatus(status);

        m.sold_count += qty;
        if (delivered) m.delivered_count += qty;
        if (cancelled) m.cancelled_count += qty;
        if (returned) m.returned_count += qty;
        if (noAnswer) m.no_answer_count += qty;
        if (billed) m.billed_count += qty;
        m.gross_revenue_gs += saleAmount;
        if (delivered) { m.real_revenue_gs += saleAmount; m.product_cost_gs += realCost; m.gross_profit_gs += saleAmount - realCost; }
        next[product.id] = m;
      });
      setMetricsByProduct(next);
    } catch (error: any) {
      console.error("Error cargando métricas:", error);
      toast.error(error?.message || "No se pudieron cargar métricas.");
    } finally {
      setMetricsLoading(false);
    }
  }, [role, myEmail, visibleProductIds.length, fromDate, toDate, products, selectedProvider, selectedProductId, deliveryStocks]);

  const syncStockFromOrders = useCallback(async () => {
    if (!products.length) return;
    setSyncingStock(true);
    const toastId = toast.loading("Sincronizando stocks desde órdenes entregadas...");
    let updatedCount = 0;
    let errorCount = 0;
    for (const product of products) {
      try {
        const { data, error } = await supabase.from("orders").select("items_json, sku, pack_qty").eq("estado_1", "ENTREGADO");
        if (error) { errorCount++; continue; }
        let deliveredQty = 0;
        for (const order of data || []) {
          if (order.items_json && Array.isArray(order.items_json)) {
            for (const item of order.items_json) {
              if (item.sku === product.sku) deliveredQty += (item.qty || item.quantity || 1);
            }
          } else if (order.sku === product.sku) {
            deliveredQty += (order.pack_qty || 1);
          }
        }
        const syncedStock = Math.max(0, deliveredQty);
        if (syncedStock !== (product.stock || 0)) {
          const { error: updateError } = await supabase.from("products").update({ stock: syncedStock, real_stock: syncedStock }).eq("id", product.id);
          if (!updateError) {
            updatedCount++;
            setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, stock: syncedStock, real_stock: syncedStock } : p));
          } else {
            errorCount++;
          }
        }
      } catch { errorCount++; }
    }
    toast.dismiss(toastId);
    if (errorCount > 0) toast.warning(`✅ Sincronizados ${updatedCount} productos, ⚠️ ${errorCount} errores`);
    else toast.success(`✅ Sincronizados ${updatedCount} productos correctamente`);
    setSyncingStock(false);
  }, [products]);

  useEffect(() => { loadMetrics(); loadAdSpends(); }, [loadMetrics, loadAdSpends]);

  const profileMap = useMemo(() => {
    const m: Record<string, { name: string; logo: string; phone: string }> = {};
    profiles.forEach((p) => { m[normalizeEmail(p.email)] = { name: p.name || p.email, logo: p.logo_url || "", phone: p.phone || "" }; });
    return m;
  }, [profiles]);

  const providerOptions = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((p) => {
      const email = normalizeEmail(p.provider_email);
      if (!email) return;
      map.set(email, profileMap[email]?.name || p.provider_email || email);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [products, profileMap]);

  const productOptions = useMemo(() => {
    let list = [...products];
    if (selectedProvider !== "todos") list = list.filter((p) => normalizeEmail(p.provider_email) === selectedProvider);
    return list.sort((a, b) => a.title.localeCompare(b.title, "es"));
  }, [products, selectedProvider]);

  const getProviderInfo = useCallback((providerEmail: string | null) => {
    const email = normalizeEmail(providerEmail || "");
    const profile = profileMap[email];
    return { name: profile?.name || providerEmail || "Proveedor", phone: profile?.phone || "", logo: profile?.logo || "" };
  }, [profileMap]);

  const getDeliveryStockForProduct = useCallback(
    (productId: string) => deliveryStocks.find((ds) => ds.delivery_email === myEmail && ds.product_id === productId)?.quantity || 0,
    [deliveryStocks, myEmail]
  );

  const getDeliveryStocksForProduct = useCallback(
    (productId: string) =>
      deliveryStocks
        .filter((ds) => ds.product_id === productId)
        .map((ds) => ({
          delivery_email: ds.delivery_email,
          quantity: ds.quantity,
          delivery_name: profileMap[normalizeEmail(ds.delivery_email)]?.name || ds.delivery_email,
        }))
        .sort((a, b) => b.quantity - a.quantity),
    [deliveryStocks, profileMap]
  );

  const getProductAdSpend = useCallback(
    (productId: string) => adSpends.filter((s) => s.product_id === productId).reduce((sum, s) => sum + Number(s.amount_gs || 0), 0),
    [adSpends]
  );

  const generalAdSpend = useMemo(() => adSpends.filter((s) => !s.product_id).reduce((sum, s) => sum + Number(s.amount_gs || 0), 0), [adSpends]);
  const totalProductAdSpend = useMemo(() => adSpends.filter((s) => s.product_id).reduce((sum, s) => sum + Number(s.amount_gs || 0), 0), [adSpends]);

  const filtered = useMemo(() => {
    let list = [...products];
    if (tab === "favoritos") list = list.filter((p) => userFavorites.has(p.id));
    if (tab === "privados") {
      list = list.filter((p) => {
        const privateEmails = parsePrivateEmails(p.private_to_emails);
        const isPrivate = isPrivateProduct(p);
        if (!isPrivate) return false;
        if (role === "admin") return true;
        if (role === "provider") return normalizeEmail(p.provider_email) === myEmail;
        if (["seller", "despachante", "delivery"].includes(role)) return privateEmails.includes(myEmail);
        return false;
      });
    }
    if (selectedProvider !== "todos") list = list.filter((p) => normalizeEmail(p.provider_email) === selectedProvider);
    if (selectedProductId !== "todos") list = list.filter((p) => p.id === selectedProductId);
    if (search) {
      const q = norm(search);
      list = list.filter((p) => [p.title, p.sku, p.provider_email, p.description].map((v) => norm(String(v || ""))).join(" ").includes(q));
    }
    list.sort((a, b) => {
      const ma = metricsByProduct[a.id] || emptyMetrics;
      const mb = metricsByProduct[b.id] || emptyMetrics;
      if (sortMode === "mas_vendidos") return mb.sold_count - ma.sold_count;
      if (sortMode === "mas_entregados") return mb.delivered_count - ma.delivered_count;
      if (sortMode === "mayor_facturacion") return mb.real_revenue_gs - ma.real_revenue_gs;
      if (sortMode === "mayor_ganancia") return (mb.gross_profit_gs - getProductAdSpend(b.id)) - (ma.gross_profit_gs - getProductAdSpend(a.id));
      if (sortMode === "stock_bajo") {
        if (isDelivery) return getDeliveryStockForProduct(a.id) - getDeliveryStockForProduct(b.id);
        return Number(a.stock || 0) - Number(b.stock || 0);
      }
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
    return list;
  }, [products, tab, search, userFavorites, role, myEmail, selectedProvider, selectedProductId, sortMode, metricsByProduct, getProductAdSpend, isDelivery, getDeliveryStockForProduct]);

  const totals = useMemo(() => {
    const base = filtered.reduce(
      (acc, p) => {
        const m = metricsByProduct[p.id] || emptyMetrics;
        acc.sold += m.sold_count; acc.delivered += m.delivered_count; acc.cancelled += m.cancelled_count;
        acc.returned += m.returned_count; acc.noAnswer += m.no_answer_count; acc.billed += m.billed_count;
        acc.grossRevenue += m.gross_revenue_gs; acc.realRevenue += m.real_revenue_gs;
        acc.productCost += m.product_cost_gs; acc.grossProfit += m.gross_profit_gs;
        acc.productAdSpend += getProductAdSpend(p.id);
        return acc;
      },
      { sold: 0, delivered: 0, cancelled: 0, returned: 0, noAnswer: 0, billed: 0, grossRevenue: 0, realRevenue: 0, productCost: 0, grossProfit: 0, productAdSpend: 0 }
    );
    const totalAdSpend = generalAdSpend + base.productAdSpend;
    return { ...base, generalAdSpend, totalAdSpend, netProfit: base.grossProfit - totalAdSpend, deliveryRate: base.sold > 0 ? Math.round((base.delivered / base.sold) * 100) : 0 };
  }, [filtered, metricsByProduct, getProductAdSpend, generalAdSpend]);

  const grouped = useMemo(() => {
    const map = new Map<string, { email: string; name: string; logo: string; phone: string; items: Product[]; totals: typeof totals }>();
    filtered.forEach((p) => {
      const key = normalizeEmail(p.provider_email || "__sin_proveedor__");
      if (!map.has(key)) {
        const info = profileMap[key] || { name: p.provider_email || "Sin proveedor", logo: "", phone: "" };
        map.set(key, { email: p.provider_email || "", name: info.name, logo: info.logo, phone: info.phone, items: [], totals: { sold: 0, delivered: 0, cancelled: 0, returned: 0, noAnswer: 0, billed: 0, grossRevenue: 0, realRevenue: 0, productCost: 0, grossProfit: 0, productAdSpend: 0, generalAdSpend: 0, totalAdSpend: 0, netProfit: 0, deliveryRate: 0 } });
      }
      const group = map.get(key)!;
      const m = metricsByProduct[p.id] || emptyMetrics;
      const productAd = getProductAdSpend(p.id);
      group.items.push(p);
      group.totals.sold += m.sold_count; group.totals.delivered += m.delivered_count;
      group.totals.cancelled += m.cancelled_count; group.totals.returned += m.returned_count;
      group.totals.noAnswer += m.no_answer_count; group.totals.billed += m.billed_count;
      group.totals.grossRevenue += m.gross_revenue_gs; group.totals.realRevenue += m.real_revenue_gs;
      group.totals.productCost += m.product_cost_gs; group.totals.grossProfit += m.gross_profit_gs;
      group.totals.productAdSpend += productAd; group.totals.totalAdSpend += productAd;
      group.totals.netProfit = group.totals.grossProfit - group.totals.totalAdSpend;
      group.totals.deliveryRate = group.totals.sold > 0 ? Math.round((group.totals.delivered / group.totals.sold) * 100) : 0;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [filtered, profileMap, metricsByProduct, getProductAdSpend]);

  const getImages = (p: Product) => [p.image_url, p.image_url_2, p.image_url_3].filter(Boolean) as string[];
  const getInitials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "PR";

  const openAdd = () => setEditProduct({ id: "", ...emptyProduct, isNew: true, provider_email: role === "provider" ? myEmail : "" } as any);
  
  const openEdit = (p: Product) => {
    setEditProduct({ ...p });
    // Cargar stocks actuales para este producto
    const currentStocks = deliveryStocks
      .filter(ds => ds.product_id === p.id)
      .map(ds => ({ delivery_email: ds.delivery_email, quantity: ds.quantity }));
    setDeliveryStocksForEdit(currentStocks);
  };

  const saveProduct = async () => {
    if (!editProduct) return;
    const { isNew, id, ...data } = editProduct as any;
    if (!data.title || !data.sku) { toast.error("Título y SKU son obligatorios"); return; }
    if (role === "provider") data.provider_email = myEmail;
    
    let savedProductId = id;
    
    if (isNew) {
      const { data: inserted, error } = await supabase.from("products").insert(data).select().single();
      if (error) { toast.error(error.message); return; }
      toast.success("Producto creado");
      savedProductId = inserted.id;
    } else {
      const { error } = await supabase.from("products").update(data).eq("id", id);
      if (error) { toast.error(error.message); return; }
      toast.success("Producto actualizado");
    }

    // Guardar stocks de delivery
    if (savedProductId && canAssignStock) {
      // Eliminar stocks existentes
      await supabase.from("delivery_stock").delete().eq("product_id", savedProductId);
      // Insertar nuevos stocks
      for (const stock of deliveryStocksForEdit) {
        if (stock.quantity > 0) {
          await supabase.from("delivery_stock").insert({
            delivery_email: stock.delivery_email,
            product_id: savedProductId,
            quantity: stock.quantity
          });
          // Registrar movimiento
          await supabase.from("delivery_stock_movements").insert({
            delivery_email: stock.delivery_email,
            product_id: savedProductId,
            quantity_change: stock.quantity,
            reason: "➕ Asignación de stock por admin/proveedor",
            order_id: null,
          });
        }
      }
    }

    setEditProduct(null);
    load();
    loadDeliveryStocks();
  };

  const deleteProduct = async (productId: string) => {
    if (!confirm("¿Estás seguro de que querés eliminar este producto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", productId);
    if (error) { toast.error(error.message); return; }
    toast.success("Producto eliminado");
    setEditProduct(null);
    load();
  };

  const saveAdSpend = async () => {
    if (!myEmail) { toast.error("Debes iniciar sesión"); return; }
    if (!adSpendToDate) { toast.error("Seleccioná una fecha de gasto"); return; }
    if (!adAmount || Number(adAmount) <= 0) { toast.error("Ingresá un gasto publicitario válido"); return; }
    if (adTargetType === "producto" && !adTargetProductId) { toast.error("Seleccioná el producto para asignar el gasto"); return; }
    const targetProductId = adTargetType === "producto" ? adTargetProductId : null;
    const selectedAdProduct = products.find((p) => p.id === targetProductId);
    const providerEmail = role === "provider" ? myEmail : selectedAdProduct?.provider_email || (selectedProvider !== "todos" ? selectedProvider : null);
    try {
      const { error } = await supabase.from("ad_spend").insert({
        user_email: myEmail, provider_email: providerEmail, product_id: targetProductId,
        spend_date: adSpendToDate, amount_gs: Number(adAmount), note: adNote || null,
      });
      if (error) throw error;
      toast.success("Gasto publicitario guardado");
      setAdAmount(0); setAdNote(""); setAdTargetType("global"); setAdTargetProductId("");
      loadAdSpends();
    } catch (error: any) {
      console.error("Error guardando publicidad:", error);
      toast.error(error?.message || "No se pudo guardar gasto publicitario");
    }
  };

  const deleteAdSpend = async (id: string) => {
    if (!confirm("¿Eliminar este gasto publicitario?")) return;
    try {
      const { error } = await supabase.from("ad_spend").delete().eq("id", id);
      if (error) throw error;
      toast.success("Gasto eliminado");
      loadAdSpends();
    } catch (error: any) {
      toast.error(error?.message || "No se pudo eliminar");
    }
  };

  const softColors = [
    "from-blue-500/5 to-blue-600/5 border-blue-200/30",
    "from-emerald-500/5 to-emerald-600/5 border-emerald-200/30",
    "from-purple-500/5 to-purple-600/5 border-purple-200/30",
    "from-amber-500/5 to-amber-600/5 border-amber-200/30",
    "from-rose-500/5 to-rose-600/5 border-rose-200/30",
    "from-cyan-500/5 to-cyan-600/5 border-cyan-200/30",
    "from-indigo-500/5 to-indigo-600/5 border-indigo-200/30",
    "from-teal-500/5 to-teal-600/5 border-teal-200/30",
    "from-orange-500/5 to-orange-600/5 border-orange-200/30",
    "from-pink-500/5 to-pink-600/5 border-pink-200/30",
  ];

  return (
    <div className="app-card space-y-8">
      {/* Navegación principal: Productos / Páginas Web */}
      <div className="flex flex-wrap gap-2 border-b border-border/70 pb-4">
        <button
          className={`nav-btn !px-5 !py-2.5 ${mainView === "productos" ? "active" : ""}`}
          onClick={() => setMainView("productos")}
        >
          📦 Productos
        </button>
        <button
          className={`nav-btn !px-5 !py-2.5 ${mainView === "paginas" ? "active" : ""}`}
          onClick={() => setMainView("paginas")}
        >
          🌐 Páginas Web
        </button>
      </div>

      {mainView === "paginas" ? (
        <WebPageBuilder products={products} userEmail={myEmail} />
      ) : (
        <>
      {/* Header */}
      <div className="rounded-[28px] border border-border/70 bg-gradient-to-br from-background via-secondary/20 to-background p-5 sm:p-6 shadow-sm flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-primary font-black">Panel comercial</div>
          <h3 className="text-3xl font-black tracking-tight mt-1">Productos</h3>
          <p className="text-sm text-muted-foreground mt-1">Catálogo con métricas, facturación real y rentabilidad por fechas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={`nav-btn !px-4 !py-2.5 !text-sm ${viewMode === "grid" ? "active" : ""}`} onClick={() => setViewMode("grid")}>▦ Vista Grid</button>
          <button className={`nav-btn !px-4 !py-2.5 !text-sm ${viewMode === "compact" ? "active" : ""}`} onClick={() => setViewMode("compact")}>☰ Vista Compacta</button>
          <button className={`nav-btn !px-4 !py-2.5 !text-sm ${showTopSection ? "active" : ""}`} onClick={() => setShowTopSection(!showTopSection)}>
            {showTopSection ? "🔽 Ocultar panel" : "🔼 Mostrar panel"}
          </button>
          {canSeeRealStock && (
            <button className={`nav-btn !px-4 !py-2.5 !text-sm ${syncingStock ? "opacity-50" : ""}`} onClick={syncStockFromOrders} disabled={syncingStock}>
              {syncingStock ? "🔄 Sincronizando..." : "🔄 Sincronizar stock"}
            </button>
          )}
        </div>
      </div>

      {/* Sección superior ocultable */}
      {showTopSection && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { label: "Facturación real", val: totals.realRevenue, sub: "Solo pedidos entregados", highlight: false },
              { label: "Ganancia bruta", val: totals.grossProfit, sub: "Facturación real - costo", highlight: false },
              { label: "Publicidad total", val: totals.totalAdSpend, sub: "Global + productos", highlight: false },
            ].map(({ label, val, sub }) => (
              <div key={label} className="rounded-[24px] border border-border/70 bg-gradient-to-br from-secondary/80 to-background/70 p-5 shadow-sm">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">{label}</div>
                <div className="font-black text-2xl mt-2">{nf(val)} Gs</div>
                <div className="text-xs text-muted-foreground mt-1">{sub}</div>
              </div>
            ))}
            <div className={`rounded-[24px] border p-5 shadow-sm ${totals.netProfit >= 0 ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-background" : "border-red-500/30 bg-gradient-to-br from-red-500/10 to-background"}`}>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Ganancia neta</div>
              <div className={`font-black text-2xl mt-2 ${totals.netProfit >= 0 ? "text-emerald-500" : "text-red-500"}`}>{nf(totals.netProfit)} Gs</div>
              <div className="text-xs text-muted-foreground mt-1">Bruta - publicidad</div>
            </div>
          </div>

          {/* Filtros */}
          <div className="rounded-[28px] border border-border/70 bg-background/70 p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="font-extrabold text-base">Filtros de métricas</div>
                <div className="text-xs text-muted-foreground">Seleccioná el período para calcular ventas, entregas y ganancias</div>
              </div>
              {metricsLoading && <span className="chip text-xs">🔄 Actualizando métricas...</span>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="app-label text-xs">Desde</label>
                <input type="date" className="app-input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="app-label text-xs">Hasta</label>
                <input type="date" className="app-input" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div>
                <label className="app-label text-xs">Proveedor</label>
                <select className="app-input" value={selectedProvider} onChange={(e) => { setSelectedProvider(e.target.value); setSelectedProductId("todos"); }}>
                  <option value="todos">Todos los proveedores</option>
                  {providerOptions.map(([email, name]) => <option key={email} value={email}>{name}</option>)}
                </select>
              </div>
              <div>
                <label className="app-label text-xs">Producto</label>
                <select className="app-input" value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}>
                  <option value="todos">Todos los productos</option>
                  {productOptions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
              <div>
                <label className="app-label text-xs">Ordenar por</label>
                <select className="app-input" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
                  <option value="recientes">📅 Más recientes</option>
                  <option value="mas_vendidos">🏆 Más vendidos</option>
                  <option value="mas_entregados">🚚 Más entregados</option>
                  <option value="mayor_facturacion">💰 Mayor facturación</option>
                  <option value="mayor_ganancia">📈 Mayor ganancia</option>
                  <option value="stock_bajo">⚠️ Stock bajo</option>
                </select>
              </div>
            </div>
          </div>

          {/* Gasto Publicitario */}
          <section className="relative overflow-hidden rounded-[32px] border border-amber-300/40 bg-gradient-to-br from-amber-50/70 via-background to-orange-50/50 p-5 sm:p-6 shadow-sm space-y-6 dark:from-amber-500/10 dark:via-background dark:to-orange-500/5">
            <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-amber-400/10 blur-3xl" />
            <div className="relative flex items-start justify-between flex-wrap gap-4">
              <div className="max-w-2xl">
                <div className="text-[11px] uppercase tracking-[0.22em] text-amber-600 font-black">Gastos publicitarios</div>
                <div className="font-black text-2xl mt-1">💰 Publicidad y campañas</div>
                <div className="text-sm text-muted-foreground mt-1">Registrá gastos globales o por producto, sin mezclar esta parte con el catálogo.</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full lg:w-auto">
                {[{ label: "Total", val: totals.totalAdSpend }, { label: "Global", val: generalAdSpend }, { label: "Productos", val: totalProductAdSpend }].map(({ label, val }) => (
                  <div key={label} className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 shadow-sm">
                    <div className="text-[9px] uppercase tracking-wider text-white/45 font-black">{label}</div>
                    <div className="font-black text-base font-mono">{nf(val)} Gs</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)] gap-6">
              <div className="rounded-[24px] border border-border/70 bg-background/80 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="app-label text-xs">📅 Gasto desde</label>
                    <input type="date" className="app-input" value={adSpendFromDate} onChange={(e) => setAdSpendFromDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="app-label text-xs">📅 Gasto hasta</label>
                    <input type="date" className="app-input" value={adSpendToDate} onChange={(e) => setAdSpendToDate(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="app-label text-xs">🎯 Asignar gasto a</label>
                  <div className="flex flex-wrap gap-3 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" value="global" checked={adTargetType === "global"} onChange={(e) => { setAdTargetType(e.target.value as any); if (e.target.value === "global") setAdTargetProductId(""); }} className="w-4 h-4" />
                      <span className="text-sm">Global / General</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" value="producto" checked={adTargetType === "producto"} onChange={(e) => setAdTargetType(e.target.value as any)} className="w-4 h-4" />
                      <span className="text-sm">Producto específico</span>
                    </label>
                  </div>
                </div>
                {adTargetType === "producto" && (
                  <div>
                    <label className="app-label text-xs">📦 Seleccionar producto</label>
                    <select className="app-input" value={adTargetProductId} onChange={(e) => setAdTargetProductId(e.target.value)}>
                      <option value="">-- Elegir producto --</option>
                      {productOptions.map((p) => <option key={p.id} value={p.id}>{p.title} {p.sku ? `· ${p.sku}` : ""}</option>)}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="app-label text-xs">💵 Monto (Gs)</label>
                    <input type="number" className="app-input font-mono" value={adAmount || ""} onChange={(e) => setAdAmount(Number(e.target.value))} placeholder="Ej: 50000" />
                  </div>
                  <div>
                    <label className="app-label text-xs">📝 Nota / Plataforma</label>
                    <input className="app-input" value={adNote} onChange={(e) => setAdNote(e.target.value)} placeholder="Facebook, TikTok, Google..." />
                  </div>
                </div>
                <button className="nav-btn active w-full py-3 text-sm font-bold" onClick={saveAdSpend}>💾 Guardar gasto publicitario</button>
              </div>
              <div className="rounded-[24px] border border-border/70 bg-background/80 p-4 sm:p-5 shadow-sm space-y-3">
                <div className="font-bold text-sm flex items-center gap-2">
                  📋 Últimos gastos registrados
                  <span className="chip text-xs">{adSpends.length} gastos</span>
                </div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-2">
                  {adSpends.length > 0 ? adSpends.map((s) => {
                    const product = products.find((p) => p.id === s.product_id);
                    return (
                      <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/80 p-3 hover:shadow-md transition-all group">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold">{product ? `📦 ${product.title}` : "🌍 Gasto Global"}</span>
                            {product && <span className="chip text-[10px]">{product.sku}</span>}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span>📅 {s.spend_date}</span>
                            {s.note && <span>📌 {s.note}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-sm font-mono">{nf(s.amount_gs)} Gs</span>
                          <button className="opacity-0 group-hover:opacity-100 transition-opacity nav-btn !px-2 !py-1 !text-xs" onClick={() => deleteAdSpend(s.id)}>🗑️</button>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">No hay gastos registrados en el período seleccionado</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* CATÁLOGO DE PRODUCTOS                              */}
      {/* ═══════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-gradient-to-br from-[#0a0d14] via-[#0f1320] to-[#05070b] p-5 sm:p-6 shadow-2xl space-y-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(59,130,246,0.12),transparent_70%)]" />
        <div className="pointer-events-none absolute -top-40 -right-40 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-purple-500/10 blur-3xl" />

        <div className="relative">
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 border-b border-white/10 pb-5 mb-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-primary/80 font-black">Catálogo</div>
              <h3 className="text-2xl sm:text-3xl font-black tracking-tight mt-1 text-white">📦 Productos disponibles</h3>
              <p className="text-xs sm:text-sm text-white/60 mt-1">Listado separado de gastos, organizado por proveedor, stock y métricas</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/15 bg-white/5 backdrop-blur-sm px-3 py-1.5 text-xs font-black text-white shadow-sm">{filtered.length} productos</span>
              <span className="rounded-full border border-white/15 bg-white/5 backdrop-blur-sm px-3 py-1.5 text-xs font-black text-white shadow-sm">📦 {totals.sold} vendidos</span>
              <span className="rounded-full border border-white/15 bg-white/5 backdrop-blur-sm px-3 py-1.5 text-xs font-black text-white shadow-sm">🚚 {totals.delivered} entregados</span>
            </div>
          </div>

          {/* Búsqueda */}
          <div className="bg-gradient-to-r from-white/[0.03] to-white/[0.01] rounded-2xl border border-white/10 p-4 shadow-lg backdrop-blur-sm mb-6">
            <div className="flex items-center gap-3">
              <div className="text-xl text-white/50">🔍</div>
              <input
                className="flex-1 bg-transparent border-0 px-0 py-2 text-white placeholder:text-white/40 text-base font-medium focus:ring-0 focus:outline-none"
                placeholder="Buscar por nombre, SKU o proveedor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
              {search && <button className="text-white/50 hover:text-white text-lg px-2 transition-all" onClick={() => setSearch("")}>✕</button>}
            </div>
            {search && <div className="mt-2 text-xs text-white/40 px-1">Mostrando {filtered.length} de {products.length} productos</div>}
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap gap-3 items-center justify-between mb-6">
            <div className="flex flex-wrap gap-2">
              {(["general", "favoritos", "privados"] as Tab[]).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`rounded-xl px-4 py-2 text-sm font-bold transition-all ${tab === t ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" : "bg-white/5 text-white/80 border border-white/10 hover:bg-white/10 hover:text-white"}`}>
                  {t === "general" && "📦 Todos"}
                  {t === "favoritos" && "⭐ Favoritos"}
                  {t === "privados" && "🔒 Privados"}
                </button>
              ))}
            </div>
            {canEdit && (
              <button className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:scale-[1.02]" onClick={openAdd}>
                + Agregar producto
              </button>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div className="text-center py-16">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-white/50 text-sm mt-3">Cargando productos...</p>
            </div>
          )}

          {/* Grupos por proveedor */}
          {grouped.map((group, groupIndex) => (
            <div key={group.email || group.name} className="mb-8 last:mb-0">
              {/* Header proveedor */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl bg-white/[0.04] border border-white/10 mb-4 backdrop-blur-sm">
                <div className="flex items-center gap-4">
                  {group.logo ? (
                    <div className="w-12 h-12 rounded-full bg-white/10 p-0.5 border border-white/15">
                      <img src={group.logo} alt={group.name} className="w-full h-full rounded-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center font-bold text-white">{getInitials(group.name)}</div>
                  )}
                  <div>
                    <div className="text-[10px] uppercase text-white/40 font-bold">Proveedor</div>
                    <div className="font-bold text-white">{group.name}</div>
                    <div className="text-xs text-white/40">{group.email}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  {[{ label: "Productos", val: group.items.length }, { label: "Vendidos", val: group.totals.sold }, { label: "Entregados", val: group.totals.delivered }].map(({ label, val }) => (
                    <div key={label} className="text-center px-3 py-1 rounded-xl bg-white/5 border border-white/10">
                      <div className="font-bold text-white">{val}</div>
                      <div className="text-[10px] text-white/40">{label}</div>
                    </div>
                  ))}
                  {canSeeMoney && (
                    <>
                      <div className="text-center px-3 py-1 rounded-xl bg-white/5 border border-white/10">
                        <div className="font-bold text-white">{nf(group.totals.realRevenue)}</div>
                        <div className="text-[10px] text-white/40">Facturación</div>
                      </div>
                      <div className="text-center px-3 py-1 rounded-xl bg-white/5 border border-white/10">
                        <div className={`font-bold ${group.totals.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{nf(group.totals.netProfit)}</div>
                        <div className="text-[10px] text-white/40">Ganancia neta</div>
                      </div>
                    </>
                  )}
                  {group.phone && canLoadOrder && !isDelivery && (
                    <a href={`https://wa.me/${group.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-xl border border-white/15 px-3 py-1 text-sm font-medium text-[#25D366] hover:bg-white/5 transition-all">
                      💬 WhatsApp
                    </a>
                  )}
                </div>
              </div>

              {/* Grid de productos */}
              <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" : "space-y-3"}>
                {group.items.map((p) => {
                  const images = getImages(p);
                  const mainImg = images[imgIndex[p.id] || 0] || "";
                  const isFav = userFavorites.has(p.id);
                  const m = metricsByProduct[p.id] || emptyMetrics;
                  const productAdSpend = getProductAdSpend(p.id);
                  const deliveryRate = m.sold_count > 0 ? Math.round((m.delivered_count / m.sold_count) * 100) : 0;
                  const deliveryStockQty = getDeliveryStockForProduct(p.id);
                  const stockCritical = isDelivery ? (deliveryStockQty <= 3) : (Number(p.stock || 0) <= 3);
                  const topProduct = m.delivered_count >= 10 && deliveryRate >= 70;

                  if (viewMode === "compact") {
                    return (
                      <div key={p.id} className="group rounded-xl border border-white/10 bg-white/[0.03] p-3 flex flex-col sm:flex-row gap-3 sm:items-center hover:bg-white/[0.06] transition-all">
                        <div className="w-16 h-16 rounded-xl bg-[#1a1f2e] border border-white/10 overflow-hidden flex items-center justify-center cursor-pointer" onClick={() => mainImg && setViewingImage({ url: mainImg, title: p.title, index: 0 })}>
                          {mainImg ? <img src={mainImg} alt={p.title} className="w-full h-full object-contain" /> : <span className="text-xs text-white/30">📷</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-white/40 font-mono">SKU: {p.sku || "—"}</div>
                          <div className="font-bold text-white text-sm truncate">{p.title}</div>
                          <div className="flex gap-2 mt-1">
                            <span className={`text-xs ${stockCritical ? "text-red-400" : "text-white/60"}`}>Stock: {isDelivery ? deliveryStockQty : (p.stock || 0)}</span>
                            {canSeeRealStock && !isDelivery && <span className="text-xs text-white/60">Real: {p.real_stock || 0}</span>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button className="px-2 py-1 rounded-lg bg-white/5 text-sm" onClick={() => toggleFavorite(p.id)}>{isFav ? "★" : "☆"}</button>
                          <button className="px-2 py-1 rounded-lg bg-primary/20 text-primary text-sm font-bold" onClick={() => setSelectedProductDetail(p)}>👁️ Ver</button>
                          {canEdit && <button className="px-2 py-1 rounded-lg bg-white/5 text-sm" onClick={() => openEdit(p)}>✏️</button>}
                          {canEdit && <button className="px-2 py-1 rounded-lg bg-red-500/20 text-red-400 text-sm" onClick={() => deleteProduct(p.id)}>🗑️</button>}
                          {canAssignStock && <button className="px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 text-sm" onClick={() => setShowAssignStockModal(p)}>📦 Stock</button>}
                          {canLoadOrder && p.sku && <button className="px-2 py-1 rounded-lg bg-primary/80 text-xs font-bold text-white" onClick={() => onLoadProduct?.(p.sku!)}>Pedido</button>}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={p.id} className="group relative rounded-2xl border border-white/10 bg-gradient-to-b from-[#11161f] to-[#0a0d14] overflow-hidden transition-all duration-200 hover:border-white/20 hover:shadow-xl">
                      <div className="relative aspect-square overflow-hidden cursor-pointer bg-[#1a1f2e]" onClick={() => mainImg && setViewingImage({ url: mainImg, title: p.title, index: 0 })}>
                        <ProductImageGallery
                          images={images} title={p.title}
                          onViewFullscreen={(url) => setViewingImage({ url, title: p.title, index: 0 })}
                          currentIndex={imgIndex[p.id] || 0}
                          onIndexChange={(idx) => setImgIndex((prev) => ({ ...prev, [p.id]: idx }))}
                        />
                        <div className="absolute top-2 left-2 flex flex-col gap-1">
                          {stockCritical && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/80 text-white backdrop-blur-sm">⚠️ Stock bajo</span>}
                          {topProduct && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/80 text-white backdrop-blur-sm">🔥 Top ventas</span>}
                        </div>
                        <button className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white text-sm hover:bg-black/70 transition-all" onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}>
                          {isFav ? "★" : "☆"}
                        </button>
                      </div>
                      <div className="p-3 space-y-2">
                        <div className="flex justify-between items-start">
                          <div className="text-[10px] text-white/40 font-mono">SKU: {p.sku || "—"}</div>
                          <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${deliveryRate >= 70 ? "bg-emerald-500/20 text-emerald-300" : "bg-yellow-500/20 text-yellow-300"}`}>
                            ✅ {deliveryRate}% entrega
                          </div>
                        </div>
                        <div className="font-bold text-white text-sm line-clamp-2">{p.title}</div>
                        <div className="flex justify-between items-center pt-1">
                          <div>
                            <div className="text-[10px] text-white/40">Precio proveedor</div>
                            <div className="font-bold text-white text-sm font-mono">{nf(Number(p.provider_price_gs || 0))} Gs</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-white/40">Stock</div>
                            <div className={`font-bold text-sm ${stockCritical ? "text-red-400" : "text-white"}`}>{isDelivery ? deliveryStockQty : (p.stock || 0)}</div>
                          </div>
                        </div>
                        {p.suggested_price_gs && p.suggested_price_gs > 0 && !isDelivery && (
                          <div className="text-right">
                            <div className="text-[10px] text-white/40">Precio sugerido</div>
                            <div className="text-xs text-blue-400 font-mono">{nf(p.suggested_price_gs)} Gs</div>
                          </div>
                        )}
                        {canSeeRealStock && !isDelivery && (
                          <div className="flex justify-between text-xs">
                            <span className="text-white/40">Stock real:</span>
                            <span className="text-white font-mono">{p.real_stock || 0}</span>
                          </div>
                        )}
                        <div className="flex gap-2 pt-2">
                          <button className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition-all" onClick={() => setSelectedProductDetail(p)}>👁️ Ver detalles</button>
                          {canLoadOrder && p.sku && (
                            <button className="flex-1 text-xs font-bold py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-all" onClick={() => onLoadProduct?.(p.sku!)}>Pedido</button>
                          )}
                        </div>
                        {canEdit && (
                          <div className="flex gap-2 pt-1">
                            <button className="flex-1 text-xs py-1 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 transition-all" onClick={() => openEdit(p)}>✏️ Editar</button>
                            <button className="flex-1 text-xs py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all" onClick={() => deleteProduct(p.id)}>🗑️ Eliminar</button>
                            {canAssignStock && (
                              <button className="flex-1 text-xs py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-all" onClick={() => setShowAssignStockModal(p)}>📦 Stock</button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {filtered.length === 0 && !loading && (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">📦</div>
              <p className="text-white/60">No se encontraron productos</p>
              <p className="text-sm text-white/40 mt-1">Probá con otros filtros o agregá un nuevo producto</p>
            </div>
          )}
        </div>
      </section>

      {/* Modal asignación de stock */}
      {showAssignStockModal && (
        <AssignDeliveryStockModal
          product={showAssignStockModal}
          deliveryStocks={deliveryStocks.filter((ds) => ds.product_id === showAssignStockModal.id)}
          deliveries={deliveryUsers}
          onClose={() => setShowAssignStockModal(null)}
          onSave={(assignments) => saveDeliveryStockAssignments(showAssignStockModal.id, assignments)}
          onRefresh={loadDeliveryStocks}
        />
      )}

      {/* Modal detalle del producto */}
      {selectedProductDetail && (
        <ProductDetailModal
          product={selectedProductDetail}
          metrics={metricsByProduct[selectedProductDetail.id] || emptyMetrics}
          productAdSpend={getProductAdSpend(selectedProductDetail.id)}
          onClose={() => setSelectedProductDetail(null)}
          onEdit={() => openEdit(selectedProductDetail)}
          onDelete={() => deleteProduct(selectedProductDetail.id)}
          canEdit={canEdit}
          canSeeRealStock={canSeeRealStock}
          canSeeRealCost={canSeeRealCost}
          onLoadProduct={onLoadProduct}
          getImages={getImages}
          nf={nf}
          providerName={getProviderInfo(selectedProductDetail.provider_email).name}
          providerPhone={getProviderInfo(selectedProductDetail.provider_email).phone}
          isDelivery={isDelivery}
          deliveryStockQuantity={getDeliveryStockForProduct(selectedProductDetail.id)}
          showDeliveryStock={canSeeDeliveryStock}
          deliveryStocksList={getDeliveryStocksForProduct(selectedProductDetail.id)}
          onRefreshDeliveryStock={loadDeliveryStocks}
          onOpenAssignStock={() => setShowAssignStockModal(selectedProductDetail)}
        />
      )}

      {/* Modal de edición */}
      {editProduct && createPortal(
        <div className="fixed inset-0 bg-black/60 z-[9999] flex items-start justify-center p-2 sm:p-4 overflow-auto" onClick={() => setEditProduct(null)}>
          <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 w-full max-w-3xl my-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-lg font-extrabold">{(editProduct as any).isNew ? "➕ Agregar Producto" : "✏️ Editar Producto"}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="app-label">Título *</label>
                <input className="app-input" value={editProduct.title} onChange={(e) => setEditProduct({ ...editProduct, title: e.target.value })} />
              </div>
              <div>
                <label className="app-label">SKU *</label>
                <input className="app-input" value={editProduct.sku || ""} onChange={(e) => setEditProduct({ ...editProduct, sku: e.target.value })} />
              </div>
              <div>
                <label className="app-label">Precio proveedor (Gs)</label>
                <input type="number" className="app-input" value={editProduct.provider_price_gs || 0} onChange={(e) => setEditProduct({ ...editProduct, provider_price_gs: Number(e.target.value) })} />
              </div>
              <div>
                <label className="app-label">Precio sugerido (Gs)</label>
                <input type="number" className="app-input" value={editProduct.suggested_price_gs || 0} onChange={(e) => setEditProduct({ ...editProduct, suggested_price_gs: Number(e.target.value) })} placeholder="Ej: 550000" />
              </div>
              <div>
                <label className="app-label">Costo real (Gs)</label>
                <input type="number" className="app-input" value={editProduct.real_cost_gs || 0} onChange={(e) => setEditProduct({ ...editProduct, real_cost_gs: Number(e.target.value) })} />
              </div>
              <div>
                <label className="app-label">Stock</label>
                <input type="number" className="app-input" value={editProduct.stock || 0} onChange={(e) => setEditProduct({ ...editProduct, stock: Number(e.target.value) })} />
              </div>
              {canSeeRealStock && (
                <div>
                  <label className="app-label">Stock real</label>
                  <input type="number" className="app-input" value={editProduct.real_stock || 0} onChange={(e) => setEditProduct({ ...editProduct, real_stock: Number(e.target.value) })} />
                </div>
              )}
              <div>
                <label className="app-label">Ciudad de la bodega</label>
                <input className="app-input" value={editProduct.warehouse_city || ""} onChange={(e) => setEditProduct({ ...editProduct, warehouse_city: e.target.value })} placeholder="Ej: Caaguazú, Asunción" />
              </div>
              <ImageUploadField label="Imagen 1" value={editProduct.image_url || ""} onChange={(v) => setEditProduct({ ...editProduct, image_url: v })} />
              <ImageUploadField label="Imagen 2" value={editProduct.image_url_2 || ""} onChange={(v) => setEditProduct({ ...editProduct, image_url_2: v })} />
              <ImageUploadField label="Imagen 3" value={editProduct.image_url_3 || ""} onChange={(v) => setEditProduct({ ...editProduct, image_url_3: v })} />
              {role !== "provider" && (
                <div>
                  <label className="app-label">Email proveedor</label>
                  <input className="app-input" value={editProduct.provider_email || ""} onChange={(e) => setEditProduct({ ...editProduct, provider_email: e.target.value })} />
                </div>
              )}
              <div className="col-span-1 sm:col-span-2">
                <label className="app-label">Privado para (emails separados por coma)</label>
                <input className="app-input" value={editProduct.private_to_emails || ""} onChange={(e) => setEditProduct({ ...editProduct, private_to_emails: e.target.value })} placeholder="email1@x.com, email2@x.com" />
              </div>
              <div className="col-span-1 sm:col-span-2">
                <label className="app-label">Descripción / Detalles</label>
                <textarea className="app-input min-h-[80px]" value={editProduct.description || ""} onChange={(e) => setEditProduct({ ...editProduct, description: e.target.value })} placeholder="Descripción del producto..." />
              </div>
              <div className="col-span-1 sm:col-span-2">
                <label className="app-label">Garantías / Condiciones</label>
                <textarea className="app-input min-h-[80px]" value={editProduct.warranty_info || ""} onChange={(e) => setEditProduct({ ...editProduct, warranty_info: e.target.value })} placeholder="Ej: 12 meses de garantía, soporte incluido, etc." />
              </div>
              <div className="col-span-1 sm:col-span-2">
                <label className="app-label">Recursos adicionales</label>
                <textarea className="app-input min-h-[80px]" value={editProduct.additional_resources || ""} onChange={(e) => setEditProduct({ ...editProduct, additional_resources: e.target.value })} placeholder="Links a videos, manuales, fichas técnicas, etc." />
              </div>

              {/* SECCIÓN DE STOCK POR DELIVERY DENTRO DEL MODAL DE EDICIÓN */}
              {canAssignStock && (
                <div className="col-span-1 sm:col-span-2 border-t border-border/50 pt-4 mt-2">
                  <label className="app-label text-base font-bold flex items-center gap-2">
                    <span>📦</span> Stock por delivery
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Asignar stock específico a cada delivery
                  </p>
                  
                  <div className="space-y-2 max-h-[300px] overflow-y-auto border border-border/50 rounded-lg p-3 bg-secondary/20">
                    {deliveryUsers.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground text-sm">
                        No hay deliveries registrados en el sistema
                      </div>
                    ) : (
                      deliveryUsers.map((delivery) => {
                        const currentStock = deliveryStocksForEdit.find(
                          ds => ds.delivery_email === delivery.email
                        )?.quantity || 0;
                        
                        return (
                          <div key={delivery.email} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-background/50 border border-border/50">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm">{delivery.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{delivery.email}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const newStock = Math.max(0, currentStock - 1);
                                  setDeliveryStocksForEdit(prev => {
                                    const existing = prev.find(ds => ds.delivery_email === delivery.email);
                                    if (existing) {
                                      if (newStock === 0) {
                                        return prev.filter(ds => ds.delivery_email !== delivery.email);
                                      }
                                      return prev.map(ds => 
                                        ds.delivery_email === delivery.email 
                                          ? { ...ds, quantity: newStock }
                                          : ds
                                      );
                                    } else if (newStock > 0) {
                                      return [...prev, { delivery_email: delivery.email, quantity: newStock }];
                                    }
                                    return prev;
                                  });
                                }}
                                className="w-7 h-7 rounded-full bg-destructive/20 text-destructive hover:bg-destructive/30 transition-all"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                className="w-16 text-center py-1.5 rounded-lg bg-background border border-border text-sm font-mono"
                                value={currentStock}
                                onChange={(e) => {
                                  const newStock = Math.max(0, parseInt(e.target.value) || 0);
                                  setDeliveryStocksForEdit(prev => {
                                    const existing = prev.find(ds => ds.delivery_email === delivery.email);
                                    if (existing) {
                                      if (newStock === 0) {
                                        return prev.filter(ds => ds.delivery_email !== delivery.email);
                                      }
                                      return prev.map(ds => 
                                        ds.delivery_email === delivery.email 
                                          ? { ...ds, quantity: newStock }
                                          : ds
                                      );
                                    } else if (newStock > 0) {
                                      return [...prev, { delivery_email: delivery.email, quantity: newStock }];
                                    }
                                    return prev;
                                  });
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const newStock = currentStock + 1;
                                  setDeliveryStocksForEdit(prev => {
                                    const existing = prev.find(ds => ds.delivery_email === delivery.email);
                                    if (existing) {
                                      return prev.map(ds => 
                                        ds.delivery_email === delivery.email 
                                          ? { ...ds, quantity: newStock }
                                          : ds
                                      );
                                    } else {
                                      return [...prev, { delivery_email: delivery.email, quantity: newStock }];
                                    }
                                  });
                                }}
                                className="w-7 h-7 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-all"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  
                  {deliveryStocksForEdit.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-2">
                      Total stock asignado: {deliveryStocksForEdit.reduce((sum, ds) => sum + ds.quantity, 0)} unidades
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-between">
              <div>
                {!(editProduct as any).isNew && (
                  <button className="nav-btn !bg-destructive/20 hover:!bg-destructive/40 text-destructive" onClick={() => deleteProduct(editProduct.id)}>Eliminar</button>
                )}
              </div>
              <div className="flex gap-1.5">
                <button className="nav-btn" onClick={() => setEditProduct(null)}>Cancelar</button>
                <button className="nav-btn active" onClick={saveProduct}>Guardar</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal imagen fullscreen */}
      {viewingImage && (
        <ImageFullscreenModal
          images={getImages(products.find((p) => p.title === viewingImage.title) || products[0])}
          initialIndex={viewingImage.index || 0}
          title={viewingImage.title}
          onClose={() => setViewingImage(null)}
        />
      )}
    </>
      )}
    </div>
  );
}
