import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { motoIcon } from '@/components/RoutePage';
import { useRescheduleDialog } from '@/components/RescheduleDialog';
import { customerMessageVariant } from '@/lib/waMessages';
import { orderLocationText } from '@/lib/orderLocation';
import { distanceKm, ensureTrackingUrl, orderCoordsFromText, type LatLng } from '@/lib/tracking';
import { cleanLocationError, requireDeliveryLocation } from '@/lib/requireLocation';

/**
 * 🗺️ Mi ruta (delivery): mapa con todos sus pedidos del día, en el orden más corto
 * desde donde está, con lo que tiene que cobrar y lo que gana. Tipo app de reparto:
 * tocás una parada, ves el detalle y desde ahí navegás, llamás, escribís o la marcás.
 */

const sb = supabase as any;
const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(Number(n) || 0));
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
const norm = (v: unknown) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
const OPEN = ['PENDIENTE', 'EN RUTA', 'NO CONTESTA', 'REAGENDADO'];
const DONE_OK = ['ENTREGADO', 'ENCOMIENDA ENTREGADA'];
const OTHER_STATUSES = ['NO CONTESTA', 'REAGENDADO', 'CANCELADO', 'CANCELÓ POR WHATSAPP'];
const GEO_KEY = 'dcanp_route_geo_v1';
const POLL_MS = 60_000;

type Coord = LatLng & { level: 'exact' | 'street' | 'city' };
type RouteOrder = {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  phone: string | null;
  city: string | null;
  departamento: string | null;
  street: string | null;
  district: string | null;
  obs: string | null;
  items_json: any;
  total_gs: number | null;
  delivery_fee_gs: number | null;
  status: string | null;
  assigned_delivery: string | null;
  assigned_at: string | null;
  delivered_at: string | null;
  contacted: boolean | null;
  shipping_type: string | null;
  dest: LatLng | null;
};

const statusOf = (o: RouteOrder) => String(o.status || 'PENDIENTE').toUpperCase();
const isOpen = (o: RouteOrder) => OPEN.includes(statusOf(o));
const itemsOf = (o: RouteOrder): any[] => {
  try {
    const raw = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : o.items_json;
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};
const waPhone = (raw: string) => {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('595')) return d;
  if (d.startsWith('0')) return `595${d.slice(1)}`;
  if (d.startsWith('9') && d.length >= 9) return `595${d}`;
  return d;
};
const addressOf = (o: RouteOrder) => [o.street, o.district].map((v) => String(v || '').trim()).filter(Boolean).join(' · ');

const readGeoCache = (): Record<string, Coord> => {
  try {
    return JSON.parse(localStorage.getItem(GEO_KEY) || '{}') || {};
  } catch {
    return {};
  }
};
const writeGeoCache = (c: Record<string, Coord>) => {
  try {
    localStorage.setItem(GEO_KEY, JSON.stringify(c));
  } catch {
    /* sin storage */
  }
};

const STATE_COLOR = (o: RouteOrder) => {
  const s = statusOf(o);
  if (DONE_OK.includes(s)) return '#10b981';
  if (!OPEN.includes(s)) return '#f43f5e';
  if (s === 'NO CONTESTA') return '#f59e0b';
  if (s === 'REAGENDADO') return '#38bdf8';
  return '#8c5cff';
};

