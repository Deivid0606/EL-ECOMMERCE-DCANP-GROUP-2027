import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import QrCameraScanner, { orderIdFromQr } from '@/components/QrCameraScanner';
import { customerMessageVariant } from '@/lib/waMessages';
import { orderLocationText } from '@/lib/orderLocation';
import { ensureTrackingUrl } from '@/lib/tracking';

/**
 * 📷 QR Delivery: escanear la guía con la cámara desde la app.
 * - DELIVERY: el pedido se le asigna solo (EN RUTA) y puede seguir escaneando.
 * - ADMIN / PROVEEDOR / DESPACHANTE: ve el pedido y elige a qué delivery asignarlo.
 * También funciona si se abre el link del QR (#/qr?id=…).
 */

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(Number(n) || 0));
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type Order = {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  phone: string | null;
  city: string | null;
  street: string | null;
  status: string | null;
  status2: string | null;
  total_gs: number | null;
  items_json: any;
  assigned_delivery: string | null;
  assigned_at: string | null;
  qr_scanned_at?: string | null;
};
type Flash = { ok: boolean; title: string; lines: string[]; order?: any };
type ScanResult = {
  ok: boolean;
  id?: string;
  reason?: 'not_found' | 'already' | 'other_delivery' | 'not_yours' | 'closed';
  order_number?: string;
  customer_name?: string;
  city?: string;
  total_gs?: number;
  delivery?: string;
  scanned_at?: string;
  scanned_by?: string;
  status?: string;
  code?: string;
};
type Scan = { id: string; ok: boolean; text: string; at: number; order?: any };

const SELECT = 'id, order_number, customer_name, phone, city, street, status, status2, total_gs, items_json, assigned_delivery, assigned_at, qr_scanned_at';

async function findOrder(code: string): Promise<Order | null> {
  if (isUuid(code)) {
    const { data } = await supabase.from('orders').select(SELECT).eq('id', code).maybeSingle();
    if (data) return data as any;
  }
  const exact = await supabase.from('orders').select(SELECT).eq('order_number', code).maybeSingle();
  if (exact.data) return exact.data as any;
  const ci = await supabase.from('orders').select(SELECT).ilike('order_number', code).maybeSingle();
  if (ci.data) return ci.data as any;
  const ref = await (supabase as any).from('orders').select(SELECT).eq('source_ref', code).maybeSingle();
  return (ref.data as Order) || null;
}

const waPhone = (raw: string) => {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('595')) return d;
  if (d.startsWith('0')) return `595${d.slice(1)}`;
  if (d.startsWith('9') && d.length >= 9) return `595${d}`;
  return d;
};

