import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type Line = { sku: string; qty: number; sale_gs: number };
type CatalogProduct = { sku: string; title: string; provider_price_gs: number | null };
type OrderDetails = {
  customer_name: string; phone: string; email: string;
  city: string; departamento: string; street: string; district: string;
  obs: string; guide_number: string; shipping_type: string;
};
const DETAILS_FIELDS: { key: keyof OrderDetails; label: string; required?: boolean; wide?: boolean }[] = [
  { key: 'customer_name', label: 'Cliente', required: true },
  { key: 'phone', label: 'Teléfono', required: true },
  { key: 'email', label: 'Correo electrónico' },
  { key: 'city', label: 'Ciudad', required: true },
  { key: 'departamento', label: 'Departamento' },
  { key: 'street', label: 'Dirección / calle', wide: true },
  { key: 'district', label: 'Barrio' },
  { key: 'guide_number', label: 'Número de guía' },
];

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(Number(n) || 0));
const digits = (v: unknown) => String(v || '').replace(/\D/g, '').replace(/^595/, '').replace(/^0+/, '');

// sale_gs es el total de la línea. Algunos pedidos importados guardan el precio
// por unidad: si así cuadra con el total del pedido, se pasa a total de línea.
export const readItems = (order: any): Line[] => {
  try {
    const items = typeof order?.items_json === 'string' ? JSON.parse(order.items_json) : order?.items_json || [];
    const lines = (items as any[]).map((it) => ({ sku: String(it.sku || ''), qty: Number(it.qty || 1), sale_gs: Number(it.sale_gs || 0) }));
    const total = Number(order?.total_gs || 0);
    const asLine = lines.reduce((s, l) => s + l.sale_gs, 0);
    const asUnit = lines.reduce((s, l) => s + l.sale_gs * l.qty, 0);
    if (total && Math.abs(total - asLine) >= 1 && Math.abs(total - asUnit) < 1) {
      return lines.map((l) => ({ ...l, sale_gs: l.sale_gs * l.qty }));
    }
    return lines;
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
  const [details, setDetails] = useState<OrderDetails>({customer_name:'',phone:'',email:'',city:'',departamento:'',street:'',district:'',obs:'',guide_number:'',shipping_type:'DELIVERY'});
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
    setDetails({
      customer_name: String(order?.customer_name || ''),
      phone: String(order?.phone || ''), email: String(order?.email || ''),
      city: String(order?.city || ''), departamento: String(order?.departamento || ''),
      street: String(order?.street || ''), district: String(order?.district || ''),
      obs: String(order?.obs || ''), guide_number: String(order?.guide_number || ''),
      shipping_type: String(order?.shipping_type || 'DELIVERY'),
    });
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
    if (!details.customer_name.trim() || !details.phone.trim() || !details.city.trim()) {
      toast.error('Nombre, teléfono y ciudad son obligatorios');
      return;
    }
    if (details.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim())) {
      toast.error('Ingresá un correo válido o dejalo vacío');
      return;
    }
    if (clean.some(l => !Number.isFinite(l.qty) || l.qty < 1 || !Number.isInteger(l.qty)
      || !Number.isFinite(l.sale_gs) || l.sale_gs < 0) || !Number.isFinite(delivery) || delivery < 0) {
      toast.error('Revisá las cantidades, precios y costo de delivery');
      return;
    }
    setSaving(true);
    let data: any, error: any;
    try {
      const result = await (supabase as any).rpc('edit_dispatch_order', {
        p_order_id: editing.id,
        p_details: Object.fromEntries(
          Object.entries(details).map(([key, value]) => [key, String(value).trim()])
        ),
        p_items: clean.map(l => ({ sku: l.sku.trim(), qty: Number(l.qty), sale_gs: Number(l.sale_gs) })),
        p_delivery_gs: Number(delivery),
      });
      data = result.data;
      error = result.error;
    } catch (err: any) {
      error = err;
    } finally {
      setSaving(false);
    }
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
            Editá los datos del cliente, la entrega, la guía y los productos del pedido.
            Los cambios se guardan juntos y quedan registrados en el historial.
          </p>
          <section className="mb-4 rounded-xl border border-border p-3">
            <h5 className="mb-3 text-sm font-bold">👤 Cliente y entrega</h5>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {DETAILS_FIELDS.map(field => (
                <label key={field.key} className={field.wide ? 'sm:col-span-2' : ''}>
                  <span className="mb-1 block text-xs font-semibold">
                    {field.label}{field.required ? ' *' : ''}
                  </span>
                  <input className="app-input w-full" value={details[field.key]}
                    onChange={e => setDetails(prev => ({...prev,[field.key]:e.target.value}))} />
                </label>
              ))}
              <label>
                <span className="mb-1 block text-xs font-semibold">Tipo de envío</span>
                <select className="app-input w-full" value={details.shipping_type}
                  onChange={e => setDetails(prev => ({...prev,shipping_type:e.target.value}))}>
                  <option value="DELIVERY">Delivery</option>
                  <option value="ENCOMIENDA">Encomienda</option>
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold">Observaciones</span>
                <textarea className="app-input w-full min-h-[80px]" value={details.obs}
                  onChange={e => setDetails(prev => ({...prev,obs:e.target.value}))} />
              </label>
            </div>
          </section>
          <h5 className="mb-2 text-sm font-bold">📦 Productos, cantidades y precios</h5>
          <p className="mb-3 text-xs text-muted-foreground">
            El precio ingresado es el total de la línea, no el precio unitario.
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
            No se editan pedidos entregados, rendidos, con comisión acreditada/pagada o stock descontado.
            Los cambios de producto y delivery recalculan total y comisión de forma segura.
          </p>
        </div>
      </div>,
      document.body,
    );

  return { openEditor, mergeOrders, modal };
}
