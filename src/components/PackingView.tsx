import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import ImageUploadField from '@/components/ImageUploadField';

/**
 * 📦 Empaquetado: el despachante marca los pedidos empaquetados, ve cuántos hizo por día,
 * solicita el cobro (se separa por proveedor) y el proveedor / admin lo aprueba en Comisiones.
 */

const sb = supabase as any;
const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(Number(n) || 0));
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
const pyDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(d);
const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('es-PY', { timeZone: 'America/Asuncion', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDay = (v: string) => {
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-PY', { weekday: 'short', day: '2-digit', month: '2-digit' });
};

/** Marca o desmarca pedidos como empaquetados. Devuelve true si cambió alguno. */
export async function packOrders(ids: string[], packed = true): Promise<boolean> {
  if (!ids.length) return false;
  const { data, error } = await sb.rpc('mark_orders_packed', { p_ids: ids, p_packed: packed });
  if (error) {
    toast.error(error.message);
    return false;
  }
  const ok = Number(data?.ok || 0);
  const skipped = Number(data?.skipped || 0);
  if (ok) {
    toast.success(
      `${ok} pedido${ok > 1 ? 's' : ''} ${packed ? 'marcado' : 'desmarcado'}${ok > 1 ? 's' : ''} como empaquetado${ok > 1 ? 's' : ''}` +
        (skipped ? ` · ${skipped} omitido${skipped > 1 ? 's' : ''} (${packed ? 'ya empaquetados o sin permiso' : 'ya cobrados o de otro despachante'})` : ''),
    );
  } else {
    toast.error(packed ? 'Esos pedidos ya estaban empaquetados (o no tenés permiso).' : 'No se pudo desmarcar: ya se pidió el cobro o lo empaquetó otro.');
  }
  return ok > 0;
}

type PackedOrder = {
  id: string;
  packed_at?: string | null;
  packed_by?: string | null;
  packing_gs?: number | null;
  packing_request_id?: string | null;
  packing_paid_at?: string | null;
};

/** Etiqueta «📦 Empaquetado · Gs 3.500» (la ven vendedor, proveedor, despachante y admin). */
export function PackingBadge({ order, compact = false }: { order: PackedOrder; compact?: boolean }) {
  if (!order.packed_at) return null;
  const state = order.packing_paid_at ? '✅ pagado' : order.packing_request_id ? '⏳ cobro solicitado' : '';
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-orange-400/40 bg-orange-500/15 px-2 py-0.5 text-[10px] font-black text-orange-200"
      title={`Empaquetado ${fmtDateTime(order.packed_at)} por ${order.packed_by || '—'}`}
    >
      📦 Empaquetado · Gs {nf(Number(order.packing_gs || 0))}
      {!compact && state && <span className="font-bold text-orange-300/80">· {state}</span>}
    </span>
  );
}

/** Botón por pedido: marca / desmarca empaquetado. */
export function PackButton({ order, onChanged }: { order: PackedOrder; onChanged?: () => void }) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const role = profile?.role || '';
  if (!['ADMIN', 'DESPACHANTE', 'PROVEEDOR'].includes(role)) return null;
  const packed = Boolean(order.packed_at);
  const locked = packed && (order.packing_request_id || order.packing_paid_at || (role !== 'ADMIN' && lc(order.packed_by) !== lc(profile?.email)));
  if (locked) return null;
  return (
    <button
      type="button"
      disabled={busy}
      className={`nav-btn !px-2 !py-1 !text-[11px] ${packed ? '' : '!bg-orange-500 !text-white'}`}
      title={packed ? 'Quitar la marca de empaquetado' : 'Marcar este pedido como empaquetado'}
      onClick={async () => {
        if (packed && !window.confirm('¿Quitar la marca de empaquetado de este pedido?')) return;
        setBusy(true);
        const changed = await packOrders([order.id], !packed);
        setBusy(false);
        if (changed) onChanged?.();
      }}
    >
      {busy ? '…' : packed ? '↩️ Desempaquetar' : '📦 Empaquetado'}
    </button>
  );
}

