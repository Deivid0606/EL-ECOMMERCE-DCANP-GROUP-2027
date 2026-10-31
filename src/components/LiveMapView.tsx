import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '@/integrations/supabase/client';
import { motoIcon, stopIcon, STOP_STYLE } from '@/components/RoutePage';
import { generateRouteLink } from '@/lib/tracking';

type LiveOrder = {
  id: string;
  order_number: string | null;
  seq: number | null;
  status: string | null;
  customer: string | null;
  city: string | null;
  total_gs: number | null;
  updated_at: string;
  delivered_at: string | null;
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

const POLL_MS = 8_000;
// Un color fijo por delivery (no cambia al filtrar).
const DRIVER_COLORS = ['#8c5cff', '#0ea5e9', '#f97316', '#10b981', '#e11d48', '#eab308', '#14b8a6', '#6366f1'];
const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(n || 0));

const stateOf = (status: string | null) => {
  const s = String(status || '').toUpperCase();
  if (s === 'ENTREGADO' || s === 'ENCOMIENDA ENTREGADA') return 'delivered' as const;
  if (s === 'EN RUTA') return 'route' as const;
  if (['CANCELADO', 'CANCELÓ POR WHATSAPP', 'NO DESEA', 'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'DEVUELTO A DEPÓSITO'].includes(s)) return 'failed' as const;
  return 'pending' as const;
};

const ago = (iso?: string | null) => {
  if (!iso) return 'sin ubicación';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `hace ${s}s` : s < 3600 ? `hace ${Math.floor(s / 60)} min` : `hace ${Math.floor(s / 3600)} h`;
};

/** Mapa en vivo (admin / proveedor): deliveries del día hasta que finalizan su día. */
export default function LiveMapView() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [, setTick] = useState(0);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const previous = useRef<Map<string, string>>(new Map());
  const fitted = useRef(false);

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
      if (!alive || error) return;
      const list = ((data?.drivers || []) as Driver[]).map((d) => ({ ...d, trail: d.trail || [], orders: d.orders || [] }));

      // Avisos: pedidos que cambiaron a entregado / no entregado desde la última vez.
      const fresh: Notice[] = [];
      list.forEach((d) =>
        d.orders.forEach((o) => {
          const before = previous.current.get(o.id);
          const now = String(o.status || '');
          if (before !== undefined && before !== now) {
            const st = stateOf(now);
            if (st === 'delivered' || st === 'failed' || st === 'route') {
              fresh.push({
                id: `${o.id}-${now}-${Date.now()}`,
                icon: st === 'delivered' ? '📦' : st === 'route' ? '🛵' : '❌',
                title: st === 'delivered' ? '¡Entregado!' : st === 'route' ? 'Salió a entregar' : now,
                text: `#${o.seq ?? '?'} ${o.customer || ''} · ${o.city || ''} — ${d.name}`,
                color: STOP_STYLE[st].color,
                at: Date.now(),
                pos: o.dest || d.location,
              });
            }
          }
          previous.current.set(o.id, now);
        }),
      );
      if (fresh.length) setNotices((old) => [...fresh, ...old].slice(0, 6));
      setDrivers(list);
      setLoaded(true);
    };
    void load();
    const timer = window.setInterval(load, POLL_MS);
    const clock = window.setInterval(() => setTick((t) => t + 1), 5_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, []);

  // Los avisos se van solos.
  useEffect(() => {
    if (!notices.length) return;
    const t = window.setTimeout(() => setNotices((old) => old.filter((n) => Date.now() - n.at < 10_000)), 2_000);
    return () => window.clearTimeout(t);
  }, [notices]);

  // Mapa
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    mapRef.current = L.map(mapEl.current).setView([-25.2867, -57.647], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapRef.current);
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
    const points: L.LatLngExpression[] = [];
    drivers.forEach((d) => {
      const color = colorOf(d.email);
      const dim = selected && selected !== d.email;
      if (d.trail.length > 1) L.polyline(d.trail, { color, weight: 4, opacity: dim ? 0.15 : 0.75 }).addTo(layer.current!);
      d.orders.forEach((o) => {
        if (!o.dest) return;
        const st = stateOf(o.status);
        L.marker(o.dest, { icon: stopIcon(o.seq, st === 'route' ? color : STOP_STYLE[st].color), opacity: dim ? 0.3 : 1 })
          .bindPopup(`<b>#${o.seq ?? '?'} ${o.customer || ''}</b><br/>${o.city || ''} · Gs. ${nf(Number(o.total_gs || 0))}<br/>${o.status || ''} · ${d.name}`)
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
          html: `<div class="dcanp-drop" style="transform:translate(-50%,-110%);font-size:30px">${n.icon}</div>`,
          iconSize: [0, 0],
        }),
        zIndexOffset: 2000,
      }).addTo(layer.current!);
    });
    if ((!fitted.current || selected) && points.length) {
      if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
      else map.setView(points[0], 15);
      fitted.current = true;
    }
  }, [drivers, selected, notices, colorOf]);

  const totals = drivers.reduce(
    (acc, d) => {
      d.orders.forEach((o) => {
        acc[stateOf(o.status)]++;
      });
      return acc;
    },
    { delivered: 0, route: 0, pending: 0, failed: 0 },
  );

  return (
    <div className="app-card !p-3 sm:!p-4">
      <style>{`@keyframes dcanpDrop{0%{transform:translate(-50%,-260%) scale(.6);opacity:0}40%{transform:translate(-50%,-110%) scale(1.25);opacity:1}60%{transform:translate(-50%,-125%) scale(1)}100%{transform:translate(-50%,-110%) scale(1)}} .dcanp-drop{animation:dcanpDrop 1.2s ease-out}`}</style>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-extrabold">🗺️ Mapa en vivo</h3>
          <p className="text-xs text-muted-foreground">
            Deliveries de hoy hasta que finalizan su día · se actualiza cada {POLL_MS / 1000} s
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="chip">🛵 {drivers.length} deliveries</span>
          <span className="chip">✅ {totals.delivered}</span>
          <span className="chip">🛵 {totals.route} en camino</span>
          <span className="chip">⏳ {totals.pending}</span>
          <span className="chip">✖️ {totals.failed}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative overflow-hidden rounded-xl border border-border" style={{ height: '62vh', minHeight: 380 }}>
          <div ref={mapEl} className="absolute inset-0" />
          <div className="pointer-events-none absolute right-2 top-2 z-[500] flex w-[min(320px,calc(100%-16px))] flex-col gap-2">
            {notices.map((n) => (
              <div
                key={n.id}
                className="pointer-events-auto flex items-start gap-2 rounded-xl border bg-background/95 p-2.5 shadow-xl backdrop-blur"
                style={{ borderColor: n.color }}
              >
                <span className="dcanp-drop text-2xl" style={{ display: 'inline-block', transform: 'none' }}>
                  {n.icon}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-black" style={{ color: n.color }}>
                    {n.title}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{n.text}</div>
                </div>
              </div>
            ))}
          </div>
          {selected && (
            <button
              type="button"
              className="absolute bottom-2 left-2 z-[500] nav-btn !py-1.5 !text-xs"
              onClick={() => {
                setSelected(null);
                fitted.current = false;
              }}
            >
              Ver todos
            </button>
          )}
        </div>

        <div className="max-h-[62vh] space-y-2 overflow-y-auto">
          {loaded && !drivers.length && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No hay deliveries con pedidos hoy (o ya finalizaron su día).
            </div>
          )}
          {[...drivers]
            .sort((a, b) => Number(Boolean(b.location)) - Number(Boolean(a.location)) || a.name.localeCompare(b.name))
            .map((d) => {
              const color = colorOf(d.email);
              const done = d.orders.filter((o) => stateOf(o.status) === 'delivered').length;
              const open = selected === d.email;
              return (
                <div key={d.email} className={`rounded-xl border p-3 ${open ? 'border-primary bg-primary/5' : 'border-border'}`}>
                  <button type="button" className="w-full text-left" onClick={() => setSelected(open ? null : d.email)}>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
                      <b className="flex-1 truncate">{d.name}</b>
                      <span className={`text-[11px] ${d.location ? 'text-emerald-300' : 'text-muted-foreground'}`}>
                        {d.location ? ago(d.location.updated_at) : 'sin GPS'}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${d.orders.length ? (done / d.orders.length) * 100 : 0}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {done} de {d.orders.length} entregados · {d.orders.filter((o) => stateOf(o.status) === 'route').length} en camino
                    </div>
                  </button>
                  {open && (
                    <div className="mt-2 space-y-1">
                      {d.orders.map((o) => {
                        const st = stateOf(o.status);
                        return (
                          <button
                            key={o.id}
                            type="button"
                            className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-secondary/60"
                            onClick={() => o.dest && mapRef.current?.setView(o.dest, 16)}
                          >
                            <span
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white"
                              style={{ background: st === 'route' ? color : STOP_STYLE[st].color }}
                            >
                              {o.seq ?? '•'}
                            </span>
                            <span className="flex-1 truncate">
                              {o.customer || 'Cliente'} · {o.city || ''}
                            </span>
                            <span className="text-muted-foreground">{o.dest ? '' : '📍?'} {STOP_STYLE[st].icon}</span>
                          </button>
                        );
                      })}
                      <button type="button" className="nav-btn mt-1 w-full !py-1.5 !text-xs" onClick={() => void generateRouteLink(d.email, d.name)}>
                        🌐 Link de ruta para clientes
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          <p className="px-1 text-[11px] text-muted-foreground">
            📍? = el cliente no tiene ubicación cargada (se carga al generar su link de seguimiento). Los deliveries aparecen en el mapa
            cuando tienen la app abierta con un pedido EN RUTA o un link activo.
          </p>
        </div>
      </div>
    </div>
  );
}
