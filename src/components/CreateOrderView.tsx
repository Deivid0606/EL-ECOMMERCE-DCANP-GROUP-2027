import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { BuyerHistoryModal } from "@/components/BuyerHistoryModal";
import { Loader2, History, CheckCircle, AlertCircle } from "lucide-react";

const nf = (n: number) => new Intl.NumberFormat("es-PY").format(n);

const normalizeEmail = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeRole = (value: any) => {
  const r = String(value || "")
    .trim()
    .toLowerCase();

  if (["admin", "administrador"].includes(r)) return "admin";
  if (["provider", "proveedor"].includes(r)) return "provider";
  if (["seller", "vendedor"].includes(r)) return "seller";
  if (["despachante", "dispatcher"].includes(r)) return "despachante";
  if (["delivery", "repartidor"].includes(r)) return "delivery";

  return r;
};

const parsePrivateEmails = (value: any): string[] =>
  String(value || "")
    .split(",")
    .map((e) =>
      String(e || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

const isPrivateProduct = (product: any) =>
  Boolean(product?.is_private_stock ?? product?.is_private);

const canAccessProduct = (product: any, profile: any) => {
  const role = normalizeRole(profile?.role);
  const userEmail = normalizeEmail(profile?.email);
  const providerEmail = normalizeEmail(product?.provider_email);
  const privateEmails = parsePrivateEmails(product?.private_to_emails);
  const isPrivate = isPrivateProduct(product);

  if (!role || !userEmail) return false;

  if (role === "admin") return true;

  if (role === "provider") {
    return providerEmail === userEmail;
  }

  if (["seller", "despachante", "delivery"].includes(role)) {
    if (!isPrivate) return true;
    return privateEmails.includes(userEmail);
  }

  return false;
};

// Función para extraer SOLO los últimos 6 dígitos del teléfono
const getLast6Digits = (phone: string): string => {
  if (!phone) return "";
  const digits = phone.toString().replace(/\D/g, "");
  return digits.slice(-6);
};

const generateNormalOrderId = async (): Promise<string> => {
  try {
    const now = new Date();
    const timestamp = now.getTime();
    const micro = Math.floor(performance.now() * 1000) % 1000;
    const random = Math.floor(Math.random() * 10000);
    const newOrderNumber = `A${timestamp}${micro}${random}`;

    const { data: existing } = await supabase
      .from("orders")
      .select("order_number")
      .eq("order_number", newOrderNumber)
      .maybeSingle();

    if (existing) {
      return `A${timestamp}${micro}${random}${Math.floor(Math.random() * 1000)}`;
    }

    return newOrderNumber;
  } catch (err) {
    console.error("Error en generateNormalOrderId:", err);
    const uuid = crypto.randomUUID().replace(/-/g, "").substring(0, 10);
    return `A${Date.now()}${uuid}`;
  }
};

// Mapeo de ciudades a departamentos
const ciudadDepartamentoMap: { [key: string]: string } = {
  Altos: "Cordillera",
  Aregua: "Central",
  Asuncion: "Capital",
  Asunción: "Capital",
  Atyra: "Cordillera",
  Atyrá: "Cordillera",
  "Benjamín Aceval": "Presidente Hayes",
  Caacupe: "Cordillera",
  Capiata: "Central",
  "Ciudad del este - ALTO PARANÁ": "Alto Paraná",
  "Colonia Yguazu - ALTO PARANÁ": "Alto Paraná",
  Emboscada: "Cordillera",
  "Eusebio Ayala": "Cordillera",
  "Fernando de la Mora": "Central",
  Guarambare: "Central",
  "Hernandarias - ALTO PARANÁ": "Alto Paraná",
  "INTERIOR PAGO ANTICIPADO": "Varios",
  Ita: "Central",
  "Itacurubí de la Cordillera": "Cordillera",
  Itaugua: "Central",
  "J. Augusto Saldívar": "Central",
  "Juan leon malloriquin - ALTO PARANÁ": "Alto Paraná",
  Lambare: "Central",
  Limpio: "Central",
  "Loma Grande": "Cordillera",
  Luque: "Central",
  "Mariano Roque Alonso": "Central",
  "Minga Guazu - ALTO PARANÁ": "Alto Paraná",
  Ñemby: "Central",
  "Nueva Italia": "Cordillera",
  Paraguarí: "Paraguarí",
  PIRAYÚ: "Paraguarí",
  Piribebuy: "Cordillera",
  "Presidente franco": "Alto Paraná",
  "Puerto Pdte. Franco - ALTO PARANÁ": "Alto Paraná",
  Remansito: "Presidente Hayes",
  "San Alberto - ALTO PARANÁ": "Alto Paraná",
  "San Antonio": "Central",
  "San Bernardino": "Cordillera",
  "San Lorenzo": "Central",
  "SANTA RITA - ALTO PARANÁ": "Alto Paraná",
  Tobatí: "Cordillera",
  "Villa Elisa": "Central",
  "Villa Hayes": "Presidente Hayes",
  Villarrica: "Guairá",
  Villeta: "Paraguarí",
  YAGUARON: "Paraguarí",
  Yguazu: "Alto Paraná",
  "YGUAZU - ALTO PARANÁ": "Alto Paraná",
  Ypacaraí: "Cordillera",
  Ypane: "Central",
};

// Departamentos disponibles
const DEPARTAMENTOS = [
  "Capital",
  "Central",
  "Alto Paraná",
  "Itapúa",
  "Cordillera",
  "Caaguazú",
  "Guairá",
  "Ñeembucú",
  "Concepción",
  "Amambay",
  "Canindeyú",
  "Caazapá",
  "Misiones",
  "Paraguarí",
  "Presidente Hayes",
  "Boquerón",
  "Alto Paraguay",
  "Varios",
];

const CreateOrderView = ({
  initialSku,
  onSkuConsumed,
  sheetPrefill,
  onPrefillConsumed,
}: {
  initialSku?: string | null;
  onSkuConsumed?: () => void;
  sheetPrefill?: {
    customer?: string;
    phone?: string;
    city?: string;
    street?: string;
    district?: string;
    email?: string;
    productTitle?: string;
    totalGs?: number;
    qty?: number;
    obs?: string;
    sku?: string;
    departamento?: string;
    sheetRow?: { sheetUrl: string; rowIndex: number };
  } | null;
  onPrefillConsumed?: () => void;
}) => {
  const { profile, user } = useAuth();

  const [products, setProducts] = useState<any[]>([]);
  const [clientPrices, setClientPrices] = useState<any[]>([]);
  const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");

  // Estados para departamento y ciudad
  const [departamento, setDepartamento] = useState("");
  const [city, setCity] = useState("");
  const [ciudadesFiltradas, setCiudadesFiltradas] = useState<any[]>([]);

  const [street, setStreet] = useState("");
  const [district, setDistrict] = useState("");
  const [email, setEmail] = useState("");
  const [obs, setObs] = useState("");
  const [shippingType, setShippingType] = useState<"DELIVERY" | "ENCOMIENDA">("DELIVERY");
  const [proofFile, setProofFile] = useState<File | null>(null);
  // Fila de Pedidos Shopify que se está cargando con el formulario.
  const [sheetRow, setSheetRow] = useState<{ sheetUrl: string; rowIndex: number } | null>(null);
  // "INTERIOR PAGO ANTICIPADO" siempre es encomienda con comprobante obligatorio.
  const isPrepaidCity = /pago\s*anticipado/i.test(city);
  useEffect(() => {
    if (isPrepaidCity) setShippingType("ENCOMIENDA");
  }, [isPrepaidCity]);
  const [items, setItems] = useState<
    { sku: string; sale_gs: number; qty: number }[]
  >([{ sku: "", sale_gs: 0, qty: 1 }]);
  const [saving, setSaving] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [checkingHistory, setCheckingHistory] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);
  const [clientStatus, setClientStatus] = useState<
    "new" | "regular" | "problematic" | null
  >(null);

  // Obtener departamentos que TIENEN AL MENOS UNA CIUDAD en clientPrices
  const departamentosConCiudades = useMemo(() => {
    const deptosConCiudades = new Set<string>();

    clientPrices.forEach((c) => {
      const depto = c.departamento || ciudadDepartamentoMap[c.city];
      if (depto && depto !== "Sin asignar") {
        deptosConCiudades.add(depto);
      }
    });

    // Solo mostrar departamentos que tienen ciudades cargadas y ordenarlos
    return Array.from(deptosConCiudades).sort();
  }, [clientPrices]);

  // Filtrar ciudades cuando cambia el departamento
  useEffect(() => {
    if (departamento) {
      const filtradas = clientPrices.filter((c) => {
        const depto = c.departamento || ciudadDepartamentoMap[c.city];
        return depto === departamento;
      });
      setCiudadesFiltradas(filtradas);
      // Resetear ciudad cuando cambia departamento
      if (city && !filtradas.find((c) => c.city === city)) {
        setCity("");
      }
    } else {
      setCiudadesFiltradas(clientPrices);
    }
  }, [departamento, clientPrices, city]);

  /**
   * Si el usuario todavía no inició sesión, conservamos la URL completa.
   * Una vez autenticado, el prellenado real se aplica dentro de loadData(),
   * después de cargar catálogo y ciudades. Eso evita que el <select> de
   * producto/ciudad borre valores antes de tener sus opciones disponibles.
   */
  useEffect(() => {
    if (!profile?.email) {
      localStorage.setItem("pending_order_url", window.location.href);
    }
  }, [profile?.email]);

  const checkBuyerHistory = async (phoneNumber: string) => {
    if (!phoneNumber || phoneNumber.length < 6) {
      setHasHistory(false);
      setClientStatus(null);
      return;
    }

    setCheckingHistory(true);
    try {
      const last6Digits = getLast6Digits(phoneNumber);

      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, status, total_gs, created_at")
        .or(`phone.ilike.%${last6Digits}`);

      if (error) throw error;

      const matchingOrders =
        orders?.filter((order) => {
          const orderLast6 = getLast6Digits(order.phone);
          return orderLast6 === last6Digits;
        }) || [];

      const hasOrders = matchingOrders.length > 0;
      setHasHistory(hasOrders);

      if (hasOrders) {
        const cancelled = matchingOrders.filter(
          (o) => o.status === "cancelled" || o.status === "cancelado",
        ).length;
        const returned = matchingOrders.filter(
          (o) => o.status === "returned" || o.status === "devuelto",
        ).length;
        const problemCount = cancelled + returned;
        const problemRate = problemCount / matchingOrders.length;

        if (problemRate >= 0.5) {
          setClientStatus("problematic");
        } else if (problemCount > 0) {
          setClientStatus("regular");
        } else {
          setClientStatus("regular");
        }
      } else {
        setClientStatus("new");
      }
    } catch (error) {
      console.error("Error verificando historial:", error);
      setHasHistory(false);
      setClientStatus(null);
    } finally {
      setCheckingHistory(false);
    }
  };

  useEffect(() => {
    if (phone && phone.length >= 6) {
      const debounceTimer = setTimeout(() => {
        checkBuyerHistory(phone);
      }, 500);
      return () => clearTimeout(debounceTimer);
    } else {
      setHasHistory(false);
      setClientStatus(null);
    }
  }, [phone]);

  const loadUserFavorites = async () => {
    if (!profile?.email) return new Set<string>();

    try {
      const { data, error } = await supabase
        .from("user_favorites")
        .select("product_id")
        .eq("user_email", profile.email);

      if (error) throw error;

      const favoriteSet = new Set(data?.map((f) => f.product_id) || []);
      setUserFavorites(favoriteSet);
      return favoriteSet;
    } catch (error) {
      console.error("Error cargando favoritos:", error);
      return new Set<string>();
    }
  };

  useEffect(() => {
    const loadData = async () => {
      if (!profile?.email || !profile?.role) return;

      setLoadingProducts(true);

      try {
        const favoritesSet = await loadUserFavorites();

        const { data: productsData, error: productsError } = await supabase
          .from("products")
          .select("*")
          .order("title");

        if (productsError) throw productsError;

        const allProducts = productsData || [];
        const visibleProducts = allProducts.filter(
          (p: any) => !p.is_hidden && canAccessProduct(p, profile),
        );

        const filteredProducts = visibleProducts.filter((p: any) => {
          const isPrivate = p.is_private === true;
          const isUserFavorite = favoritesSet.has(p.id);
          return isPrivate || isUserFavorite;
        });

        setProducts(filteredProducts);

        if (initialSku) {
          const found = filteredProducts.find((p: any) => p.sku === initialSku);
          if (found) {
            setItems([{ sku: initialSku, sale_gs: 0, qty: 1 }]);
          }
          onSkuConsumed?.();
        }

        // Cargar precios con departamento
        const { data: pricesData, error: pricesError } = await supabase
          .from("client_prices")
          .select("*")
          .order("city");

        if (pricesError) throw pricesError;

        // Si la tabla no tiene columna departamento, usar el mapa
        const pricesConDepto = (pricesData || []).map((p) => ({
          ...p,
          departamento:
            p.departamento || ciudadDepartamentoMap[p.city] || "Sin asignar",
        }));

        setClientPrices(pricesConDepto);


        /**
         * ============================================================
         * PRELLENADO DESDE BOT SKY / SELLER SKYLINE
         * ============================================================
         *
         * Se procesa AQUÍ, después de cargar:
         * - filteredProducts
         * - pricesConDepto
         *
         * De esa forma los <select> de Producto, Departamento y Ciudad
         * ya tienen sus opciones y pueden seleccionar el valor real.
         */
        let sellerParams = new URLSearchParams(window.location.search);

        // Si el login hizo perder los query params, intentamos recuperar
        // la URL original que guardamos antes de autenticar.
        if (sellerParams.get("origen") !== "seller-skyline") {
          const pendingOrderUrl = localStorage.getItem("pending_order_url");

          if (pendingOrderUrl) {
            try {
              const pendingUrl = new URL(pendingOrderUrl);
              const pendingParams = pendingUrl.searchParams;

              if (pendingParams.get("origen") === "seller-skyline") {
                sellerParams = pendingParams;
              }
            } catch (error) {
              console.warn("No se pudo recuperar pending_order_url:", error);
            }
          }
        }

        if (sellerParams.get("origen") === "seller-skyline") {
          const getParam = (...keys: string[]) => {
            for (const key of keys) {
              const value = sellerParams.get(key)?.trim();
              if (value) return value;
            }
            return "";
          };

          const nombre = getParam("nombre", "cliente");
          const telefono = getParam("telefono", "phone");
          const departamentoRecibido = getParam("departamento", "depto");
          const ciudadRecibida = getParam("ciudad", "city");
          const calle = getParam("calle", "street");
          const barrio = getParam("barrio", "district");
          const referencia = getParam("referencia", "reference");
          const emailRecibido = getParam("email");

          const producto = getParam("producto", "product_title");
          const productoId = getParam("producto_id", "product_id");
          const skuRecibido = getParam("sku");

          const cantidad = getParam("cantidad", "qty");
          const total = getParam("total", "total_gs");
          const pago = getParam("pago", "payment_method");
          const estadoPago = getParam("estado_pago", "payment_status");
          const pedidoOrigen = getParam("pedido", "order_number");
          const comprobante = getParam("comprobante", "receipt_url");
          const observacionRecibida = getParam("obs", "observacion");

          const totalNumber =
            Number(String(total || "").replace(/[^\d.-]/g, "")) || 0;

          const qtyNumberRaw = Number(cantidad || 1);
          const qtyNumber =
            Number.isFinite(qtyNumberRaw) && qtyNumberRaw > 0
              ? Math.floor(qtyNumberRaw)
              : 1;

          if (nombre) setCustomer(nombre);
          if (telefono) setPhone(telefono);
          if (calle) setStreet(calle);
          if (barrio) setDistrict(barrio);
          if (emailRecibido) setEmail(emailRecibido);

          const normalizeMatchText = (value: any) =>
            String(value || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
              .replace(/[^a-z0-9]+/g, " ")
              .replace(/\s+/g, " ")
              .trim();

          /**
           * CIUDAD + DEPARTAMENTO
           */
          if (ciudadRecibida) {
            const cityNorm = normalizeMatchText(ciudadRecibida);

            const exactCity = pricesConDepto.find(
              (row: any) => normalizeMatchText(row.city) === cityNorm,
            );

            const partialCity =
              exactCity ||
              pricesConDepto.find((row: any) => {
                const candidate = normalizeMatchText(row.city);
                return (
                  candidate &&
                  cityNorm &&
                  (candidate.includes(cityNorm) || cityNorm.includes(candidate))
                );
              });

            if (partialCity) {
              setCity(partialCity.city);

              const detectedDepartment =
                partialCity.departamento ||
                ciudadDepartamentoMap[partialCity.city] ||
                departamentoRecibido;

              if (detectedDepartment) {
                setDepartamento(detectedDepartment);
              }
            } else {
              if (departamentoRecibido) {
                const incomingDeptNorm = normalizeMatchText(departamentoRecibido);

                const matchingDept = Array.from(
                  new Set(
                    pricesConDepto
                      .map((row: any) => row.departamento)
                      .filter(Boolean),
                  ),
                ).find(
                  (depto: any) =>
                    normalizeMatchText(depto) === incomingDeptNorm ||
                    (incomingDeptNorm === "asuncion" &&
                      normalizeMatchText(depto) === "capital") ||
                    (incomingDeptNorm === "capital" &&
                      normalizeMatchText(depto) === "asuncion"),
                );

                if (matchingDept) {
                  setDepartamento(String(matchingDept));
                }
              }

              toast.info(
                `⚠️ La ciudad "${ciudadRecibida}" no coincide con una ciudad cargada. Revisala manualmente.`,
              );
            }
          } else if (departamentoRecibido) {
            const incomingDeptNorm = normalizeMatchText(departamentoRecibido);

            const matchingDept = Array.from(
              new Set(
                pricesConDepto
                  .map((row: any) => row.departamento)
                  .filter(Boolean),
              ),
            ).find(
              (depto: any) =>
                normalizeMatchText(depto) === incomingDeptNorm ||
                (incomingDeptNorm === "asuncion" &&
                  normalizeMatchText(depto) === "capital") ||
                (incomingDeptNorm === "capital" &&
                  normalizeMatchText(depto) === "asuncion"),
            );

            if (matchingDept) {
              setDepartamento(String(matchingDept));
            }
          }

          /**
           * PRODUCTO
           *
           * Prioridad:
           * 1. SKU exacto
           * 2. ID exacto
           * 3. Título exacto normalizado
           * 4. Título parcial normalizado
           */
          let productMatch: any = null;

          if (skuRecibido) {
            const skuNorm = skuRecibido.trim().toLowerCase();

            productMatch = filteredProducts.find(
              (product: any) =>
                String(product.sku || "").trim().toLowerCase() === skuNorm,
            );
          }

          if (!productMatch && productoId) {
            productMatch = filteredProducts.find(
              (product: any) => String(product.id || "") === productoId,
            );
          }

          if (!productMatch && producto) {
            const productTitleNorm = normalizeMatchText(producto);

            productMatch = filteredProducts.find(
              (product: any) =>
                normalizeMatchText(product.title) === productTitleNorm,
            );

            if (!productMatch) {
              productMatch = filteredProducts.find((product: any) => {
                const candidate = normalizeMatchText(product.title);

                return (
                  candidate &&
                  productTitleNorm &&
                  (candidate.includes(productTitleNorm) ||
                    productTitleNorm.includes(candidate))
                );
              });
            }
          }

          if (productMatch?.sku) {
            setItems([
              {
                sku: productMatch.sku,
                sale_gs:
                  totalNumber > 0
                    ? totalNumber
                    : Number(productMatch.sale_price_gs || 0),
                qty: qtyNumber,
              },
            ]);

            toast.success(`🎯 Producto detectado: ${productMatch.title}`);
          } else {
            setItems([
              {
                sku: "",
                sale_gs: totalNumber,
                qty: qtyNumber,
              },
            ]);

            if (producto || skuRecibido) {
              toast.info(
                `⚠️ Producto "${producto || skuRecibido}" no encontrado en tu catálogo disponible. Elegilo manualmente.`,
              );
            }
          }

          /**
           * OBSERVACIÓN
           */
          if (observacionRecibida) {
            setObs(observacionRecibida);
          } else {
            setObs(
              [
                producto ? `Producto: ${producto}` : "",
                pago ? `Forma de pago: ${pago}` : "",
                estadoPago ? `Estado de pago: ${estadoPago}` : "",
                referencia ? `Referencia: ${referencia}` : "",
                pedidoOrigen ? `Pedido BOT SKY: ${pedidoOrigen}` : "",
                comprobante ? `Comprobante: ${comprobante}` : "",
              ]
                .filter(Boolean)
                .join(" | "),
            );
          }

          localStorage.removeItem("pending_order_url");
          toast.success("Pedido recibido desde BOT SKY");
        }

        if (sheetPrefill) {
          setSheetRow(sheetPrefill.sheetRow || null);
          if (sheetPrefill.customer) setCustomer(sheetPrefill.customer);
          if (sheetPrefill.phone) setPhone(sheetPrefill.phone);
          if (sheetPrefill.street) setStreet(sheetPrefill.street);
          if (sheetPrefill.district) setDistrict(sheetPrefill.district);
          if (sheetPrefill.email) setEmail(sheetPrefill.email);
          if (sheetPrefill.obs) setObs(sheetPrefill.obs);

          const normCity = (s: string) =>
            s
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .trim();

          const sheetCityNorm = normCity(sheetPrefill.city || "");

          const findCity = (prices: any[]) => {
            const exact = prices.find(
              (c: any) => normCity(c.city || "") === sheetCityNorm,
            );
            if (exact) return exact;

            const partial = prices.find((c: any) => {
              const pc = normCity(c.city || "");
              return sheetCityNorm.includes(pc) || pc.includes(sheetCityNorm);
            });
            if (partial) return partial;

            const parts = sheetCityNorm
              .split(/[\-–—,\/|]+/)
              .map((s) => s.trim())
              .filter(Boolean);

            for (const part of parts) {
              const m = prices.find((c: any) => {
                const pc = normCity(c.city || "");
                return pc.includes(part) || part.includes(pc);
              });
              if (m) return m;
            }

            return null;
          };

          const cityMatch = findCity(pricesConDepto || []);
          if (cityMatch && sheetPrefill.departamento && !cityMatch.departamento && !ciudadDepartamentoMap[cityMatch.city]) {
            setCity(cityMatch.city);
            setDepartamento(sheetPrefill.departamento);
          } else if (cityMatch) {
            setCity(cityMatch.city);
            // Auto-select department
            const depto =
              cityMatch.departamento || ciudadDepartamentoMap[cityMatch.city];
            if (depto) setDepartamento(depto);
          } else if (sheetPrefill.city) {
            setCity(sheetPrefill.city);
          }

          const skuMatch = sheetPrefill.sku
            ? filteredProducts.find((p: any) => String(p.sku || "").trim().toLowerCase() === String(sheetPrefill.sku).trim().toLowerCase())
            : null;
          if (/pago\s*anticipado/i.test(String(cityMatch?.city || sheetPrefill.city || ""))) {
            toast.info("📮 Interior pago anticipado: subí el comprobante de pago y guardá.", { duration: 8000 });
          }

          if (skuMatch) {
            setItems([{ sku: skuMatch.sku, sale_gs: sheetPrefill.totalGs || 0, qty: sheetPrefill.qty || 1 }]);
            toast.success(`🎯 Producto: ${skuMatch.title}`);
          } else if (sheetPrefill.productTitle) {
            const titleLower = sheetPrefill.productTitle.toLowerCase().trim();
            const cleanTitle = titleLower
              .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
              .trim();

            const exactMatch = filteredProducts.find(
              (p: any) =>
                p.title?.toLowerCase().trim() === titleLower ||
                p.title?.toLowerCase().trim() === cleanTitle,
            );

            if (exactMatch && exactMatch.sku) {
              setItems([
                {
                  sku: exactMatch.sku,
                  sale_gs: sheetPrefill.totalGs || 0,
                  qty: sheetPrefill.qty || 1,
                },
              ]);
              toast.success(`🎯 Producto detectado: ${exactMatch.title}`);
            } else {
              const partialMatch = filteredProducts.find((p: any) => {
                const pTitle = p.title?.toLowerCase().trim() || "";
                return (
                  pTitle.includes(cleanTitle) || cleanTitle.includes(pTitle)
                );
              });

              if (partialMatch && partialMatch.sku) {
                setItems([
                  {
                    sku: partialMatch.sku,
                    sale_gs: sheetPrefill.totalGs || 0,
                    qty: sheetPrefill.qty || 1,
                  },
                ]);
                toast.success(
                  `🎯 Producto detectado (parcial): ${partialMatch.title}`,
                );
              } else {
                setItems([
                  {
                    sku: "",
                    sale_gs: sheetPrefill.totalGs || 0,
                    qty: sheetPrefill.qty || 1,
                  },
                ]);
                toast.info(
                  `⚠️ Producto "${sheetPrefill.productTitle}" no encontrado en catálogo. Elegilo manualmente.`,
                );
              }
            }
          }

          onPrefillConsumed?.();
        }
      } catch (error: any) {
        console.error("Error cargando datos de CreateOrderView:", error);
        toast.error(error?.message || "No se pudieron cargar los productos");
      } finally {
        setLoadingProducts(false);
      }
    };

    loadData();
  }, [
    initialSku,
    onSkuConsumed,
    sheetPrefill,
    onPrefillConsumed,
    profile?.email,
    profile?.role,
  ]);

  const catalogMap: Record<string, any> = useMemo(() => {
    const map: Record<string, any> = {};
    products.forEach((p) => {
      if (p.sku) map[p.sku] = p;
    });
    return map;
  }, [products]);

  const deliveryPrice =
    clientPrices.find((c) => c.city?.toLowerCase() === city.toLowerCase())
      ?.price_gs || 0;

  // sale_gs representa el PRECIO TOTAL de cada línea, no el precio unitario.
  // Ejemplo: 2 plumeros por 129.000 Gs => sale_gs = 129000 y qty = 2.
  const totalVenta = items.reduce((s, i) => s + Number(i.sale_gs || 0), 0);

  const totalProv = items.reduce((s, i) => {
    const p = catalogMap[i.sku];
    return s + (p ? Number(p.provider_price_gs || 0) * Number(i.qty || 0) : 0);
  }, 0);

  const commission = totalVenta - (totalProv + Number(deliveryPrice || 0));

  const addItem = () => setItems([...items, { sku: "", sale_gs: 0, qty: 1 }]);

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, field: string, value: any) => {
    const copy = [...items];
    (copy[idx] as any)[field] = value;

    if (field === "sku") {
      const selected = catalogMap[value];
      if (selected && !copy[idx].sale_gs) {
        copy[idx].sale_gs = Number(selected.sale_price_gs || 0);
      }
    }

    setItems(copy);
  };

  const resetForm = () => {
    setCustomer("");
    setPhone("");
    setDepartamento("");
    setCity("");
    setStreet("");
    setDistrict("");
    setEmail("");
    setObs("");
    setShippingType("DELIVERY");
    setProofFile(null);
    setSheetRow(null);
    setItems([{ sku: "", sale_gs: 0, qty: 1 }]);
  };

  const saveOrder = async () => {
    if (saving) return;

    if (!customer || !phone || !city) {
      toast.error("Completá cliente / teléfono / ciudad");
      return;
    }

    const validItems = items.filter(
      (i) =>
        i.sku &&
        Number(i.sale_gs) > 0 &&
        Number(i.qty) > 0 &&
        catalogMap[i.sku],
    );

    if (validItems.length === 0) {
      toast.error("Agregá al menos 1 ítem válido");
      return;
    }

    if ((shippingType === "ENCOMIENDA" || isPrepaidCity) && !proofFile) {
      toast.error("📮 Pedido por encomienda: cargá la foto del comprobante de pago");
      return;
    }

    const needBySku = new Map<string, number>();
    validItems.forEach((i) => needBySku.set(i.sku, (needBySku.get(i.sku) || 0) + Number(i.qty)));
    const sinStock = [...needBySku].filter(([sku, q]) => Number(catalogMap[sku]?.stock || 0) < q);
    if (sinStock.length) {
      toast.error(
        `Sin stock: ${sinStock.map(([sku, q]) => `${catalogMap[sku]?.title || sku} (stock ${Number(catalogMap[sku]?.stock || 0)}, pedido ${q})`).join("; ")}`,
        { duration: 8000 },
      );
      return;
    }

    setSaving(true);

    try {
      let paymentProofPath: string | null = null;
      if ((shippingType === "ENCOMIENDA" || isPrepaidCity) && proofFile) {
        const ext = (proofFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `${user?.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("payment-proofs")
          .upload(path, proofFile, { contentType: proofFile.type || undefined, upsert: false });
        if (upErr) throw upErr;
        paymentProofPath = path;
      }

      const orderNumber = await generateNormalOrderId();

      const providerEmails = [
        ...new Set(
          validItems
            .map((i) => catalogMap[i.sku]?.provider_email)
            .filter(Boolean),
        ),
      ];

      const payload = {
        order_number: orderNumber,
        created_by: profile?.email || null,
        customer_name: customer,
        phone,
        city,
        departamento: departamento,
        street,
        district,
        email,
        obs,
        items_json: validItems.map((i) => ({
          sku: i.sku,
          title: catalogMap[i.sku]?.title || i.sku,
          sale_gs: Number(i.sale_gs),
          qty: Number(i.qty),
          provider_price_gs: Number(catalogMap[i.sku]?.provider_price_gs || 0),
          provider_email: catalogMap[i.sku]?.provider_email || "",
        })),
        total_gs: totalVenta,
        delivery_gs: Number(deliveryPrice),
        commission_gs: commission,
        provider_emails_list: providerEmails.join(","),
        shipping_type: isPrepaidCity ? "ENCOMIENDA" : shippingType,
        payment_proof_path: paymentProofPath,
      };

      const { data: insertedOrder, error: insertError } = await supabase
        .from("orders")
        .insert(payload)
        .select("id, order_number")
        .single();

      if (insertError) throw insertError;

      const generatedOrderNumber = insertedOrder?.order_number || orderNumber;

      if (sheetRow && profile?.email) {
        // Marca la fila de Pedidos Shopify como cargada (no se vuelve a cargar).
        await (supabase as any).from("sheet_row_statuses").upsert(
          {
            user_email: profile.email,
            sheet_url: sheetRow.sheetUrl,
            row_index: sheetRow.rowIndex,
            status: "CARGADO_MANUAL",
            order_number: generatedOrderNumber,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_email,sheet_url,row_index" },
        );
        setSheetRow(null);
      }

      const { error: newsError } = await supabase.from("news").insert({
        order_id: String(generatedOrderNumber),
        actor_email: profile?.email,
        role_scope: profile?.role,
        message: `Nuevo pedido ${generatedOrderNumber} - ${customer} - ${departamento || city} - Gs ${nf(totalVenta)}`,
      });

      if (newsError) {
        console.error("Error al crear noticia:", newsError);
      }

      toast.success(`✅ Pedido ${generatedOrderNumber} guardado`);
      resetForm();
    } catch (error: any) {
      console.error("Error guardando pedido:", error);
      toast.error(error?.message || "No se pudo guardar el pedido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="app-card w-full min-w-0 overflow-x-hidden">
        <h3 className="mb-3 text-lg font-extrabold">Cargar pedido</h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="w-full min-w-0 md:col-span-1">
            <label className="app-label">Cliente</label>
            <input
              className="app-input w-full min-w-0 text-base"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />

            <div className="relative">
              <label className="app-label">Teléfono</label>
              <div className="flex gap-2">
                <input
                  className="app-input flex-1 min-w-0 text-base"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0991 123 456"
                />
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(true)}
                  disabled={!phone || phone.length < 6}
                  className="px-3 py-2 rounded-lg transition-all flex items-center gap-2 bg-gradient-to-r from-slate-700 to-slate-800 text-white hover:from-slate-800 hover:to-slate-900 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Ver historial completo del cliente"
                >
                  {checkingHistory ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <History className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline text-sm">Historial</span>
                </button>
              </div>

              {/* Indicador de estado del cliente */}
              {phone && phone.length >= 6 && !checkingHistory && (
                <div className="text-xs mt-1.5 flex items-center gap-2">
                  {hasHistory ? (
                    <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                      <span>📋 Cliente registrado</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      <span>🆕</span>
                      <span>Sin compras previas</span>
                    </div>
                  )}
                  <button
                    onClick={() => setShowHistoryModal(true)}
                    className="text-blue-600 hover:text-blue-800 underline-offset-2 hover:underline"
                  >
                    Ver detalles →
                  </button>
                </div>
              )}
            </div>

            {/* NUEVO: Selector de Departamento - SOLO si hay al menos una ciudad cargada */}
            {departamentosConCiudades.length > 0 && (
              <>
                <label className="app-label">Departamento</label>
                <select
                  className="app-input w-full min-w-0 text-base"
                  value={departamento}
                  onChange={(e) => setDepartamento(e.target.value)}
                >
                  <option value="">Selecciona departamento…</option>
                  {departamentosConCiudades.map((depto) => (
                    <option key={depto} value={depto}>
                      {depto}
                    </option>
                  ))}
                </select>
              </>
            )}

            {/* Selector de Ciudad (filtrado por departamento si existe) */}
            <label className="app-label">Ciudad</label>
            <select
              className="app-input w-full min-w-0 text-base"
              value={city}
              onChange={(e) => {
                const selectedCity = e.target.value;
                setCity(selectedCity);

                if (!selectedCity) {
                  setDepartamento("");
                  return;
                }

                // Detectar automáticamente el departamento de la ciudad elegida.
                const selectedCityData = clientPrices.find(
                  (c) => c.city === selectedCity,
                );

                const detectedDepartment =
                  selectedCityData?.departamento ||
                  ciudadDepartamentoMap[selectedCity] ||
                  "";

                setDepartamento(detectedDepartment);
              }}
            >
              <option value="">
                {departamentosConCiudades.length === 0
                  ? "No hay ciudades cargadas…"
                  : "Selecciona ciudad…"}
              </option>
              {ciudadesFiltradas.map((c) => (
                <option key={c.id} value={c.city}>
                  {c.city} - {nf(Number(c.price_gs || 0))} Gs
                </option>
              ))}
            </select>

            {deliveryPrice > 0 && (
              <div className="chip mt-1 break-words">
                Delivery cobrado: {nf(Number(deliveryPrice))} Gs
              </div>
            )}

            <label className="app-label">Calle</label>
            <input
              className="app-input w-full min-w-0 text-base"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
            />

            <label className="app-label">Barrio</label>
            <input
              className="app-input w-full min-w-0 text-base"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
            />

            <label className="app-label">Email</label>
            <input
              className="app-input w-full min-w-0 text-base"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Opcional"
            />

            <label className="app-label">Observación</label>
            <textarea
              className="app-input w-full min-w-0 text-base"
              rows={3}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
            />

            <label className="app-label">Tipo de envío</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["DELIVERY", "🛵 Delivery (paga al recibir)"],
                ["ENCOMIENDA", "📮 Encomienda (pago anticipado)"],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setShippingType(v)}
                  disabled={isPrepaidCity && v === "DELIVERY"}
                  className={`rounded-xl border p-2 text-xs font-bold disabled:opacity-40 ${shippingType === v ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {isPrepaidCity && (
              <div className="mt-1 text-[11px] font-bold text-amber-300">📮 Interior pago anticipado: el comprobante es obligatorio.</div>
            )}
            {shippingType === "ENCOMIENDA" && (
              <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <b className="text-amber-300">Comprobante de pago * (obligatorio)</b>
                <p className="mb-2 text-muted-foreground">Foto o captura de la transferencia del cliente. Despacho la revisa y aprueba antes de enviar.</p>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="w-full text-xs"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    if (f && f.size > 10 * 1024 * 1024) {
                      toast.error("El archivo pesa más de 10 MB");
                      e.target.value = "";
                      return;
                    }
                    setProofFile(f);
                  }}
                />
                {proofFile && <div className="mt-1 text-emerald-400">✅ {proofFile.name}</div>}
              </div>
            )}
          </div>

          <div className="w-full min-w-0 md:col-span-2">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="app-label !mt-0">Items</label>
              <span className="chip w-fit text-[10px]">
                Catálogo: {products.length} productos
              </span>
            </div>

            {items.map((item, idx) => (
              <div
                key={idx}
                className="mb-3 w-full min-w-0 rounded-xl border border-border p-3"
              >
                <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-12">
                  <div className="w-full min-w-0 md:col-span-5">
                    <label className="app-label !mt-0">Producto</label>
                    <select
                      className="app-input w-full min-w-0 text-base"
                      value={item.sku}
                      onChange={(e) => updateItem(idx, "sku", e.target.value)}
                    >
                      <option value="">
                        {loadingProducts
                          ? "Cargando productos…"
                          : "Seleccionar producto…"}
                      </option>
                      {products.map((p) => {
                        const t = String(p.title || "").trim();
                        const k = String(p.sku || "").trim();
                        const sameName = t.toLowerCase().replace(/[^a-z0-9]/g, "") === k.toLowerCase().replace(/[^a-z0-9]/g, "");
                        const stock = Number(p.stock || 0);
                        return (
                          <option key={p.id} value={p.sku} disabled={stock <= 0}>
                            {stock <= 0 ? "⛔ " : ""}
                            {t.length > 45 ? `${t.slice(0, 45)}…` : t}
                            {!sameName && k ? ` (${k.length > 20 ? `${k.slice(0, 20)}…` : k})` : ""}
                            {userFavorites.has(p.id) ? " ⭐" : ""}
                            {p.is_private ? " 🔒" : ""}
                            {stock <= 0 ? " · SIN STOCK" : ` · Stock ${stock}`}
                            {` · Prov ${nf(Number(p.provider_price_gs || 0))}`}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="w-full min-w-0 md:col-span-2">
                    <label className="app-label !mt-0">Proveedor</label>
                    <div className="chip w-full break-words text-[10px]">
                      Prov:{" "}
                      {nf(Number(catalogMap[item.sku]?.provider_price_gs || 0))}
                    </div>
                  </div>

                  <div className="w-full min-w-0 md:col-span-3">
                    <label className="app-label !mt-0">Venta TOTAL (Gs)</label>
                    <input
                      className="app-input w-full min-w-0 text-base"
                      type="number"
                      placeholder="Venta TOTAL (Gs)"
                      value={item.sale_gs || ""}
                      onChange={(e) =>
                        updateItem(idx, "sale_gs", Number(e.target.value))
                      }
                    />
                  </div>

                  <div className="w-full min-w-0 md:col-span-1">
                    <label className="app-label !mt-0">Cant.</label>
                    <input
                      className="app-input w-full min-w-0 text-base"
                      type="number"
                      placeholder="Cant."
                      value={item.qty}
                      onChange={(e) =>
                        updateItem(idx, "qty", Number(e.target.value))
                      }
                    />
                  </div>

                  <div className="w-full min-w-0 md:col-span-1">
                    <label className="app-label !mt-0 hidden opacity-0 md:block">
                      Acción
                    </label>
                    <button
                      className="nav-btn w-full text-xs"
                      onClick={() => removeItem(idx)}
                    >
                      Quitar
                    </button>
                  </div>
                </div>

                <div className="mt-2">
                  <span className="chip break-words text-[10px]">
                    Prov×Cant:{" "}
                    {nf(
                      Number(catalogMap[item.sku]?.provider_price_gs || 0) *
                        item.qty,
                    )}
                  </span>
                </div>
              </div>
            ))}

            <button
              className="nav-btn active mt-2 w-full text-xs sm:w-auto"
              onClick={addItem}
            >
              + Agregar ítem
            </button>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="w-full min-w-0">
                <label className="app-label">Total (Gs)</label>
                <input
                  className="app-input w-full min-w-0 bg-secondary"
                  readOnly
                  value={nf(totalVenta)}
                />
              </div>

              <div className="w-full min-w-0">
                <label className="app-label">Delivery cobrado (Gs)</label>
                <input
                  className="app-input w-full min-w-0 bg-secondary"
                  readOnly
                  value={nf(Number(deliveryPrice))}
                />
              </div>

              <div className="w-full min-w-0">
                <label className="app-label">Comisión estimada (Gs)</label>
                <input
                  className="app-input w-full min-w-0 bg-secondary"
                  readOnly
                  value={nf(commission)}
                />
              </div>
            </div>

            <div className="mt-4 flex">
              <button
                className="nav-btn active w-full md:w-auto md:min-w-[220px]"
                onClick={saveOrder}
                disabled={saving || loadingProducts}
              >
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="btn-spinner" /> Guardando...
                  </span>
                ) : (
                  "Guardar pedido"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <BuyerHistoryModal
        open={showHistoryModal}
        onOpenChange={setShowHistoryModal}
        phone={phone}
        customerName={customer}
      />
    </>
  );
};

export default CreateOrderView;