const itemsOf = (o: Order) => {
  try {
    const raw = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : o.items_json;
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

export default function QRScannerView() {
  const { profile } = useAuth();
  const role = String(profile?.role || '').toUpperCase();
  const myEmail = lc(profile?.email);
  const isDelivery = role === 'DELIVERY';
  const canAssignOthers = ['ADMIN', 'PROVEEDOR', 'DESPACHANTE'].includes(role);

  const [busy, setBusy] = useState(false);
  const [scans, setScans] = useState<Scan[]>([]);
  const [current, setCurrent] = useState<Order | null>(null);
  const [deliveries, setDeliveries] = useState<{ email: string; name: string }[]>([]);
  const [target, setTarget] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Flash | null>(null);

  const nameOf = (email: string | null) => (email ? names[lc(email)] || deliveries.find((d) => d.email === lc(email))?.name || email : '');

  const log = (id: string, ok: boolean, text: string, order?: any) => setScans((prev) => [{ id, ok, text, at: Date.now(), order }, ...prev].slice(0, 30));

  // 💬 Abre WhatsApp con el cliente y el mismo mensaje de Cierres (detalle, ubicación y seguimiento).
  const writeClient = async (o: any) => {
    const raw = String(o?.customer_phone || o?.phone || '').trim();
    const phone = waPhone(raw);
    if (!phone) return toast.error('El pedido no tiene celular del cliente');
    // La pestaña se abre con el toque para que el celular no la bloquee; el link se completa enseguida.
    const tab = window.open('', '_blank');
    const now = new Date().toISOString();
    if (!o.contacted) {
      const patch = { contacted: true, contacted_at: now, contacted_by: myEmail };
      void supabase.from('orders').update({ ...patch, updated_at: now } as any).eq('id', o.id).then(() => undefined);
      setScans((prev) => prev.map((s) => (s.order?.id === o.id ? { ...s, order: { ...s.order, ...patch } } : s)));
      setFlash((f) => (f?.order?.id === o.id ? { ...f, order: { ...f.order, ...patch } } : f));
    }
    const track = await Promise.race([ensureTrackingUrl(o), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
    const text = customerMessageVariant(o, raw, Math.floor(Math.random() * 7), track, Boolean(orderLocationText(o)));
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    if (tab) tab.location.href = url;
    else window.location.href = url;
  };

  // Pedido completo después de asignarlo (para el mensaje al cliente).
  const loadFullOrder = async (res: ScanResult) => {
    let q: any = supabase.from('orders').select('*');
    q = res.id ? q.eq('id', res.id) : q.eq('order_number', res.order_number || '');
    const { data } = await q.maybeSingle();
    return data || null;
  };

  const when = (iso?: string) =>
    iso ? new Date(iso).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

  // Muestra el resultado grande en pantalla (y en la lista de escaneados).
  const showResult = useCallback((res: ScanResult, code: string, order?: any) => {
    const label = res.order_number || code;
    if (res.ok) {
      setFlash({
        ok: true,
        title: '✅ Pedido registrado exitosamente',
        lines: [label, [res.customer_name, res.city].filter(Boolean).join(' · '), `🛵 ${res.delivery || ''} · EN RUTA`],
        order,
      });
      log(label, true, [res.customer_name, res.city].filter(Boolean).join(' · '), order);
      return;
    }
    const msg =
      res.reason === 'already'
        ? { title: '⛔ Este pedido ya fue escaneado', lines: [label, `El ${when(res.scanned_at)} por ${res.scanned_by || '—'}`, `🛵 Asignado a ${res.delivery || '—'}`] }
        : res.reason === 'other_delivery'
          ? { title: '⛔ Pedido de otro delivery', lines: [label, `Está asignado a ${res.delivery || 'otro delivery'}`] }
          : res.reason === 'closed'
            ? { title: '⛔ Pedido cerrado', lines: [label, `Estado: ${res.status}`] }
            : res.reason === 'not_yours'
              ? { title: '⛔ No es un pedido tuyo', lines: [label] }
              : { title: '❌ Pedido no encontrado', lines: [label] };
    setFlash({ ok: false, ...msg });
    log(label, false, msg.title.replace(/^\S+\s/, ''));
  }, []);

  useEffect(() => {
    if (!flash) return;
    // Con el botón «Escribir al cliente» el cartel queda más tiempo.
    const t = window.setTimeout(() => setFlash(null), flash.ok ? (flash.order ? 9000 : 2500) : 4500);
    return () => window.clearTimeout(t);
  }, [flash]);

  // Delivery: el pedido escaneado se le asigna (una sola vez por QR).
  const assignToMe = useCallback(
    async (code: string) => {
      const { data, error } = await (supabase as any).rpc('scan_order_qr', { p_code: code });
      if (error) {
        toast.error(error.message);
        log(code, false, error.message);
        return;
      }
      const res = data as ScanResult;
      showResult(res, code, res.ok ? await loadFullOrder(res) : undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showResult],
  );

  const handleCode = useCallback(
    async (raw: string) => {
      const code = orderIdFromQr(raw);
      if (!code || busy) return;
      setBusy(true);
      try {
        if (isDelivery) await assignToMe(code);
        else {
          const order = await findOrder(code);
          if (!order) {
            toast.error(`❌ Pedido ${code} no encontrado`);
            log(code, false, 'No encontrado');
          } else {
            setCurrent(order);
            setTarget(lc(order.assigned_delivery));
            if (order.assigned_delivery && !names[lc(order.assigned_delivery)]) {
              const { data } = await supabase.from('profiles').select('email, name').ilike('email', order.assigned_delivery).maybeSingle();
              if (data) setNames((n) => ({ ...n, [lc(data.email)]: data.name || data.email }));
            }
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, isDelivery, assignToMe, names],
  );

  // Link del QR abierto con la cámara del celular: #/qr?id=…
  useEffect(() => {
    const m = window.location.hash.match(/[?&]id=([^&]+)/);
    if (m && profile?.email) {
      void handleCode(decodeURIComponent(m[1]));
      window.history.replaceState(null, '', window.location.pathname + window.location.search + window.location.hash.split('?')[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.email]);

  // Lista de deliverys para admin / proveedor / despachante.
  useEffect(() => {
    if (!canAssignOthers) return;
    (async () => {
      const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'DELIVERY').eq('approved', true);
      const ids = (roles || []).map((r: any) => r.user_id);
      if (!ids.length) return;
      const { data } = await supabase.from('profiles').select('email, name').in('user_id', ids);
      setDeliveries(
        (data || [])
          .filter((p: any) => p.email)
          .map((p: any) => ({ email: lc(p.email), name: p.name || p.email }))
          .sort((a, b) => a.name.localeCompare(b.name, 'es')),
      );
    })();
  }, [canAssignOthers]);

  const assignToTarget = async () => {
    if (!current || !target) return toast.error('Elegí un delivery');
    setBusy(true);
    const { data, error } = await (supabase as any).rpc('scan_order_qr', { p_code: current.id, p_delivery: target });
    setBusy(false);
    if (error) return toast.error(error.message);
    const res = data as ScanResult;
    showResult(res, current.order_number || current.id, res.ok ? await loadFullOrder({ ...res, id: res.id || current.id }) : undefined);
    setCurrent(null);
  };

  const okCount = scans.filter((s) => s.ok).length;

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-3xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/15 via-slate-900/60 to-violet-500/10 p-5 shadow-2xl">
        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300/80">QR Delivery</div>
        <h2 className="text-2xl font-black text-white">📷 Escanear guías</h2>
        <p className="mt-1 text-xs text-slate-400">
          {isDelivery
            ? 'Escaneá el QR de cada guía: el pedido se te asigna y queda EN RUTA. Podés escanear uno tras otro.'
            : 'Escaneá el QR de una guía para ver el pedido y asignarlo a un delivery.'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="relative">
          <QrCameraScanner onResult={(id) => void handleCode(id)} paused={busy || Boolean(current) || Boolean(flash)} />
          {flash && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => setFlash(null)}
              className={`absolute inset-x-0 top-0 mx-auto flex aspect-square w-full max-w-md flex-col items-center justify-center gap-2 rounded-3xl p-6 text-center shadow-2xl backdrop-blur-sm ${
                flash.ok ? 'bg-emerald-600/90' : 'bg-rose-700/90'
              }`}
            >
              <div className="text-6xl">{flash.ok ? '✅' : '⛔'}</div>
              <div className="text-xl font-black text-white">{flash.title.replace(/^\S+\s/, '')}</div>
              {flash.lines.filter(Boolean).map((l, i) => (
                <div key={i} className={i === 0 ? 'text-2xl font-black text-white' : 'text-sm font-semibold text-white/90'}>
                  {l}
                </div>
              ))}
              {flash.ok && flash.order && (
                <button
                  type="button"
                  className="mt-3 rounded-2xl bg-white px-6 py-3 text-base font-black text-emerald-700 shadow-xl"
                  onClick={(e) => {
                    e.stopPropagation();
                    void writeClient(flash.order);
                  }}
                >
                  💬 Escribir al cliente{flash.order.contacted ? ' (✅ ya contactado)' : ''}
                </button>
              )}
              <div className="mt-2 text-[11px] text-white/70">Tocá afuera del botón para seguir escaneando</div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {current && (
            <div className="rounded-3xl border border-violet-500/30 bg-slate-950/70 p-4 shadow-xl">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-violet-300">Pedido escaneado</div>
                  <div className="text-xl font-black text-white">{current.order_number}</div>
                </div>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-black text-slate-200">{current.status || 'PENDIENTE'}</span>
              </div>
              <div className="mt-2 space-y-0.5 text-sm text-slate-300">
                <div>👤 {current.customer_name} · {current.phone}</div>
                <div>📍 {current.city}{current.street ? ` · ${current.street}` : ''}</div>
                {itemsOf(current).map((it: any, i: number) => (
                  <div key={i}>📦 {it.title || it.sku} ×{it.qty || it.quantity || 1}</div>
                ))}
                <div className="font-black text-white">💰 Gs {nf(Number(current.total_gs || 0))}</div>
                {current.assigned_delivery && <div className="text-amber-300">🛵 Asignado a {nameOf(current.assigned_delivery)}</div>}
                {current.qr_scanned_at && (
                  <div className="font-bold text-rose-300">⛔ Ya fue escaneado el {when(current.qr_scanned_at)}: no se puede volver a registrar.</div>
                )}
              </div>
              <select className="app-input mt-3" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Elegí el delivery…</option>
                {deliveries.map((d) => (
                  <option key={d.email} value={d.email}>
                    {d.name}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex gap-2">
                <button type="button" className="nav-btn active flex-1" disabled={busy || !target || Boolean(current.qr_scanned_at)} onClick={() => void assignToTarget()}>
                  🚚 Asignar y poner EN RUTA
                </button>
                <button type="button" className="nav-btn" onClick={() => setCurrent(null)}>
                  Escanear otro
                </button>
              </div>
            </div>
          )}

          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Escaneados en esta sesión</div>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-black text-emerald-300">✅ {okCount}</span>
            </div>
            {scans.length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no escaneaste ninguna guía.</p>
            ) : (
              <div className="max-h-80 space-y-1.5 overflow-y-auto">
                {scans.map((s, i) => (
                  <div key={`${s.id}-${s.at}-${i}`} className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ${s.ok ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
                    <span className="min-w-0 truncate">
                      {s.ok ? '✅' : '❌'} <b>{s.id}</b> <span className="text-xs text-slate-400">{s.text}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {s.ok && s.order && (
                        <button
                          type="button"
                          className={`rounded-lg px-2 py-1 text-[11px] font-black ${s.order.contacted ? 'bg-emerald-500/20 text-emerald-200' : 'bg-green-600 text-white'}`}
                          onClick={() => void writeClient(s.order)}
                          title="Escribir al cliente por WhatsApp"
                        >
                          {s.order.contacted ? '✅ 💬' : '💬 Escribir'}
                        </button>
                      )}
                      <span className="text-[10px] text-slate-500">{new Date(s.at).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
