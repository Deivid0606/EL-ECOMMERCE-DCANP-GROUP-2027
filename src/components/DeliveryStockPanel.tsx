import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * 📦 Stock disponible por delivery (Cierres). Respeta el filtro de deliverys y
 * proveedores de Cierres. Muestra lo que tiene en mano, lo comprometido en
 * pedidos «DESPACHADO POR REPARTIDOR» todavía sin entregar y lo libre.
 */

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(n || 0));
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
const OPEN_STATUSES = ['PENDIENTE', 'EN RUTA', 'REAGENDADO', 'NO CONTESTA'];

type Product = { id: string; title: string; sku: string | null; image_url: string | null; provider_email: string | null };

function Avatar({ name, logo }: { name: string; logo?: string | null }) {
  if (logo) return <img src={logo} alt={name} className="h-12 w-12 rounded-full border border-white/15 object-cover" />;
  const initials =
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') || 'DL';
  return <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/15 bg-slate-800 font-black text-white">{initials}</div>;
}

export default function DeliveryStockPanel({
  deliveries,
  providers,
  onlyProvider,
}: {
  /** Deliverys elegidos en el filtro (vacío = todos). */
  deliveries: string[];
  /** Proveedores elegidos en el filtro (vacío = todos). */
  providers: string[];
  /** Proveedor logueado: sólo sus productos. */
  onlyProvider?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [stock, setStock] = useState<{ delivery_email: string; product_id: string; quantity: number }[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [people, setPeople] = useState<Record<string, { name: string; logo: string | null }>>({});
  const [committed, setCommitted] = useState<Map<string, number>>(new Map());
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [s, p, o] = await Promise.all([
        (supabase as any).from('delivery_stock').select('delivery_email, product_id, quantity').gt('quantity', 0),
        supabase.from('products').select('id, title, sku, image_url, provider_email'),
        (supabase as any)
          .from('orders')
          .select('assigned_delivery, items_json, sku, product_id, pack_qty')
          .eq('stock_source', 'DELIVERY')
          .in('status', OPEN_STATUSES)
          .not('assigned_delivery', 'is', null)
          .limit(5000),
      ]);
      if (!alive) return;
      const prodMap = new Map<string, Product>(((p.data || []) as any[]).map((x) => [x.id, x]));
      const bySku = new Map<string, Product>(((p.data || []) as any[]).filter((x) => x.sku).map((x) => [lc(x.sku), x]));
      const byTitle = new Map<string, Product>(((p.data || []) as any[]).filter((x) => x.title).map((x) => [lc(x.title), x]));
      // Unidades comprometidas por delivery y producto (pedidos despachados por repartidor sin entregar).
      const com = new Map<string, number>();
      for (const ord of (o.data || []) as any[]) {
        let items: any[] = [];
        try {
          items = typeof ord.items_json === 'string' ? JSON.parse(ord.items_json) : ord.items_json || [];
        } catch {
          items = [];
        }
        if (!Array.isArray(items) || !items.length) items = [{ product_id: ord.product_id, sku: ord.sku, qty: ord.pack_qty || 1 }];
        for (const it of items) {
          const prod = (it.product_id && prodMap.get(it.product_id)) || bySku.get(lc(it.sku)) || byTitle.get(lc(it.title));
          if (!prod) continue;
          const key = `${lc(ord.assigned_delivery)}|${prod.id}`;
          com.set(key, (com.get(key) || 0) + (Number(it.qty || it.quantity || 1) || 1));
        }
      }
      const emails = [...new Set(((s.data || []) as any[]).map((r) => lc(r.delivery_email)))];
      let names: Record<string, { name: string; logo: string | null }> = {};
      if (emails.length) {
        const { data } = await supabase.from('profiles').select('email, name, logo_url').in('email', emails);
        names = Object.fromEntries((data || []).map((x: any) => [lc(x.email), { name: x.name || x.email, logo: x.logo_url || null }]));
      }
      if (!alive) return;
      setStock((s.data || []) as any[]);
      setProducts(prodMap);
      setCommitted(com);
      setPeople(names);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(() => {
    const wantDel = new Set(deliveries.map(lc));
    const wantProv = new Set(providers.map(lc));
    const q = lc(search);
    const map = new Map<string, { email: string; name: string; logo: string | null; total: number; committed: number; items: any[] }>();
    for (const row of stock) {
      const email = lc(row.delivery_email);
      if (wantDel.size && !wantDel.has(email)) continue;
      const prod = products.get(row.product_id);
      if (!prod) continue;
      const prov = lc(prod.provider_email);
      if (onlyProvider && prov !== lc(onlyProvider)) continue;
      if (wantProv.size && !wantProv.has(prov)) continue;
      const info = people[email];
      if (q && !lc(prod.title).includes(q) && !lc(prod.sku).includes(q) && !lc(info?.name || email).includes(q)) continue;
      const qty = Number(row.quantity || 0);
      const com = committed.get(`${email}|${prod.id}`) || 0;
      const g = map.get(email) || { email, name: info?.name || email, logo: info?.logo || null, total: 0, committed: 0, items: [] };
      g.total += qty;
      g.committed += Math.min(com, qty);
      g.items.push({ ...prod, qty, com, free: qty - com });
      map.set(email, g);
    }
    return [...map.values()]
      .map((g) => ({ ...g, items: g.items.sort((a, b) => b.qty - a.qty) }))
      .sort((a, b) => b.total - a.total);
  }, [stock, products, people, committed, deliveries, providers, onlyProvider, search]);

  const totalUnits = groups.reduce((s, g) => s + g.total, 0);

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-slate-950/70 p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">📦 Stock disponible por delivery</h2>
          <p className="text-xs font-semibold text-slate-400">
            Según el filtro de deliverys{providers.length || onlyProvider ? ' y proveedores' : ''}. <b className="text-amber-300">Comprometido</b> = en pedidos «Despachado por repartidor» todavía sin entregar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input className="app-input !w-56" placeholder="🔎 Buscar producto o delivery" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="rounded-xl bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-300">
            {groups.length} delivery(s) · {nf(totalUnits)} u.
          </span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl border border-white/10 bg-slate-900/60" />
          ))}
        </div>
      ) : groups.length ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {groups.map((d) => (
            <div key={d.email} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
              <div className="flex items-center gap-3 border-b border-white/10 p-4">
                <Avatar name={d.name} logo={d.logo} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-black">{d.name}</div>
                  <div className="truncate text-xs text-slate-500">{d.email}</div>
                </div>
                {d.committed > 0 && (
                  <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-center">
                    <div className="text-[10px] font-black uppercase text-amber-400">Comprom.</div>
                    <div className="text-xl font-black text-amber-300">{nf(d.committed)}</div>
                  </div>
                )}
                <div className="rounded-xl bg-cyan-500/10 px-3 py-2 text-center">
                  <div className="text-[10px] font-black uppercase text-cyan-400">Total</div>
                  <div className="text-xl font-black text-cyan-300">{nf(d.total)}</div>
                </div>
              </div>

              <div className="max-h-80 space-y-2 overflow-y-auto p-3">
                {d.items.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl bg-slate-800/70 p-3">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-slate-950">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.title} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">📦</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black">{p.title}</div>
                      <div className="truncate text-xs text-slate-500">SKU: {p.sku || 'Sin SKU'}</div>
                      {p.com > 0 && (
                        <div className="mt-0.5 text-[11px] font-bold text-amber-300">
                          {nf(p.com)} comprometido(s) · {p.free >= 0 ? `${nf(p.free)} libre(s)` : `⚠️ faltan ${nf(-p.free)}`}
                        </div>
                      )}
                    </div>
                    <div className={`rounded-xl px-3 py-2 text-center ${p.free < 0 ? 'bg-rose-500/10' : 'bg-emerald-500/10'}`}>
                      <div className={`text-[10px] font-black uppercase ${p.free < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>Disponible</div>
                      <div className={`text-xl font-black ${p.free < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{nf(p.qty)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-slate-500">
          No hay stock asignado {deliveries.length ? 'para los deliverys elegidos' : 'a deliverys'}.
        </div>
      )}
    </section>
  );
}
