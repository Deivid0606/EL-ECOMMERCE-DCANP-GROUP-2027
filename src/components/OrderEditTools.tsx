import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type Line = { sku: string; qty: number; sale_gs: number };
type CatalogProduct = { sku: string; title: string; provider_price_gs: number | null };

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(Number(n) || 0));
const digits = (v: unknown) => String(v || '').replace(/\D/g, '').replace(/^595/, '').replace(/^0+/, '');

const readItems = (order: any): Line[] => {
  try {
    const items = typeof order?.items_json === 'string' ? JSON.parse(order.items_json) : order?.items_json || [];
    return (items as any[]).map((it) => ({ sku: String(it.sku || ''), qty: Number(it.qty || 1), sale_gs: Number(it.sale_gs || 0) }));
  } catch {
    return [];
  }
};

/**
 * ✏️ Editar productos / cantidades / precios de un pedido y 🔗 fusionar pedidos
 * del mismo cliente. El servidor recalcula total, comisión y delivery.
 */
export function useOrderEditTools(onDone: () => void) {
  const [editing, setEditing] = useState<any | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [delivery, setDelivery] = useState(0);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing || catalog.length) return;
    (async () => {
      const all: CatalogProduct[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await (supabase as any).from('products').select('sku, title, provider_price_gs').range(from, from + 999);
        all.push(...((data || []) as CatalogProduct[]).filter((p) => p.sku));
        if ((data || []).length < 1000) break;
      }
      setCatalog(all);
    })();
  }, [editing, catalog.length]);

  const bySku = useMemo(() => new Map(catalog.map((p) => [String(p.sku).trim().toLowerCase(), p])), [catalog]);

  const openEditor = (order: any) => {
    setEditing(order);
    setLines(readItems(order));
    setDelivery(Number(order?.delivery_gs || 0));
  };

  const preview = useMemo(() => {
    const sale = lines.reduce((s, l) => s + (Number(l.sale_gs) || 0), 0);
    const provider = lines.reduce((s, l) => s + Number(bySku.get(l.sku.trim().toLowerCase())?.provider_price_gs || 0) * (Number(l.qty) || 0), 0);
    return { sale, provider, commission: sale - provider - (Number(delivery) || 0) };
  }, [lines, delivery, bySku]);

  const save = async () => {
    if (!editing) return;
    const clean = lines.filter((l) => l.sku.trim());
    if (!clean.length) {
      toast.error('El pedido necesita al menos un producto');
      return;
    }
    const unknown = clean.find((l) => catalog.length && !bySku.get(l.sku.trim().toLowerCase()));
    if (unknown) {
      toast.error(`No existe el SKU "${unknown.sku}"`);
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase as any).rpc('edit_order_items', {
      p_order_id: editing.id,
      p_items: clean.map((l) => ({ sku: l.sku.trim(), qty: Number(l.qty), sale_gs: Number(l.sale_gs) })),
      p_delivery_gs: Number(delivery),
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`✏️ Pedido ${editing.order_number} actualizado · Total Gs ${nf(data?.total)} · Comisión Gs ${nf(data?.commission)}`);
    setEditing(null);
    onDone();
  };

  const mergeOrders = async (orders: any[]) => {
    if (orders.length < 2) {
      toast.error('Seleccioná al menos 2 pedidos del mismo cliente para fusionar');
      return;
    }
    const sellers = new Set(orders.map((o) => String(o.created_by || '').toLowerCase()));
    if (sellers.size > 1) {
      toast.error('Sólo se pueden fusionar pedidos del mismo vendedor');
      return;
    }
    const phones = new Set(orders.map((o) => digits(o.phone)).filter(Boolean));
    const names = [...new Set(orders.map((o) => String(o.customer_name || '').trim()))];
    const total = orders.reduce((s, o) => s + Number(o.total_gs || 0), 0);
    const deliveries = orders.reduce((s, o) => s + Number(o.delivery_gs || 0), 0);
    const sorted = [...orders].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const keep = sorted[0];
    const kept = Number(keep.delivery_gs || 0) || Math.max(...orders.map((o) => Number(o.delivery_gs || 0)));
    const warning = phones.size > 1 ? '\n\n⚠️ OJO: los celulares NO coinciden. Verificá que sea el mismo cliente.' : '';
    if (
      !window.confirm(
        `🔗 Fusionar ${orders.length} pedidos en ${keep.order_number}\n\n` +
          `Cliente: ${names.join(' / ')}\n` +
          `Pedidos: ${sorted.map((o) => o.order_number).join(', ')}\n` +
          `Total: Gs ${nf(total)}\n` +
          `Delivery: se cobra UNO (Gs ${nf(kept)}) en vez de Gs ${nf(deliveries)} → el vendedor gana Gs ${nf(deliveries - kept)} más de comisión.\n\n` +
          `Los otros pedidos se eliminan (su historial pasa a ${keep.order_number}).${warning}`,
      )
    )
      return;
    const { data, error } = await (supabase as any).rpc('merge_orders', { p_order_ids: orders.map((o) => o.id) });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      `🔗 Fusionado en ${data?.order_number}: total Gs ${nf(data?.total)}, un delivery (Gs ${nf(data?.delivery)}), comisión Gs ${nf(data?.commission)}`,
      { duration: 9000 },
    );
    onDone();
  };

  const modal =
    editing &&
    createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={() => !saving && setEditing(null)}>
        <div
          className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-background p-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <h4 className="text-lg font-black">✏️ Editar pedido {editing.order_number}</h4>
            <button type="button" className="nav-btn !px-2 !py-1 text-xs" onClick={() => setEditing(null)} disabled={saving}>
              ✕
            </button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            {editing.customer_name} · {editing.city}. Cambiá cantidades, precios o agregá / quitá productos. <b>El precio es el total de la línea</b>{' '}
            (ej. 2 unidades por Gs 129.000 → 129.000).
          </p>

          <datalist id="dcanp-edit-skus">
            {catalog.map((p) => (
              <option key={p.sku} value={p.sku}>
                {p.title}
              </option>
            ))}
          </datalist>

          <div className="space-y-2">
            {lines.map((l, i) => {
              const p = bySku.get(l.sku.trim().toLowerCase());
              return (
                <div key={i} className="rounded-xl border border-border p-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_70px_120px_auto] items-center gap-2">
                    <input
                      list="dcanp-edit-skus"
                      className="app-input !py-2 text-sm"
                      placeholder="SKU del producto"
                      value={l.sku}
                      onChange={(e) =>
                        setLines((prev) => prev.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))
                      }
                    />
                    <input
                      type="number"
                      min={1}
                      className="app-input !py-2 text-sm"
                      value={l.qty}
                      onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))}
                      title="Cantidad"
                    />
                    <input
                      type="number"
                      min={0}
                      className="app-input !py-2 text-sm"
                      value={l.sale_gs}
                      onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, sale_gs: Number(e.target.value) } : x)))}
                      title="Precio total de la línea (Gs)"
                    />
                    <button
                      type="button"
                      className="nav-btn !px-2 !py-1 text-xs"
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                      title="Quitar producto"
                    >
                      🗑️
                    </button>
                  </div>
                  <div className={`mt-1 truncate text-[11px] ${p || !catalog.length ? 'text-muted-foreground' : 'text-rose-400'}`}>
                    {p ? `${p.title} · proveedor Gs ${nf(Number(p.provider_price_gs || 0))} c/u` : catalog.length ? 'SKU no encontrado' : 'Cargando catálogo…'}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="nav-btn mt-2 w-full"
            onClick={() => setLines((prev) => [...prev, { sku: '', qty: 1, sale_gs: 0 }])}
          >
            ➕ Agregar producto
          </button>

          <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-xl bg-secondary/40 p-2">
              <div className="text-[10px] text-muted-foreground">Total venta</div>
              <div className="font-black">Gs {nf(preview.sale)}</div>
            </div>
            <div className="rounded-xl bg-secondary/40 p-2">
              <div className="text-[10px] text-muted-foreground">Proveedor</div>
              <div className="font-black">Gs {nf(preview.provider)}</div>
            </div>
            <label className="rounded-xl bg-secondary/40 p-2">
              <div className="text-[10px] text-muted-foreground">Delivery (cobrado al vendedor)</div>
              <input
                type="number"
                min={0}
                className="w-full bg-transparent font-black outline-none"
                value={delivery}
                onChange={(e) => setDelivery(Number(e.target.value))}
              />
            </label>
            <div className="rounded-xl bg-emerald-500/10 p-2">
              <div className="text-[10px] text-muted-foreground">Comisión vendedor</div>
              <div className={`font-black ${preview.commission < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>Gs {nf(preview.commission)}</div>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="nav-btn" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="nav-btn active" onClick={() => void save()} disabled={saving}>
              {saving ? 'Guardando…' : '💾 Guardar cambios'}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            No se puede editar un pedido entregado, rendido, con comisión pagada o que ya bajó stock. Queda registrado en el historial.
          </p>
        </div>
      </div>,
      document.body,
    );

  return { openEditor, mergeOrders, modal };
}
