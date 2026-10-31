import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { motoIcon, stopIcon, STOP_STYLE } from '@/components/RoutePage';
import { editOrderLocation, generateRouteLink } from '@/lib/tracking';

type Money = { total: number; fee: number; commission: number; delivery_charged: number; provider_price: number; real_cost: number };
type LiveOrder = {
  id: string;
  order_number: string | null;
  seq: number | null;
  status: string | null;
  customer: string | null;
  city: string | null;
  phone: string | null;
  total_gs: number | null;
  updated_at: string;
  delivered_at: string | null;
  money: Money | null;
  dest: { lat: number; lng: number } | null;
};
type Driver = {
  email: string;
  name: string;
  location: { lat: number; lng: number; updated_at: string } | null;
  trail: [number, number][];
  orders: LiveOrder[];
};
type Notice = { id: string; icon: string; title: string; text: string; color: string; at: number; pos: L.LatLngExpression | null };
type Stats = {
  orders: number;
  delivered: number;
  route: number;
  pending: number;
  failed: number;
  recaudado: number;
  porCobrar: number;
  gananciaDelivery: number;
  rendir: number;
  gananciaProveedor: number;
  gananciaEmpresa: number;
};

const POLL_MS = 8_000;
const DRIVER_COLORS = ['#8c5cff', '#0ea5e9', '#f97316', '#10b981', '#e11d48', '#eab308', '#14b8a6', '#6366f1'];
const TILES = {
  calles: { label: '🗺️ Calles', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '© OpenStreetMap' },
  claro: { label: '☀️ Claro', url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attr: '© OpenStreetMap © CARTO' },
  oscuro: { label: '🌙 Oscuro', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr: '© OpenStreetMap © CARTO' },
  satelite: {
    label: '🛰️ Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© Esri',
  },
} as const;
type TileKey = keyof typeof TILES;

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(n || 0));
const gs = (n: number) => `Gs ${nf(n)}`;

