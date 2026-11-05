import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { storeProductTitleKey, type StoreProductMapping } from "@/lib/storeProductMappings";
import type { CatalogProduct } from "@/components/StoreOrdersView";

type Props = {
  catalogProducts: CatalogProduct[];
  favoriteProductIds: string[];
  mappings: StoreProductMapping[];
  onMappingsChanged: () => Promise<void>;
};

export default function StoreSkuSettingsView({ catalogProducts, favoriteProductIds, mappings, onMappingsChanged }: Props) {
  const { user } = useAuth();
  const email = String(user?.email || "").trim().toLowerCase();
  const [titles, setTitles] = useState<string[]>([]);
  const [manualTitle, setManualTitle] = useState("");
  const [search, setSearch] = useState("");
  const [skuSearch, setSkuSearch] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!email) { setTitles([]); setLoading(false); return; }
    setLoading(true);
    void (async () => {
      const [ordersResult, pagesResult] = await Promise.all([
        supabase.from("landing_page_orders").select("product_title")
          .eq("seller_email", email).order("created_at", { ascending: false }).limit(1000),
        supabase.from("landing_pages").select("config").eq("owner_email", email),
      ]);
      if (!alive) return;
      if (ordersResult.error || pagesResult.error) {
        toast.error("No se pudieron consultar todos los productos de Mi Tienda.");
      }
      const unique = new Map<string, string>();
      const remember = (value: unknown) => {
        const title = String(value || "").trim();
        const key = storeProductTitleKey(title);
        if (key && !unique.has(key)) unique.set(key, title);
      };
      // Show products already on landing pages, even if they have no sales yet.
      (pagesResult.data || []).forEach(page => {
        const config = page.config as any;
        if (Array.isArray(config?.productSnapshots)) {
          config.productSnapshots.forEach((p: any) => remember(p?.title));
        }
      });
      (ordersResult.data || []).forEach(item => remember(item.product_title));
      setTitles([...unique.values()]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [email]);

  const allTitles = useMemo(() => {
    const unique = new Map<string, string>();
    // A product can be associated before its first page or online sale.
    const favorites = catalogProducts.filter(p => favoriteProductIds.includes(p.id)).map(p => p.title);
    for (const title of [...titles, ...favorites, ...mappings.map(m => m.raw_title)]) {
      const key = storeProductTitleKey(title);
      if (key && !unique.has(key)) unique.set(key, title);
    }
    return [...unique.values()].sort((a, b) => a.localeCompare(b, "es"));
  }, [titles, mappings, catalogProducts, favoriteProductIds]);

  const filteredTitles = allTitles.filter(title => storeProductTitleKey(title)
    .includes(storeProductTitleKey(search)));
  const products = useMemo(() => catalogProducts
    .filter(p => p.sku?.trim())
    .slice().sort((a, b) => a.title.localeCompare(b.title, "es")), [catalogProducts]);
  const favoriteSet = useMemo(() => new Set(favoriteProductIds), [favoriteProductIds]);
  const favoriteProducts = products.filter(p => favoriteSet.has(p.id));
  const otherProducts = products.filter(p => !favoriteSet.has(p.id));
  const matchesSkuSearch = (p: CatalogProduct) => {
    const needle = storeProductTitleKey(skuSearch);
    return !needle || storeProductTitleKey(p.title + " " + p.sku).includes(needle);
  };
  const mapByTitle = useMemo(() =>
    new Map(mappings.map(m => [m.title_key, m])), [mappings]);

  async function save(title: string, selectedSku: string) {
    const key = storeProductTitleKey(title);
    if (!email || !key || !selectedSku) return toast.error("Seleccioná un SKU válido.");
    const product = products.find(p => p.sku?.trim().toLowerCase() === selectedSku.trim().toLowerCase());
    if (!product) return toast.error("El SKU no está disponible en tu catálogo autorizado.");
    setSaving(key);
    try {
      const { error } = await supabase.from("product_title_mappings").upsert({
        owner_email: email, title_key: key, raw_title: title, sku: product.sku!.trim(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "owner_email,title_key" });
      if (error) throw error;
      await onMappingsChanged();
      toast.success("✅ Producto asociado al SKU " + product.sku);
    } catch (e: any) {
      toast.error("No se pudo guardar: " + (e?.message || "Error"));
    } finally { setSaving(null); }
  }

  async function remove(title: string) {
    const key = storeProductTitleKey(title);
    if (!email || !key) return;
    setSaving(key);
    try {
      const { error } = await supabase.from("product_title_mappings")
        .delete().eq("owner_email", email).eq("title_key", key);
      if (error) throw error;
      setChoices(prev => ({ ...prev, [key]: "" }));
      await onMappingsChanged();
      toast.success("Asociación eliminada");
    } catch (e: any) { toast.error(e?.message || "Error al eliminar"); }
    finally { setSaving(null); }
  }

  const associated = allTitles.filter(title => mapByTitle.has(storeProductTitleKey(title))).length;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-lg font-black">⚙️ Configuración de productos por SKU</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Asociá el nombre que aparece en los pedidos web con el SKU correcto de tu catálogo.
          Se guardará para todos los próximos pedidos de tu tienda. Primero se muestran los productos de tus Favoritos, únicamente si están disponibles en tu catálogo autorizado.
        </p>
        <p className="mt-2 text-xs text-primary font-semibold">⭐ {associated} de {allTitles.length} nombres asociados · {favoriteProducts.length} favoritos disponibles</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input className="app-input" placeholder="Buscar nombre de producto publicado o favorito…" value={search}
          onChange={e => setSearch(e.target.value)} />
        <span className="text-xs text-muted-foreground self-center">{filteredTitles.length} productos</span>
      </div>
      <div className="rounded-xl border border-border bg-secondary/20 p-3 space-y-2">
        <label className="block text-xs font-semibold">🔎 Buscar SKU del producto favorito</label>
        <input className="app-input w-full" placeholder="Escribí nombre o SKU para filtrar opciones…" value={skuSearch}
          onChange={e => setSkuSearch(e.target.value)} />
        {favoriteProductIds.length > favoriteProducts.length && (
          <p className="text-xs text-amber-500">{favoriteProductIds.length - favoriteProducts.length} favoritos no están disponibles en el catálogo actual; no se pueden asociar por seguridad.</p>
        )}
        {products.length === 0 && (
          <p className="text-xs text-amber-500">No se cargaron productos con SKU. Revisá tus favoritos y los permisos del catálogo.</p>
        )}
      </div>
      <form className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/20 p-3 sm:flex-row"
        onSubmit={e => {
          e.preventDefault();
          const title = manualTitle.trim();
          const key = storeProductTitleKey(title);
          if (!key) return;
          setTitles(old => old.some(t => storeProductTitleKey(t) === key) ? old : [title, ...old]);
          setSearch(title);
          setManualTitle("");
        }}>
        <input className="app-input flex-1" value={manualTitle} onChange={e => setManualTitle(e.target.value)}
          placeholder="Agregar nombre de producto de la página manualmente" maxLength={260} />
        <button className="nav-btn active" type="submit" disabled={!manualTitle.trim()}>+ Agregar nombre</button>
      </form>
      {loading ? <p className="text-sm text-muted-foreground">Consultando nombres de pedidos…</p> : null}
      {!loading && allTitles.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay productos. Publicá una página o agregá el nombre manualmente.</p>}
      <div className="space-y-2">
        {filteredTitles.map(title => {
          const key = storeProductTitleKey(title);
          const mapping = mapByTitle.get(key);
          const sku = choices[key] ?? mapping?.sku ?? "";
          const valid = products.some(p => p.sku?.trim().toLowerCase() === sku.trim().toLowerCase());
          return (
            <div key={key} className="rounded-xl border border-border bg-card p-3">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-bold">{title}</p>
                  <p className="text-xs text-muted-foreground">
                    {mapping ? "✅ Vinculado: " + mapping.sku : "⚠️ Sin asociación. Elegí un producto del catálogo."}
                  </p>
                </div>
                {mapping && <button type="button" className="nav-btn !py-1.5 !text-xs"
                  disabled={saving !== null} onClick={() => void remove(title)}>Quitar</button>}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select className="app-input min-w-0 flex-1" value={sku}
                  onChange={e => setChoices(prev => ({...prev, [key]: e.target.value}))}>
                  <option value="">Elegir producto y SKU…</option>
                  {mapping && !valid && <option value={mapping.sku}>⚠️ SKU anterior no disponible: {mapping.sku}</option>}
                  {favoriteProducts.length > 0 && (
                    <optgroup label="⭐ Mis favoritos">
                      {favoriteProducts.filter(p => matchesSkuSearch(p) || p.sku === sku)
                        .map(p => <option key={p.id} value={p.sku!}>{p.title} · {p.sku}</option>)}
                    </optgroup>
                  )}
                  {otherProducts.length > 0 && (
                    <optgroup label="Otros productos autorizados">
                      {otherProducts.filter(p => matchesSkuSearch(p) || p.sku === sku)
                        .map(p => <option key={p.id} value={p.sku!}>{p.title} · {p.sku}</option>)}
                    </optgroup>
                  )}
                </select>
                <button type="button" className="nav-btn active" disabled={!valid || saving !== null || sku === mapping?.sku}
                  onClick={() => void save(title, sku)}>
                  {saving === key ? "Guardando…" : "Guardar asociación"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