type Req = {
  id: string;
  dispatcher_email: string;
  provider_email: string;
  qty: number;
  total_gs: number;
  status: 'PENDIENTE' | 'PAGADO' | 'RECHAZADO';
  note: string | null;
  receipt_url: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

function useNames(emails: string[]) {
  const [names, setNames] = useState<Record<string, string>>({});
  const key = [...new Set(emails.map(lc).filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void (async () => {
      const { data } = await supabase.from('profiles').select('email, name').in('email', key.split(','));
      if (alive) setNames(Object.fromEntries((data || []).map((p: any) => [lc(p.email), p.name || p.email])));
    })();
    return () => {
      alive = false;
    };
  }, [key]);
  return (e: string) => names[lc(e)] || e || '—';
}

const statusChip = (s: Req['status']) =>
  s === 'PAGADO'
    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
    : s === 'RECHAZADO'
      ? 'border-rose-400/40 bg-rose-500/15 text-rose-300'
      : 'border-amber-400/40 bg-amber-500/15 text-amber-300';
const statusLabel = (s: Req['status']) => (s === 'PAGADO' ? '✅ Pagado' : s === 'RECHAZADO' ? '❌ Rechazado' : '⏳ Pendiente');

function RequestDetailModal({ req, onClose, name }: { req: Req; onClose: () => void; name: (e: string) => string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    void (async () => {
      const { data, error } = await sb.rpc('packing_request_orders', { p_request: req.id });
      if (error) toast.error(error.message);
      setRows(data || []);
    })();
  }, [req.id]);
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <div className="text-lg font-black">📦 {req.qty} empaque(s) · Gs {nf(req.total_gs)}</div>
            <div className="text-xs text-slate-400">
              {name(req.dispatcher_email)} → {name(req.provider_email)} · {fmtDateTime(req.created_at)}
            </div>
          </div>
          <button className="nav-btn !px-3" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-3">
          {rows === null ? (
            <div className="py-8 text-center text-slate-400">Cargando…</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="p-2">Pedido</th>
                  <th className="p-2">Cliente</th>
                  <th className="p-2">Estado</th>
                  <th className="p-2">Empaquetado</th>
                  <th className="p-2 text-right">Gs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="p-2 font-bold">{r.order_number}</td>
                    <td className="p-2">
                      {r.customer_name}
                      <div className="text-[10px] text-slate-500">{r.city}</div>
                    </td>
                    <td className="p-2">{r.status}</td>
                    <td className="p-2">{fmtDateTime(r.packed_at)}</td>
                    <td className="p-2 text-right font-bold">{nf(r.packing_gs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {req.receipt_url && (
            <a href={req.receipt_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-bold text-sky-300 underline">
              🧾 Ver comprobante
            </a>
          )}
          {req.note && <p className="mt-2 text-xs text-slate-400">Nota: {req.note}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Solicitudes de cobro de empaques: en Comisiones (admin / proveedor) y en la pestaña del despachante. */
export function PackingRequestsPanel({ mode }: { mode: 'approve' | 'mine' }) {
  const { profile } = useAuth();
  const me = lc(profile?.email);
  const isAdmin = profile?.role === 'ADMIN';
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'PENDIENTE' | 'PAGADO' | 'RECHAZADO' | 'TODOS'>(mode === 'approve' ? 'PENDIENTE' : 'TODOS');
  const [detail, setDetail] = useState<Req | null>(null);
  const [paying, setPaying] = useState<Req | null>(null);
  const [receipt, setReceipt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = sb.from('packing_requests').select('*').order('created_at', { ascending: false }).limit(500);
    if (mode === 'mine') q = q.eq('dispatcher_email', me);
    else if (!isAdmin) q = q.eq('provider_email', me);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setReqs((data || []) as Req[]);
    setLoading(false);
  }, [mode, me, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const name = useNames(reqs.flatMap((r) => [r.dispatcher_email, r.provider_email]));
  const shown = reqs.filter((r) => filter === 'TODOS' || r.status === filter);
  const pendingTotal = reqs.filter((r) => r.status === 'PENDIENTE').reduce((s, r) => s + Number(r.total_gs || 0), 0);
  const paidTotal = reqs.filter((r) => r.status === 'PAGADO').reduce((s, r) => s + Number(r.total_gs || 0), 0);

  const resolve = async (r: Req, paid: boolean, extra?: { note?: string; receipt?: string }) => {
    setBusy(true);
    const { error } = await sb.rpc('resolve_packing_request', {
      p_id: r.id,
      p_paid: paid,
      p_note: extra?.note || null,
      p_receipt: extra?.receipt || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(paid ? `Pagado: ${r.qty} empaque(s) quedaron marcados como pagados` : 'Solicitud rechazada: los empaques vuelven a quedar por cobrar');
    setPaying(null);
    setReceipt('');
    setNote('');
    void load();
  };

  return (
    <section className="rounded-2xl border border-orange-500/25 bg-slate-950/70 p-4 text-slate-100">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">📦 {mode === 'approve' ? 'Cobros de empaques' : 'Mis solicitudes de cobro'}</h3>
          <p className="text-xs text-slate-400">
            {mode === 'approve'
              ? 'Solicitudes de los despachantes. Al aprobar, esos empaques quedan pagados.'
              : 'Cada solicitud es de un proveedor: él (o el admin) la aprueba y queda pagada.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-black text-amber-300">⏳ Pendiente Gs {nf(pendingTotal)}</span>
          <span className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-300">✅ Pagado Gs {nf(paidTotal)}</span>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(['PENDIENTE', 'PAGADO', 'RECHAZADO', 'TODOS'] as const).map((f) => (
          <button key={f} className={`nav-btn !py-1 !text-xs ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'TODOS' ? 'Todas' : statusLabel(f)} ({f === 'TODOS' ? reqs.length : reqs.filter((r) => r.status === f).length})
          </button>
        ))}
        <button className="nav-btn !py-1 !text-xs" onClick={() => void load()}>
          🔄
        </button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-slate-400">Cargando…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-slate-500">No hay solicitudes.</div>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-slate-900/70 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-black">
                  {mode === 'approve' ? `🧑‍🔧 ${name(r.dispatcher_email)}` : `🏬 ${name(r.provider_email) || 'Sin proveedor'}`}
                  {mode === 'approve' && isAdmin && <span className="ml-2 text-xs font-bold text-slate-400">→ {name(r.provider_email) || 'Sin proveedor'}</span>}
                </div>
                <div className="text-xs text-slate-400">
                  {r.qty} empaque(s) · solicitado {fmtDateTime(r.created_at)}
                  {r.resolved_at && ` · resuelto ${fmtDateTime(r.resolved_at)}`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-black text-orange-200">Gs {nf(r.total_gs)}</div>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusChip(r.status)}`}>{statusLabel(r.status)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button className="nav-btn !px-2 !py-1 !text-xs" onClick={() => setDetail(r)}>
                  👁️ Ver pedidos
                </button>
                {mode === 'approve' && r.status === 'PENDIENTE' && (isAdmin || lc(r.provider_email) === me) && (
                  <>
                    <button className="nav-btn !bg-emerald-600 !px-2 !py-1 !text-xs !text-white" disabled={busy} onClick={() => setPaying(r)}>
                      ✅ Marcar pagado
                    </button>
                    <button
                      className="nav-btn !bg-rose-600/80 !px-2 !py-1 !text-xs !text-white"
                      disabled={busy}
                      onClick={() => {
                        const why = window.prompt('Motivo del rechazo (opcional):') ?? null;
                        if (why === null) return;
                        void resolve(r, false, { note: why });
                      }}
                    >
                      ❌ Rechazar
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && <RequestDetailModal req={detail} name={name} onClose={() => setDetail(null)} />}
      {paying &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onClick={() => setPaying(null)}>
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950 p-5 text-slate-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 text-lg font-black">✅ Marcar como pagado</div>
              <div className="mb-4 text-sm text-slate-400">
                {name(paying.dispatcher_email)} · {paying.qty} empaque(s) · <b className="text-orange-200">Gs {nf(paying.total_gs)}</b>
              </div>
              <ImageUploadField label="Comprobante (opcional)" value={receipt} onChange={setReceipt} />
              <label className="app-label mt-3">Nota (opcional)</label>
              <input className="app-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. transferencia" />
              <div className="mt-4 flex justify-end gap-2">
                <button className="nav-btn" onClick={() => setPaying(null)}>
                  Cancelar
                </button>
                <button className="nav-btn !bg-emerald-600 !text-white" disabled={busy} onClick={() => void resolve(paying, true, { note, receipt })}>
                  {busy ? 'Guardando…' : 'Confirmar pago'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}

/** Precio por empaque: el proveedor el suyo, el admin el de todos. */
function PackingRatesPanel() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'ADMIN';
  const me = lc(profile?.email);
  const [providers, setProviders] = useState<{ email: string; name: string }[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [all, setAll] = useState('3500');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const { data: r } = await sb.from('packing_rates').select('provider_email, price_gs');
    setRates(Object.fromEntries((r || []).map((x: any) => [lc(x.provider_email), Number(x.price_gs)])));
    if (isAdmin) {
      const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'PROVEEDOR' as any).eq('approved', true);
      const ids = (roles || []).map((x: any) => x.user_id);
      if (ids.length) {
        const { data: ps } = await supabase.from('profiles').select('email, name').in('user_id', ids);
        setProviders(
          (ps || [])
            .filter((p: any) => p.email)
            .map((p: any) => ({ email: lc(p.email), name: p.name || p.email }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
    } else {
      setProviders([{ email: me, name: profile?.name || me }]);
    }
  }, [isAdmin, me, profile?.name]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (provider: string | null, value: string) => {
    const price = Number(String(value).replace(/\D/g, ''));
    if (!Number.isFinite(price)) return toast.error('Precio inválido');
    const { data, error } = await sb.rpc('set_packing_rate', { p_provider: provider, p_price: price });
    if (error) return toast.error(error.message);
    toast.success(provider ? `Precio guardado: Gs ${nf(price)} por empaque` : `Gs ${nf(price)} para ${data} proveedor(es)`);
    setDraft({});
    void load();
  };

  const list = providers.filter((p) => !q || lc(p.name).includes(lc(q)) || p.email.includes(lc(q)));

  return (
    <section className="rounded-2xl border border-sky-500/25 bg-slate-950/70 p-4 text-slate-100">
      <h3 className="text-lg font-black">💲 Precio por empaque</h3>
      <p className="mb-3 text-xs text-slate-400">
        Lo que se le paga al despachante por cada pedido empaquetado. Si no se cargó, vale Gs 3.500. Los empaques ya hechos mantienen su precio.
      </p>
      {isAdmin && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-slate-900/60 p-3">
          <div>
            <label className="app-label">Mismo precio para todos los proveedores</label>
            <input className="app-input !w-40" inputMode="numeric" value={all} onChange={(e) => setAll(e.target.value)} />
          </div>
          <button
            className="nav-btn active"
            onClick={() => {
              if (window.confirm(`¿Poner Gs ${nf(Number(all.replace(/\D/g, '')))} por empaque a TODOS los proveedores?`)) void save(null, all);
            }}
          >
            Aplicar a todos
          </button>
          <input className="app-input ml-auto !w-56" placeholder="🔎 Buscar proveedor" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => {
          const current = rates[p.email] ?? 3500;
          const value = draft[p.email] ?? String(current);
          return (
            <div key={p.email} className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black">{p.name}</div>
                <div className="truncate text-[10px] text-slate-500">{p.email}</div>
              </div>
              <span className="text-xs text-slate-400">Gs</span>
              <input
                className="app-input !w-24 !py-1 text-right"
                inputMode="numeric"
                value={value}
                onChange={(e) => setDraft((d) => ({ ...d, [p.email]: e.target.value }))}
              />
              <button className="nav-btn !px-2 !py-1 !text-xs" disabled={Number(value.replace(/\D/g, '')) === current} onClick={() => void save(p.email, value)}>
                💾
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Pestaña «📦 Cobro de empaques». */
export default function PackingView() {
  const { profile } = useAuth();
  const role = profile?.role || '';
  const isAdmin = role === 'ADMIN';
  const isDisp = role === 'DESPACHANTE';
  const [tab, setTab] = useState<'resumen' | 'cobro' | 'precios'>(isDisp ? 'cobro' : 'resumen');
  const today = pyDate();
  const [from, setFrom] = useState(pyDate(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      const { data, error } = await sb.rpc('packing_summary', { p_from: from, p_to: to });
      if (!alive) return;
      if (error) toast.error(error.message);
      setRows(data || []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [from, to, reload]);

  useEffect(() => {
    void (async () => {
      const { data, error } = await sb.rpc('my_unrequested_packings');
      if (error) toast.error(error.message);
      setPending(data || []);
    })();
  }, [reload]);

  const name = useNames([...rows.flatMap((r) => [r.packed_by, r.provider_email]), ...pending.map((p) => p.provider_email)]);

  const days = useMemo(() => {
    const map = new Map<string, { day: string; qty: number; total: number; people: Map<string, { qty: number; total: number }> }>();
    for (const r of rows) {
      const d = map.get(r.day) || { day: r.day, qty: 0, total: 0, people: new Map() };
      d.qty += Number(r.qty);
      d.total += Number(r.total_gs);
      const k = isDisp ? r.provider_email : r.packed_by;
      const p = d.people.get(k) || { qty: 0, total: 0 };
      p.qty += Number(r.qty);
      p.total += Number(r.total_gs);
      d.people.set(k, p);
      map.set(r.day, d);
    }
    return [...map.values()].sort((a, b) => b.day.localeCompare(a.day));
  }, [rows, isDisp]);

  const kpi = useMemo(
    () => ({
      qty: rows.reduce((s, r) => s + Number(r.qty), 0),
      total: rows.reduce((s, r) => s + Number(r.total_gs), 0),
      requested: rows.reduce((s, r) => s + Number(r.requested_gs), 0),
      paid: rows.reduce((s, r) => s + Number(r.paid_gs), 0),
      today: rows.filter((r) => r.day === today).reduce((s, r) => s + Number(r.qty), 0),
    }),
    [rows, today],
  );

  const pendingByProvider = useMemo(() => {
    const m = new Map<string, { qty: number; total: number }>();
    for (const p of pending) {
      const x = m.get(p.provider_email) || { qty: 0, total: 0 };
      x.qty += 1;
      x.total += Number(p.packing_gs);
      m.set(p.provider_email, x);
    }
    return [...m.entries()];
  }, [pending]);
  const pendingTotal = pending.reduce((s, p) => s + Number(p.packing_gs), 0);

  const requestPayment = async () => {
    if (!window.confirm(`¿Solicitar el cobro de ${pending.length} empaque(s) por Gs ${nf(pendingTotal)}?`)) return;
    setBusy(true);
    const { data, error } = await sb.rpc('request_packing_payment');
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Cobro solicitado: Gs ${nf(data?.total_gs)} (${data?.requests} solicitud(es), una por proveedor)`);
    setReload((n) => n + 1);
  };

  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'cobro', label: '💰 Cobrar empaques' },
    { id: 'resumen', label: '📊 Empaques por día' },
    ...(isAdmin || role === 'PROVEEDOR' ? [{ id: 'precios' as const, label: '💲 Precio por empaque' }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="app-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">📦 Cobro de empaques</h2>
            <p className="text-xs text-slate-400">
              Cada pedido marcado «📦 Empaquetado» en Despacho suma al despachante el precio de empaque del proveedor.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button key={t.id} className={`nav-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'cobro' && (
        <>
          <section className="rounded-2xl border border-orange-500/30 bg-gradient-to-br from-orange-500/15 to-slate-950 p-5 text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-orange-300">Por cobrar</div>
                <div className="text-4xl font-black">Gs {nf(pendingTotal)}</div>
                <div className="text-sm text-slate-300">{pending.length} empaque(s) sin solicitar</div>
              </div>
              <button
                className="rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-3 text-base font-black text-white shadow-lg disabled:opacity-50"
                disabled={busy || pending.length === 0}
                onClick={() => void requestPayment()}
              >
                {busy ? 'Enviando…' : '💰 Solicitar cobro'}
              </button>
            </div>
            {pendingByProvider.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {pendingByProvider.map(([prov, v]) => (
                  <span key={prov} className="rounded-xl bg-black/30 px-3 py-1.5 text-xs font-bold">
                    🏬 {name(prov) || 'Sin proveedor'}: {v.qty} · Gs {nf(v.total)}
                  </span>
                ))}
              </div>
            )}
            {pending.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-bold text-orange-200">Ver los {pending.length} pedidos</summary>
                <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                  {pending.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-black/25 px-3 py-1.5 text-xs">
                      <span>
                        <b>{p.order_number}</b> · {p.customer_name} · <span className="text-slate-400">{p.status}</span>
                      </span>
                      <span className="whitespace-nowrap text-slate-300">
                        {fmtDateTime(p.packed_at)} · <b>Gs {nf(p.packing_gs)}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
          <PackingRequestsPanel mode="mine" />
        </>
      )}

      {tab === 'resumen' && (
        <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-slate-100">
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div>
              <label className="app-label">Desde</label>
              <input type="date" className="app-input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="app-label">Hasta</label>
              <input type="date" className="app-input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button className="nav-btn" onClick={() => { setFrom(today); setTo(today); }}>Hoy</button>
            <button className="nav-btn" onClick={() => { setFrom(pyDate(new Date(Date.now() - 6 * 86400000))); setTo(today); }}>7 días</button>
            <button className="nav-btn" onClick={() => { setFrom(today.slice(0, 8) + '01'); setTo(today); }}>Este mes</button>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            {[
              ['📦 Hoy', nf(kpi.today), 'text-orange-200'],
              ['📦 En el período', nf(kpi.qty), 'text-orange-200'],
              ['💰 Monto', `Gs ${nf(kpi.total)}`, 'text-white'],
              ['⏳ Solicitado', `Gs ${nf(kpi.requested)}`, 'text-amber-300'],
              ['✅ Pagado', `Gs ${nf(kpi.paid)}`, 'text-emerald-300'],
            ].map(([l, v, c]) => (
              <div key={l} className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
                <div className="text-[10px] font-black uppercase text-slate-400">{l}</div>
                <div className={`text-xl font-black ${c}`}>{v}</div>
              </div>
            ))}
          </div>
          {loading ? (
            <div className="py-8 text-center text-slate-400">Cargando…</div>
          ) : days.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-slate-500">No hay empaques en estas fechas.</div>
          ) : (
            <div className="space-y-2">
              {days.map((d) => (
                <div key={d.day} className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-black capitalize">
                      {fmtDay(d.day)} {d.day === today && <span className="ml-1 rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] text-orange-200">HOY</span>}
                    </div>
                    <div className="text-sm font-black">
                      📦 {d.qty} · <span className="text-orange-200">Gs {nf(d.total)}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[...d.people.entries()]
                      .sort((a, b) => b[1].qty - a[1].qty)
                      .map(([k, v]) => (
                        <span key={k} className="rounded-lg bg-black/30 px-2 py-1 text-[11px]">
                          {isDisp ? '🏬' : '🧑‍🔧'} {name(k) || 'Sin proveedor'}: <b>{v.qty}</b> · Gs {nf(v.total)}
                        </span>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'precios' && <PackingRatesPanel />}
    </div>
  );
}
