import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import StorePagesView from "@/components/StorePagesView";
import StoreOrdersView, {
  type CatalogProduct,
  type CoverageResult,
  type StoreOrderPrefill,
} from "@/components/StoreOrdersView";
import StoreRealtimeView from "@/components/StoreRealtimeView";
import StorePixelView from "@/components/StorePixelView";

type StoreTab = "pages" | "orders" | "realtime" | "pixel";
type CityEntry = { city: string; departamento: string | null };
type ProductRow = {
  id: string;
  title: string;
  sku: string | null;
  provider_email: string | null;
  is_private: boolean | null;
  is_private_stock: boolean | null;
  private_to_emails: string | null;
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const normalizeEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();
const normalizeRole = (value: unknown) => {
  const role = normalize(value);
  if (["admin", "administrador"].includes(role)) return "admin";
  if (["provider", "proveedor"].includes(role)) return "provider";
  if (["seller", "vendedor"].includes(role)) return "seller";
  if (["despachante", "dispatcher"].includes(role)) return "despachante";
  return role;
};

// Las variantes de escritura son equivalentes, pero nunca se infiere cobertura
// por coincidencia de departamento solamente.
const cityKey = (value: unknown) => {
  const city = normalize(value);
  return city === "asuncion" ? "asuncion" : city;
};
const departmentKey = (value: unknown) => {
  const department = normalize(value);
  return ["asuncion", "distrito capital"].includes(department) ? "capital" : department;
};
// Asunción es una sola ciudad en todo el país: se acepta aunque en precios
// figure con otro departamento (p. ej. "Central" en lugar de "Capital").
const CITY_WITHOUT_DEPARTMENT_CHECK = new Set(["asuncion"]);

export default function StoreView({
  onLoadOrder,
}: {
  onLoadOrder: (prefill: StoreOrderPrefill) => void;
}) {
  const { user, profile } = useAuth();
  const email = normalizeEmail(user?.email || profile?.email);
  const role = normalizeRole(profile?.role);
  const [tab, setTab] = useState<StoreTab>("pages");
  const [cities, setCities] = useState<CityEntry[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [referenceReady, setReferenceReady] = useState(false);

  useEffect(() => {
    let active = true;
    if (!email || !role) {
      setReferenceReady(false);
      setCities([]);
      setCatalogProducts([]);
      return;
    }

    const loadReferenceData = async () => {
      setReferenceReady(false);
      const [pricesResult, productsResult, favoritesResult] = await Promise.all([
        supabase.from("client_prices").select("city,departamento"),
        supabase
          .from("products")
          .select("id,title,sku,provider_email,is_private,is_private_stock,private_to_emails"),
        supabase.from("user_favorites").select("product_id").eq("user_email", email),
      ]);
      if (!active) return;
      if (pricesResult.error || productsResult.error || favoritesResult.error) {
        console.error("Mi Tienda: datos de referencia", {
          prices: pricesResult.error,
          products: productsResult.error,
          favorites: favoritesResult.error,
        });
        toast.error("No se pudo verificar el catálogo o la cobertura de Mi Tienda.");
        setCities([]);
        setCatalogProducts([]);
        return;
      }

      const visibleCities = (pricesResult.data || [])
        .filter((p) => Boolean(p.city?.trim()) && Boolean(p.departamento?.trim()))
        .map((p) => ({ city: p.city, departamento: p.departamento }));
      const favorites = new Set((favoritesResult.data || []).map((p) => p.product_id));
      const visibleProducts = ((productsResult.data || []) as ProductRow[]).filter((p) => {
        const privateProduct = Boolean(p.is_private_stock ?? p.is_private);
        const privateEmails = String(p.private_to_emails || "")
          .split(",")
          .map(normalizeEmail)
          .filter(Boolean);
        if (role === "admin") return true;
        if (role === "provider") return normalizeEmail(p.provider_email) === email;
        if (role === "seller" || role === "despachante") {
          const hasAccess = !privateProduct || privateEmails.includes(email);
          return hasAccess && (privateProduct || favorites.has(p.id));
        }
        return false;
      });
      if (!active) return;
      setCities(visibleCities);
      setCatalogProducts(
        visibleProducts.map((p) => ({ id: p.id, title: p.title, sku: p.sku }))
      );
      setReferenceReady(true);
    };

    void loadReferenceData();
    return () => { active = false; };
  }, [email, role]);

  const checkCoverage = useCallback(
    (city: string, department: string | null): CoverageResult => {
      if (!referenceReady || !cityKey(city) || !departmentKey(department)) return "unknown";
      const matchingCities = cities.filter((entry) => cityKey(entry.city) === cityKey(city));
      if (!matchingCities.length) return "uncovered";
      if (CITY_WITHOUT_DEPARTMENT_CHECK.has(cityKey(city))) return "covered";
      return matchingCities.some(
        (entry) => departmentKey(entry.departamento) === departmentKey(department)
      )
        ? "covered"
        : "uncovered";
    },
    [cities, referenceReady],
  );

  // No mostrar productos como inexistentes antes de terminar la consulta.
  const productsForOrders = useMemo(
    () => (referenceReady ? catalogProducts : undefined),
    [catalogProducts, referenceReady],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-border bg-background overflow-hidden">
        <div className="px-5 py-5 border-b border-border bg-secondary/10">
          <div className="text-[11px] uppercase tracking-[0.22em] text-primary font-black">
            Ecommerce del vendedor
          </div>
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 mt-1">
            <div>
              <h2 className="text-3xl font-black tracking-tight">🛍 Mi Tienda</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Tus páginas, pedidos web, métricas y Pixel de Meta en un solo lugar.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={`nav-btn ${tab === "pages" ? "active" : ""}`} onClick={() => setTab("pages")}>📄 Mis páginas</button>
              <button className={`nav-btn ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>📦 Pedidos</button>
              <button className={`nav-btn ${tab === "realtime" ? "active" : ""}`} onClick={() => setTab("realtime")}>📊 Vista en tiempo real</button>
              <button className={`nav-btn ${tab === "pixel" ? "active" : ""}`} onClick={() => setTab("pixel")}>🎯 Pixel</button>
            </div>
          </div>
        </div>
        <div className="p-4 sm:p-5">
          {tab === "pages" && <StorePagesView />}
          {tab === "orders" && (
            <StoreOrdersView
              onLoadOrder={onLoadOrder}
              checkCoverage={checkCoverage}
              catalogProducts={productsForOrders}
            />
          )}
          {tab === "realtime" && <StoreRealtimeView />}
          {tab === "pixel" && <StorePixelView />}
        </div>
      </div>
    </div>
  );
}