const stateOf = (status: string | null) => {
  const s = String(status || '').toUpperCase();
  if (s === 'ENTREGADO' || s === 'ENCOMIENDA ENTREGADA') return 'delivered' as const;
  if (s === 'EN RUTA') return 'route' as const;
  if (['CANCELADO', 'CANCELÓ POR WHATSAPP', 'NO DESEA', 'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'DEVUELTO A DEPÓSITO'].includes(s)) return 'failed' as const;
  return 'pending' as const;
};

const secondsAgo = (iso?: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)) : Infinity);
const ago = (iso?: string | null) => {
  const s = secondsAgo(iso);
  if (!Number.isFinite(s)) return 'sin ubicación';
  return s < 60 ? `hace ${s}s` : s < 3600 ? `hace ${Math.floor(s / 60)} min` : `hace ${Math.floor(s / 3600)} h`;
};
const gpsState = (d: Driver) => {
  const s = secondsAgo(d.location?.updated_at);
  if (s <= 120) return { label: 'En línea', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400 animate-pulse' };
  if (Number.isFinite(s)) return { label: 'Señal perdida', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', dot: 'bg-amber-400' };
  return { label: 'Sin GPS', cls: 'bg-secondary text-muted-foreground border-border', dot: 'bg-slate-500' };
};
const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

const emptyStats = (): Stats => ({
  orders: 0,
  delivered: 0,
  route: 0,
  pending: 0,
  failed: 0,
  recaudado: 0,
  porCobrar: 0,
  gananciaDelivery: 0,
  rendir: 0,
  gananciaProveedor: 0,
  gananciaEmpresa: 0,
});

/** Misma regla que el detalle financiero de Cierres. */
function statsOf(orders: LiveOrder[], into = emptyStats()) {
  orders.forEach((o) => {
    const st = stateOf(o.status);
    const m = o.money || ({ total: Number(o.total_gs || 0), fee: 0, commission: 0, delivery_charged: 0, provider_price: 0, real_cost: 0 } as Money);
    into.orders++;
    into[st]++;
    if (st === 'delivered') {
      const encomienda = String(o.status || '').toUpperCase() === 'ENCOMIENDA ENTREGADA';
      into.gananciaDelivery += m.fee;
      if (encomienda) {
        into.gananciaEmpresa -= m.fee;
      } else {
        into.recaudado += m.total;
        into.gananciaProveedor += m.provider_price - m.real_cost;
        into.gananciaEmpresa += m.provider_price - m.real_cost + m.delivery_charged - m.fee;
      }
    } else if (st === 'route' || st === 'pending') {
      into.porCobrar += m.total;
    }
  });
  into.rendir = into.recaudado - into.gananciaDelivery;
  return into;
}

/** Central de despacho en vivo (admin / proveedor). */
export default function LiveMapView() {
  const { profile } = useAuth();
  const isAdmin = String(profile?.role || '').toUpperCase() === 'ADMIN';
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [filter, setFilter] = useState<'todos' | 'linea' | 'pendientes'>('todos');
  const [tile, setTile] = useState<TileKey>(() => {
    try {
      const saved = localStorage.getItem('dcanp-map-tile') as TileKey | null;
      return saved && saved in TILES ? saved : 'calles';
    } catch {
      return 'calles';
    }
  });
  const [notices, setNotices] = useState<Notice[]>([]);
  const [feed, setFeed] = useState<Notice[]>([]);
  const [lastSync, setLastSync] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const wrapEl = useRef<HTMLDivElement | null>(null);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayer = useRef<L.TileLayer | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const previous = useRef<Map<string, string>>(new Map());
  const fitted = useRef(false);
  const reloadRef = useRef<() => void>(() => undefined);

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    [...drivers].sort((a, b) => a.email.localeCompare(b.email)).forEach((d, i) => map.set(d.email, DRIVER_COLORS[i % DRIVER_COLORS.length]));
    return (email: string) => map.get(email) || DRIVER_COLORS[0];
  }, [drivers.map((d) => d.email).join(',')]);

  // Datos en vivo
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await (supabase as any).rpc('live_map_data');
      if (!alive) return;
      if (error) {
        setLoadError(error.message || 'No se pudo cargar el mapa');
        return;
      }
      setLoadError(null);
      const list = ((data?.drivers || []) as Driver[]).map((d) => ({ ...d, trail: d.trail || [], orders: d.orders || [] }));

      const fresh: Notice[] = [];
      list.forEach((d) =>
        d.orders.forEach((o) => {
          const before = previous.current.get(o.id);
          const now = String(o.status || '');
          if (before !== undefined && before !== now) {
            const st = stateOf(now);
            const amount = Number(o.money?.total ?? o.total_gs ?? 0);
            fresh.push({
              id: `${o.id}-${now}-${Date.now()}`,
              icon: st === 'delivered' ? '📦' : st === 'route' ? '🛵' : st === 'failed' ? '❌' : '🔔',
              title: st === 'delivered' ? `¡Entregado! +${gs(amount)}` : st === 'route' ? 'Salió a entregar' : now,
              text: `#${o.seq ?? '?'} ${o.customer || ''} · ${o.city || ''} — ${d.name}`,
              color: st === 'pending' ? '#38bdf8' : STOP_STYLE[st].color,
              at: Date.now(),
              pos: o.dest || d.location,
            });
          }
          previous.current.set(o.id, now);
        }),
      );
      if (fresh.length) {
        setNotices((old) => [...fresh, ...old].slice(0, 5));
        setFeed((old) => [...fresh, ...old].slice(0, 30));
      }
      setDrivers(list);
      setLoaded(true);
      setLastSync(Date.now());
    };
    reloadRef.current = () => void load();
    void load();
    const timer = window.setInterval(load, POLL_MS);
    const clock = window.setInterval(() => setTick((t) => t + 1), 1_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    if (!notices.length) return;
    const t = window.setTimeout(() => setNotices((old) => old.filter((n) => Date.now() - n.at < 9_000)), 1_500);
    return () => window.clearTimeout(t);
  }, [notices]);

  // Mapa
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    mapRef.current = L.map(mapEl.current, { zoomControl: false }).setView([-25.2867, -57.647], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
    layer.current = L.layerGroup().addTo(mapRef.current);
    // El contenedor puede cambiar de tamaño al terminar de armarse la pantalla.
    const map = mapRef.current;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
    if (mapEl.current) ro?.observe(mapEl.current);
    [200, 800, 2000].forEach((ms) => window.setTimeout(() => mapRef.current?.invalidateSize(), ms));
    mapRef.current.on('dragstart', () => setFollow(false));
    return () => {
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileLayer.current?.remove();
    const t = TILES[tile];
    tileLayer.current = L.tileLayer(t.url, { maxZoom: 19, attribution: t.attr, subdomains: tile === 'calles' ? 'abc' : 'abcd' }).addTo(map);
    // Si un estilo no carga (red o bloqueador), se vuelve al mapa de calles.
    let errors = 0;
    tileLayer.current.on('tileerror', () => {
      errors++;
      if (errors === 4 && tile !== 'calles') setTile('calles');
    });
    tileLayer.current.bringToBack();
    try {
      localStorage.setItem('dcanp-map-tile', tile);
    } catch {
      // Preferencia sólo de este navegador.
    }
  }, [tile]);

  // Al cambiar de tamaño (pantalla completa / layout) Leaflet necesita recalcular.
  useEffect(() => {
    const onResize = () => window.setTimeout(() => mapRef.current?.invalidateSize(), 150);
    document.addEventListener('fullscreenchange', onResize);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('fullscreenchange', onResize);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layer.current) return;
    layer.current.clearLayers();
    const points: L.LatLngExpression[] = [];
    drivers.forEach((d) => {
      const color = colorOf(d.email);
      const dim = selected && selected !== d.email;
      if (d.trail.length > 1) {
        L.polyline(d.trail, { color: '#000', weight: 7, opacity: dim ? 0.05 : 0.18 }).addTo(layer.current!);
        L.polyline(d.trail, { color, weight: 4, opacity: dim ? 0.15 : 0.9 }).addTo(layer.current!);
      }
      // Próxima entrega: línea punteada desde la moto.
      const next = d.orders.find((o) => stateOf(o.status) === 'route' && o.dest);
      if (d.location && next?.dest && !dim) {
        L.polyline([[d.location.lat, d.location.lng], [next.dest.lat, next.dest.lng]], { color, weight: 2, dashArray: '6 8', opacity: 0.9 }).addTo(
          layer.current!,
        );
      }
      d.orders.forEach((o) => {
        if (!o.dest) return;
        const st = stateOf(o.status);
        L.marker(o.dest, { icon: stopIcon(o.seq, st === 'route' ? color : STOP_STYLE[st].color), opacity: dim ? 0.3 : 1 })
          .bindPopup(
            `<b>#${o.seq ?? '?'} ${o.customer || ''}</b><br/>${o.city || ''} · ${gs(Number(o.money?.total ?? o.total_gs ?? 0))}<br/>${STOP_STYLE[st].icon} ${o.status || ''} · ${d.name}`,
          )
          .addTo(layer.current!);
        if (!dim) points.push(o.dest);
      });
      if (d.location) {
        L.marker(d.location, { icon: motoIcon(d.name.split(' ')[0], color), opacity: dim ? 0.35 : 1, zIndexOffset: 1000 })
          .bindPopup(`<b>${d.name}</b><br/>${ago(d.location.updated_at)}`)
          .on('click', () => setSelected(d.email))
          .addTo(layer.current!);
        if (!dim) points.push(d.location);
      }
    });
    notices.forEach((n) => {
      if (!n.pos) return;
      L.marker(n.pos, {
        icon: L.divIcon({
          className: '',
          html: `<div class="dcanp-drop" style="transform:translate(-50%,-110%);font-size:34px">${n.icon}</div>`,
          iconSize: [0, 0],
        }),
        zIndexOffset: 2000,
      }).addTo(layer.current!);
    });

    const sel = drivers.find((d) => d.email === selected);
    if (follow && sel?.location) {
      map.panTo(sel.location, { animate: true });
    } else if (!fitted.current && points.length) {
      if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 15 });
      else map.setView(points[0], 15);
      fitted.current = true;
    }
  }, [drivers, selected, notices, colorOf, follow]);

  const focusDriver = (email: string | null) => {
    setSelected(email);
    setFollow(false);
    const d = drivers.find((x) => x.email === email);
    const map = mapRef.current;
    if (!map) return;
    const pts: L.LatLngExpression[] = [];
    (d ? [d] : drivers).forEach((x) => {
      if (x.location) pts.push(x.location);
      x.orders.forEach((o) => o.dest && pts.push(o.dest));
    });
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 15 });
    else if (pts.length) map.setView(pts[0], 15);
  };

  const toggleFullscreen = () => {
    const el = wrapEl.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const total = useMemo(() => drivers.reduce((acc, d) => statsOf(d.orders, acc), emptyStats()), [drivers]);
  const perDriver = useMemo(() => new Map(drivers.map((d) => [d.email, statsOf(d.orders)])), [drivers]);
  const online = drivers.filter((d) => secondsAgo(d.location?.updated_at) <= 120).length;
  const progress = total.orders ? Math.round(((total.delivered + total.failed) / total.orders) * 100) : 0;

  const visibleDrivers = [...drivers]
    .filter((d) =>
      filter === 'linea' ? secondsAgo(d.location?.updated_at) <= 120 : filter === 'pendientes' ? (perDriver.get(d.email)?.route || 0) + (perDriver.get(d.email)?.pending || 0) > 0 : true,
    )
    .sort((a, b) => secondsAgo(a.location?.updated_at) - secondsAgo(b.location?.updated_at) || a.name.localeCompare(b.name));

  const syncSeconds = lastSync ? Math.round((Date.now() - lastSync) / 1000) : null;

  return (
    <div ref={wrapEl} className="app-card !p-3 sm:!p-4 bg-background">
      <style>{`@keyframes dcanpDrop{0%{transform:translate(-50%,-260%) scale(.6);opacity:0}40%{transform:translate(-50%,-110%) scale(1.25);opacity:1}60%{transform:translate(-50%,-125%) scale(1)}100%{transform:translate(-50%,-110%) scale(1)}} .dcanp-drop{animation:dcanpDrop 1.2s ease-out}
      @keyframes dcanpSlide{from{transform:translateX(30px);opacity:0}to{transform:none;opacity:1}} .dcanp-slide{animation:dcanpSlide .35s ease-out}`}</style>

      {/* Encabezado */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 text-xl shadow-lg">🛰️</div>
          <div>
            <h3 className="text-lg font-black leading-tight">Central de despacho</h3>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              En vivo · {online}/{drivers.length} deliverys en línea · {syncSeconds === null ? 'conectando…' : `actualizado hace ${syncSeconds}s`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TILES) as TileKey[]).map((k) => (
            <button key={k} type="button" className={`nav-btn !py-1 !text-xs ${tile === k ? 'active' : ''}`} onClick={() => setTile(k)}>
              {TILES[k].label}
            </button>
          ))}
          <button type="button" className="nav-btn !py-1 !text-xs" onClick={() => reloadRef.current()}>
            🔄
          </button>
          <button type="button" className="nav-btn !py-1 !text-xs" onClick={toggleFullscreen}>
            ⛶ Pantalla completa
          </button>
        </div>
      </div>

      {/* KPIs de plata y entregas */}
      <div className={`mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 ${isAdmin ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>
        <Kpi icon="💵" label="Recaudado hoy" value={gs(total.recaudado)} sub={`${total.delivered} entregados`} tone="text-emerald-300" />
        <Kpi icon="⏳" label="Por cobrar" value={gs(total.porCobrar)} sub={`${total.route} en camino · ${total.pending} pendientes`} tone="text-sky-300" />
        <Kpi icon="🛵" label="Ganancia deliverys" value={gs(total.gananciaDelivery)} sub={`Rinden ${gs(total.rendir)}`} tone="text-violet-300" />
        <Kpi icon="🏭" label="Ganancia proveedor" value={gs(total.gananciaProveedor)} sub="precio proveedor − costo real" tone="text-amber-300" />
        {isAdmin && <Kpi icon="📈" label="Ganancia neta" value={gs(total.gananciaEmpresa)} sub="producto + logística" tone="text-emerald-400" />}
        <div className="rounded-2xl border border-border bg-secondary/30 p-3">
          <div className="text-[11px] text-muted-foreground">🎯 Avance del día</div>
          <div className="mt-0.5 text-xl font-black">{progress}%</div>
          <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-secondary">
            <div className="bg-emerald-500" style={{ width: `${total.orders ? (total.delivered / total.orders) * 100 : 0}%` }} />
            <div className="bg-rose-500" style={{ width: `${total.orders ? (total.failed / total.orders) * 100 : 0}%` }} />
            <div className="bg-violet-500" style={{ width: `${total.orders ? (total.route / total.orders) * 100 : 0}%` }} />
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            ✅ {total.delivered} · ✖️ {total.failed} · 🛵 {total.route} · ⏳ {total.pending}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Mapa */}
        <div className="relative overflow-hidden rounded-2xl border border-border shadow-inner" style={{ height: 'min(70vh, 720px)', minHeight: 380 }}>
          <div ref={mapEl} className="absolute inset-0" />

          <div className="pointer-events-none absolute right-2 top-10 z-[500] flex w-[min(320px,calc(100%-16px))] flex-col gap-2">
            {notices.map((n) => (
              <div
                key={n.id}
                className="dcanp-slide pointer-events-auto flex items-start gap-2.5 rounded-2xl border-2 bg-background/95 p-3 shadow-2xl backdrop-blur"
                style={{ borderColor: n.color }}
              >
                <span className="text-3xl">{n.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-black" style={{ color: n.color }}>
                    {n.title}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{n.text}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="absolute bottom-2 left-2 z-[500] flex flex-wrap gap-1.5">
            {selected && (
              <>
                <button type="button" className="nav-btn !bg-background/90 !py-1.5 !text-xs" onClick={() => focusDriver(null)}>
                  🗺️ Ver todos
                </button>
                <button type="button" className={`nav-btn !py-1.5 !text-xs ${follow ? 'active' : '!bg-background/90'}`} onClick={() => setFollow((f) => !f)}>
                  🎯 {follow ? 'Siguiendo' : 'Seguir moto'}
                </button>
              </>
            )}
          </div>

          <div className="absolute left-2 top-2 z-[500] flex flex-wrap gap-1 rounded-xl bg-background/90 px-2 py-1 text-[10px] shadow backdrop-blur">
            {(['delivered', 'route', 'pending', 'failed'] as const).map((k) => (
              <span key={k} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STOP_STYLE[k].color }} />
                {STOP_STYLE[k].label}
              </span>
            ))}
          </div>

          {loaded && drivers.length > 0 && online === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-14 z-[400] flex justify-center p-2">
              <div className="max-w-sm rounded-2xl border border-amber-500/40 bg-background/95 px-3 py-2 text-center text-[11px] shadow-xl">
                <b className="text-amber-300">📡 Ningún delivery está compartiendo su ubicación ahora.</b>
                <div className="text-muted-foreground">La 🛵 aparece cuando abre la app DCANP (o su link) con un pedido EN RUTA y acepta la ubicación.</div>
              </div>
            </div>
          )}
          {loadError && (
            <div className="absolute inset-x-2 bottom-12 z-[600] rounded-xl border border-red-500/40 bg-background/95 p-3 text-xs text-red-300 shadow-xl">
              ⚠️ {loadError}. Reintentando…
            </div>
          )}
          {loaded && !drivers.length && (
            <div className="pointer-events-none absolute inset-x-0 bottom-14 z-[400] flex justify-center p-2 text-center">
              <div className="rounded-2xl border border-border bg-background/95 px-4 py-3 shadow-xl">
                <div className="text-3xl">🛵</div>
                <div className="mt-2 font-black">Sin deliverys en ruta</div>
                <div className="text-xs text-muted-foreground">No hay pedidos asignados hoy o ya finalizaron su día.</div>
              </div>
            </div>
          )}
        </div>

        {/* Flota */}
        <div className="flex flex-col gap-2" style={{ maxHeight: 'min(70vh, 720px)' }}>
          <div className="flex gap-1 rounded-xl bg-secondary/40 p-1 text-xs">
            {(
              [
                ['todos', `Todos (${drivers.length})`],
                ['linea', `En línea (${online})`],
                ['pendientes', 'Con pendientes'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`flex-1 rounded-lg px-2 py-1.5 font-bold ${filter === k ? 'bg-background shadow' : 'text-muted-foreground'}`}
                onClick={() => setFilter(k)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto pr-0.5">
            {visibleDrivers.map((d) => {
              const color = colorOf(d.email);
              const st = perDriver.get(d.email) || emptyStats();
              const gps = gpsState(d);
              const open = selected === d.email;
              const pct = st.orders ? ((st.delivered + st.failed) / st.orders) * 100 : 0;
              const next = d.orders.find((o) => stateOf(o.status) === 'route');
              return (
                <div key={d.email} className={`rounded-2xl border p-3 transition ${open ? 'border-primary bg-primary/5 shadow-lg' : 'border-border hover:border-primary/40'}`}>
                  <button type="button" className="w-full text-left" onClick={() => focusDriver(open ? null : d.email)}>
                    <div className="flex items-center gap-2.5">
                      <div className="relative">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-black text-white" style={{ background: color }}>
                          {initials(d.name)}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${gps.dot}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-black">{d.name}</div>
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <span className={`rounded-full border px-1.5 py-0.5 font-bold ${gps.cls}`}>{gps.label}</span>
                          <span className="text-muted-foreground">{ago(d.location?.updated_at)}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-black">
                          {st.delivered}/{st.orders}
                        </div>
                        <div className="text-[10px] text-muted-foreground">entregas</div>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    {next && (
                      <div className="mt-1.5 truncate text-[11px]">
                        🛵 Va a <b>#{next.seq ?? '?'} {next.customer || ''}</b> · {next.city || ''}
                      </div>
                    )}
                    <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                      <MiniMoney label="Recaudó" value={st.recaudado} tone="text-emerald-300" />
                      <MiniMoney label="Su ganancia" value={st.gananciaDelivery} tone="text-violet-300" />
                      <MiniMoney label="Rinde" value={st.rendir} tone="text-foreground" />
                    </div>
                    <div className="mt-1.5 flex justify-between rounded-lg bg-amber-500/10 px-2 py-1 text-[11px]">
                      <span className="text-muted-foreground">🏭 Ganancia proveedor</span>
                      <b className="text-amber-300">{gs(st.gananciaProveedor)}</b>
                    </div>
                    {st.porCobrar > 0 && (
                      <div className="mt-1 flex justify-between px-2 text-[11px] text-muted-foreground">
                        <span>⏳ Falta cobrar</span>
                        <b className="text-sky-300">{gs(st.porCobrar)}</b>
                      </div>
                    )}
                  </button>

                  {open && (
                    <div className="mt-3 border-t border-border pt-2">
                      <div className="relative space-y-1 pl-3 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-border">
                        {d.orders.map((o) => {
                          const s = stateOf(o.status);
                          const digits = String(o.phone || '').replace(/\D/g, '');
                          const phone = digits.startsWith('595') ? digits : digits.replace(/^0/, '595');
                          return (
                            <div key={o.id} className="relative flex items-center gap-2 rounded-lg py-1 pr-1 text-xs hover:bg-secondary/50">
                              <button
                                type="button"
                                className="z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-background text-[10px] font-black text-white -ml-3"
                                style={{ background: s === 'route' ? color : STOP_STYLE[s].color }}
                                onClick={() => {
                                  setFollow(false);
                                  if (o.dest) mapRef.current?.setView(o.dest, 16);
                                }}
                                title="Ver en el mapa"
                              >
                                {o.seq ?? '•'}
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-bold">{o.customer || 'Cliente'}</div>
                                <div className="truncate text-[10px] text-muted-foreground">
                                  {STOP_STYLE[s].icon} {o.status} · {o.city || '—'}
                                  {s === 'delivered' && o.delivered_at
                                    ? ` · ${new Date(o.delivered_at).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })}`
                                    : ''}
                                </div>
                              </div>
                              <div className="text-right text-[11px] font-black">{gs(Number(o.money?.total ?? o.total_gs ?? 0))}</div>
                              <button
                                type="button"
                                className={`rounded-md px-1 text-sm ${o.dest ? '' : 'opacity-60'}`}
                                title={o.dest ? 'Cambiar / borrar ubicación del cliente' : 'Cargar ubicación del cliente'}
                                onClick={() => void editOrderLocation(o.id).then((ok) => ok && reloadRef.current())}
                              >
                                {o.dest ? '📍' : '➕📍'}
                              </button>
                              {phone.length >= 11 && (
                                <a className="rounded-md px-1 text-sm" href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" title="WhatsApp del cliente">
                                  💬
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <button type="button" className="nav-btn mt-2 w-full !py-1.5 !text-xs" onClick={() => void generateRouteLink(d.email, d.name)}>
                        🌐 Link de ruta para clientes
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Actividad */}
            <div className="rounded-2xl border border-border p-3">
              <div className="mb-1.5 text-xs font-black">⚡ Actividad en vivo</div>
              {!feed.length && <div className="text-[11px] text-muted-foreground">Acá aparecen las entregas y cambios de estado mientras mirás el mapa.</div>}
              <div className="space-y-1">
                {feed.map((n) => (
                  <div key={n.id} className="flex items-center gap-2 text-[11px]">
                    <span>{n.icon}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <b style={{ color: n.color }}>{n.title}</b> {n.text}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(n.at).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <p className="px-1 text-[10px] text-muted-foreground">
              📍 cambiar / borrar ubicación · ➕📍 sin ubicación (cargala para verlo en el mapa). La 🛵 aparece cuando el delivery tiene la app abierta con
              un pedido EN RUTA o un link activo. Montos según la tarifa del delivery por ciudad y el costo real de los productos.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: string; label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/30 p-3">
      <div className="text-[11px] text-muted-foreground">
        {icon} {label}
      </div>
      <div className={`mt-0.5 truncate text-lg font-black sm:text-xl ${tone}`}>{value}</div>
      <div className="truncate text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function MiniMoney({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-1 py-1">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`truncate text-[11px] font-black ${tone}`}>{nf(value)}</div>
    </div>
  );
}