const pinIcon = (label: string, color: string, active: boolean) =>
  L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))">
      <div style="min-width:${active ? 34 : 28}px;height:${active ? 34 : 28}px;padding:0 4px;border-radius:999px;background:${color};border:${active ? 3 : 2}px solid #fff;color:#fff;font:800 ${active ? 14 : 12}px/${active ? 28 : 24}px system-ui;text-align:center">${label}</div>
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${color};margin-top:-1px"></div>
    </div>`,
    iconSize: [0, 0],
  });

/** Orden más corto aproximado: siempre la parada más cercana a la anterior. */
function nearestOrder<T extends { coord: Coord | null }>(stops: T[], start: LatLng | null): T[] {
  const withC = stops.filter((s) => s.coord);
  const without = stops.filter((s) => !s.coord);
  const out: T[] = [];
  let cur: LatLng | null = start || (withC[0]?.coord ?? null);
  const left = [...withC];
  while (left.length) {
    let best = 0;
    if (cur) {
      let bd = Infinity;
      left.forEach((s, i) => {
        const d = distanceKm(cur as LatLng, s.coord as LatLng);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
    }
    const [next] = left.splice(best, 1);
    out.push(next);
    cur = next.coord;
  }
  return [...out, ...without];
}

export default function MyRouteView() {
  const { profile } = useAuth();
  const me = lc(profile?.email);
  const [orders, setOrders] = useState<RouteOrder[]>([]);
  const [fees, setFees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState<Record<string, Coord>>(() => readGeoCache());
  const [locating, setLocating] = useState(0);
  const [myPos, setMyPos] = useState<LatLng | null>(null);
  const [tab, setTab] = useState<'route' | 'done'>('route');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const reschedule = useRescheduleDialog(() => setReload((n) => n + 1));

  // Pedidos + tarifas.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = async () => {
      const [r, f] = await Promise.all([sb.rpc('my_route_orders'), sb.rpc('get_closure_delivery_fees')]);
      if (!alive) return;
      if (r.error) toast.error(r.error.message);
      setOrders((r.data || []) as RouteOrder[]);
      setFees(f.data || []);
      setLoading(false);
      timer = window.setTimeout(load, POLL_MS);
    };
    void load();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [reload]);

  // Mi ubicación en vivo (si el celular la comparte).
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setMyPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 20_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Ubicación de cada pedido: la cargada en el seguimiento, un link de Maps del pedido,
  // la calle o, al menos, el centro de la ciudad.
  useEffect(() => {
    let alive = true;
    const missing = orders.filter((o) => !o.dest && !coords[o.id]);
    if (!missing.length) return;
    (async () => {
      const next = { ...coords };
      for (const o of missing.slice(0, 40)) {
        if (!alive) return;
        setLocating(missing.length - missing.indexOf(o));
        let c: Coord | null = null;
        const fromText = orderLocationText(o) ? await orderCoordsFromText(o).catch(() => null) : null;
        if (fromText) c = { ...fromText, level: 'exact' };
        else {
          const { data } = await sb.rpc('route_geocode', { p_order_id: o.id });
          if (data?.lat) c = { lat: Number(data.lat), lng: Number(data.lng), level: data.level === 'street' ? 'street' : 'city' };
        }
        if (c) {
          next[o.id] = c;
          if (alive) setCoords({ ...next });
        }
      }
      writeGeoCache(next);
      if (alive) setLocating(0);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const feeOf = useCallback(
    (o: RouteOrder) => {
      const frozen = Number(o.delivery_fee_gs || 0);
      if (frozen > 0) return frozen;
      const m = fees.find((f: any) => norm(f.delivery_email) === norm(o.assigned_delivery) && norm(f.city) === norm(o.city));
      return Number(m?.fee_gs || 0);
    },
    [fees],
  );

  // Coordenada final (los de la misma ciudad sin calle se separan un poco para que se vean).
  const coordOf = useMemo(() => {
    const seen: Record<string, number> = {};
    const out: Record<string, Coord | null> = {};
    for (const o of orders) {
      const c: Coord | null = o.dest ? { ...o.dest, level: 'exact' } : coords[o.id] || null;
      if (c && c.level === 'city') {
        const k = `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;
        const n = (seen[k] = (seen[k] || 0) + 1) - 1;
        const ang = n * 2.4;
        const r = n ? 0.0025 * Math.sqrt(n) : 0;
        out[o.id] = { ...c, lat: c.lat + r * Math.cos(ang), lng: c.lng + r * Math.sin(ang) };
      } else out[o.id] = c;
    }
    return out;
  }, [orders, coords]);

  const stops = useMemo(() => {
    const open = orders.filter(isOpen).map((o) => ({ o, coord: coordOf[o.id] }));
    return nearestOrder(open, myPos).map((s, i) => ({ ...s, n: i + 1 }));
  }, [orders, coordOf, myPos]);
  const done = useMemo(() => orders.filter((o) => !isOpen(o)), [orders]);

  const kpi = useMemo(() => {
    const open = orders.filter(isOpen);
    const ok = orders.filter((o) => DONE_OK.includes(statusOf(o)));
    return {
      pending: open.length,
      delivered: ok.length,
      toCollect: open.reduce((s, o) => s + Number(o.total_gs || 0), 0),
      collected: ok.reduce((s, o) => s + Number(o.total_gs || 0), 0),
      earned: ok.reduce((s, o) => s + feeOf(o), 0),
      possible: open.reduce((s, o) => s + feeOf(o), 0),
      km: stops.reduce(
        (acc, s, i) => {
          const prev = i === 0 ? myPos : stops[i - 1].coord;
          return prev && s.coord ? acc + distanceKm(prev, s.coord) * 1.35 : acc;
        },
        0,
      ),
    };
  }, [orders, stops, feeOf, myPos]);

  // Mapa.
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    mapRef.current = L.map(mapEl.current, { zoomControl: false }).setView([-25.2867, -57.647], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapRef.current);
    L.control.zoom({ position: 'topright' }).addTo(mapRef.current);
    layer.current = L.layerGroup().addTo(mapRef.current);
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layer.current) return;
    layer.current.clearLayers();
    const pts: L.LatLngExpression[] = [];
    const line: L.LatLngExpression[] = myPos ? [[myPos.lat, myPos.lng]] : [];
    if (myPos) {
      L.marker([myPos.lat, myPos.lng], { icon: motoIcon('Vos'), zIndexOffset: 1000 }).addTo(layer.current);
      pts.push([myPos.lat, myPos.lng]);
    }
    const list = tab === 'route' ? stops.map((s) => ({ o: s.o, label: String(s.n), coord: s.coord })) : done.map((o) => ({ o, label: DONE_OK.includes(statusOf(o)) ? '✓' : '✕', coord: coordOf[o.id] }));
    for (const s of list) {
      if (!s.coord) continue;
      const active = selected === s.o.id;
      L.marker([s.coord.lat, s.coord.lng], { icon: pinIcon(s.label, STATE_COLOR(s.o), active), zIndexOffset: active ? 900 : 0 })
        .on('click', () => {
          setSelected(s.o.id);
          cardRefs.current[s.o.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        })
        .addTo(layer.current);
      pts.push([s.coord.lat, s.coord.lng]);
      if (tab === 'route') line.push([s.coord.lat, s.coord.lng]);
    }
    if (line.length > 1) L.polyline(line, { color: '#8c5cff', weight: 4, opacity: 0.75, dashArray: '8 8' }).addTo(layer.current);
    if (!fitted.current && pts.length) {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
      fitted.current = true;
    }
  }, [stops, done, coordOf, myPos, selected, tab]);

  const focus = (o: RouteOrder) => {
    setSelected(o.id);
    const c = coordOf[o.id];
    if (c) mapRef.current?.setView([c.lat, c.lng], Math.max(mapRef.current.getZoom(), 15), { animate: true });
  };

  const fitAll = () => {
    const pts: L.LatLngExpression[] = [];
    if (myPos) pts.push([myPos.lat, myPos.lng]);
    stops.forEach((s) => s.coord && pts.push([s.coord.lat, s.coord.lng]));
    if (pts.length) mapRef.current?.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
  };

  // Navegación: con coordenadas exactas o de calle va al punto; si no, busca la dirección escrita.
  const navTarget = (o: RouteOrder) => {
    const c = coordOf[o.id];
    if (c && c.level !== 'city') return `${c.lat},${c.lng}`;
    return encodeURIComponent([o.street, o.city, 'Paraguay'].filter(Boolean).join(', '));
  };
  const openGoogle = (o: RouteOrder) => window.open(`https://www.google.com/maps/dir/?api=1&destination=${navTarget(o)}&travelmode=driving`, '_blank');
  const openWaze = (o: RouteOrder) => {
    const c = coordOf[o.id];
    const url = c && c.level !== 'city' ? `https://waze.com/ul?ll=${c.lat},${c.lng}&navigate=yes` : `https://waze.com/ul?q=${navTarget(o)}&navigate=yes`;
    window.open(url, '_blank');
  };
  const startFullRoute = () => {
    const pts = stops.filter((s) => s.coord).map((s) => navTarget(s.o));
    if (!pts.length) return toast.error('No hay paradas con ubicación');
    const dest = pts[Math.min(pts.length, 10) - 1];
    const way = pts.slice(0, Math.min(pts.length, 10) - 1);
    const origin = myPos ? `&origin=${myPos.lat},${myPos.lng}` : '';
    window.open(
      `https://www.google.com/maps/dir/?api=1${origin}&destination=${dest}${way.length ? `&waypoints=${way.join('%7C')}` : ''}&travelmode=driving`,
      '_blank',
    );
    if (pts.length > 10) toast.info('Google Maps acepta 10 paradas a la vez: abrí la ruta de nuevo después de las primeras.');
  };

  const writeClient = async (o: RouteOrder) => {
    const raw = String(o.phone || '').trim();
    const phone = waPhone(raw);
    if (!phone) return toast.error('El pedido no tiene celular');
    const tab = window.open('', '_blank');
    if (!o.contacted) {
      const now = new Date().toISOString();
      void supabase.from('orders').update({ contacted: true, contacted_at: now, contacted_by: me, updated_at: now } as any).eq('id', o.id).then(() => undefined);
      setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, contacted: true } : x)));
    }
    const track = await Promise.race([ensureTrackingUrl(o), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
    const text = customerMessageVariant(o, raw, Math.floor(Math.random() * 7), track, Boolean(orderLocationText(o)));
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    if (tab) tab.location.href = url;
    else window.location.href = url;
  };

  const setStatus = async (o: RouteOrder, status: string) => {
    if (status === 'REAGENDADO') {
      if (!(await requireDeliveryLocation())) return;
      reschedule.ask([o.id]);
      return;
    }
    let message: string | null = null;
    if (['NO CONTESTA', 'CANCELADO', 'CANCELÓ POR WHATSAPP'].includes(status)) {
      message = window.prompt(`${status}: contá qué pasó (obligatorio)`)?.trim() || '';
      if (!message) return toast.error('Escribí el motivo');
    } else if (!window.confirm(`¿Marcar ${o.order_number} como ${status}?`)) return;
    if (!(await requireDeliveryLocation())) return;
    setBusy(o.id);
    const { error } = await sb.rpc('bulk_update_order_status', {
      p_order_ids: [o.id],
      p_status: status,
      p_message: message,
      p_attachment_url: null,
    } as any);
    setBusy(null);
    if (error) return toast.error(cleanLocationError(error.message), { duration: 12000 });
    toast.success(status === 'ENTREGADO' ? `✅ ${o.order_number} entregado · +Gs ${nf(feeOf(o))}` : `${o.order_number}: ${status}`);
    setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, status, delivered_at: status === 'ENTREGADO' ? new Date().toISOString() : x.delivered_at } : x)));
    setSelected(null);
    setReload((n) => n + 1);
  };

  const next = stops[0];
  const list = tab === 'route' ? stops : done.map((o) => ({ o, coord: coordOf[o.id], n: 0 }));

  return (
    <div className="w-full min-w-0 space-y-3">
      {/* Encabezado tipo app de reparto */}
      <div className="rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-600/25 via-slate-900/70 to-orange-500/10 p-4 text-white shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-violet-300">Mi ruta de hoy</div>
            <div className="text-2xl font-black">
              🛵 {kpi.pending} parada{kpi.pending === 1 ? '' : 's'}
              {kpi.km > 0 && <span className="ml-2 text-sm font-bold text-slate-300">≈ {kpi.km.toFixed(1)} km</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="nav-btn !px-3" onClick={() => setReload((n) => n + 1)} title="Actualizar">
              🔄
            </button>
            <button
              className="rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-black text-white shadow-lg disabled:opacity-50"
              disabled={!stops.length}
              onClick={startFullRoute}
            >
              🧭 Iniciar ruta
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['💵 A cobrar', `Gs ${nf(kpi.toCollect)}`, 'text-amber-200'],
            ['✅ Cobrado hoy', `Gs ${nf(kpi.collected)}`, 'text-emerald-300'],
            ['💰 Gané hoy', `Gs ${nf(kpi.earned)}`, 'text-emerald-300'],
            ['🎯 Por ganar', `Gs ${nf(kpi.possible)}`, 'text-violet-200'],
          ].map(([l, v, c]) => (
            <div key={l} className="rounded-2xl bg-black/30 px-3 py-2">
              <div className="text-[10px] font-black uppercase text-slate-400">{l}</div>
              <div className={`text-lg font-black ${c}`}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        {/* Mapa */}
        <div className="relative min-w-0 overflow-hidden rounded-3xl border border-white/10 shadow-2xl">
          <div ref={mapEl} className="h-[52vh] w-full lg:h-[calc(100vh-260px)]" style={{ minHeight: 320 }} />
          <div className="pointer-events-none absolute left-3 top-3 z-[500] flex flex-col gap-1">
            {!myPos && <span className="rounded-full bg-black/70 px-3 py-1 text-[11px] font-bold text-amber-200">📍 Activá la ubicación para ordenar desde donde estás</span>}
            {locating > 0 && <span className="rounded-full bg-black/70 px-3 py-1 text-[11px] font-bold text-white">Ubicando pedidos… ({locating})</span>}
          </div>
          <button className="absolute right-14 top-3 z-[500] rounded-full bg-black/70 px-3 py-1.5 text-xs font-bold text-white" onClick={fitAll}>
            ⤢ Ver todo
          </button>
          {next && tab === 'route' && (
            <button
              className="absolute inset-x-3 bottom-3 z-[500] flex items-center gap-3 rounded-2xl bg-slate-950/90 p-3 text-left text-white shadow-2xl backdrop-blur"
              onClick={() => {
                focus(next.o);
                cardRefs.current[next.o.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 font-black">1</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-black uppercase tracking-wider text-violet-300">Próxima parada</span>
                <span className="block truncate font-black">{next.o.customer_name}</span>
                <span className="block truncate text-xs text-slate-400">
                  {next.o.city}
                  {myPos && next.coord ? ` · ${(distanceKm(myPos, next.coord) * 1.35).toFixed(1)} km` : ''}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-[10px] text-slate-400">Cobrar</span>
                <span className="block font-black text-amber-200">Gs {nf(Number(next.o.total_gs || 0))}</span>
              </span>
            </button>
          )}
        </div>

        {/* Paradas */}
        <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/70 p-3 shadow-xl">
          <div className="mb-2 flex gap-2">
            <button className={`nav-btn flex-1 ${tab === 'route' ? 'active' : ''}`} onClick={() => setTab('route')}>
              🛵 Por entregar ({stops.length})
            </button>
            <button className={`nav-btn flex-1 ${tab === 'done' ? 'active' : ''}`} onClick={() => setTab('done')}>
              ✅ Hechos hoy ({done.length})
            </button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-900/70" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 py-10 text-center text-sm text-slate-500">
              {tab === 'route' ? '🎉 No tenés pedidos pendientes. Escaneá o tomá pedidos para empezar.' : 'Todavía no cerraste pedidos hoy.'}
            </div>
          ) : (
            <div className="space-y-2 lg:max-h-[calc(100vh-260px)] lg:overflow-y-auto lg:pr-1">
              {list.map(({ o, coord, n }) => {
                const active = selected === o.id;
                const items = itemsOf(o);
                const fee = feeOf(o);
                const st = statusOf(o);
                return (
                  <div
                    key={o.id}
                    ref={(el) => (cardRefs.current[o.id] = el)}
                    onClick={() => focus(o)}
                    className={`cursor-pointer rounded-2xl border p-3 transition ${active ? 'border-violet-400 bg-violet-500/10 shadow-lg' : 'border-white/10 bg-slate-900/70'}`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black text-white"
                        style={{ background: STATE_COLOR(o) }}
                      >
                        {tab === 'route' ? n : DONE_OK.includes(st) ? '✓' : '✕'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-black text-white">{o.customer_name || 'Cliente'}</span>
                          <span className="shrink-0 text-right font-black text-amber-200">Gs {nf(Number(o.total_gs || 0))}</span>
                        </div>
                        <div className="truncate text-xs text-slate-300">
                          📍 {o.city}
                          {addressOf(o) ? ` · ${addressOf(o)}` : ''}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-200">{o.order_number}</span>
                          <span className="rounded-full px-2 py-0.5 text-white" style={{ background: `${STATE_COLOR(o)}cc` }}>
                            {st}
                          </span>
                          {fee > 0 && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">Ganás Gs {nf(fee)}</span>}
                          {o.contacted && <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-green-300">💬 contactado</span>}
                          {!coord && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-300">sin ubicación</span>}
                          {coord?.level === 'city' && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">ubicación aproximada</span>}
                          {myPos && coord && tab === 'route' && <span className="text-slate-400">{(distanceKm(myPos, coord) * 1.35).toFixed(1)} km</span>}
                        </div>
                      </div>
                    </div>

                    {active && (
                      <div className="mt-3 space-y-2 border-t border-white/10 pt-3" onClick={(e) => e.stopPropagation()}>
                        <div className="text-xs text-slate-300">
                          {items.map((it, i) => (
                            <div key={i}>
                              📦 {it.title || it.sku} ×{it.qty || it.quantity || 1}
                            </div>
                          ))}
                          <div className="mt-1">🏠 {[o.street, o.district, o.city].filter(Boolean).join(' · ') || 'Sin dirección'}</div>
                          {o.phone && <div className="mt-1">📱 {o.phone}</div>}
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          <button className="rounded-xl bg-blue-600 px-2 py-2 text-xs font-black text-white" onClick={() => openGoogle(o)}>
                            🧭 Ir
                          </button>
                          <button className="rounded-xl bg-sky-500 px-2 py-2 text-xs font-black text-white" onClick={() => openWaze(o)}>
                            Waze
                          </button>
                          <a className="rounded-xl bg-slate-700 px-2 py-2 text-center text-xs font-black text-white" href={`tel:${String(o.phone || '').replace(/[^\d+]/g, '')}`}>
                            📞 Llamar
                          </a>
                          <button className="rounded-xl bg-green-600 px-2 py-2 text-xs font-black text-white" onClick={() => void writeClient(o)}>
                            💬 WhatsApp
                          </button>
                        </div>
                        {isOpen(o) && (
                          <div className="flex gap-1.5">
                            <button
                              className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-3 py-2.5 text-sm font-black text-white shadow-lg disabled:opacity-50"
                              disabled={busy === o.id}
                              onClick={() => void setStatus(o, 'ENTREGADO')}
                            >
                              {busy === o.id ? 'Guardando…' : '✅ Entregado'}
                            </button>
                            <select
                              className="app-input !w-28 shrink-0 !py-2 text-xs"
                              value=""
                              disabled={busy === o.id}
                              onChange={(e) => e.target.value && void setStatus(o, e.target.value)}
                            >
                              <option value="">Otro…</option>
                              {OTHER_STATUSES.filter((s) => s !== statusOf(o)).map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {reschedule.modal}
    </div>
  );
}
