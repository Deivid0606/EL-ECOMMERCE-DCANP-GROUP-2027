import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '@/integrations/supabase/client';

type Stop = { seq: number | null; status: string; state: 'delivered' | 'route' | 'pending' | 'failed'; city: string | null; dest: { lat: number; lng: number } | null };
type Route = {
  found: boolean;
  finished?: boolean;
  delivery_name?: string;
  stops?: Stop[];
  location?: { lat: number; lng: number; updated_at: string } | null;
  trail?: [number, number][];
};

export const STOP_STYLE: Record<Stop['state'], { color: string; label: string; icon: string }> = {
  delivered: { color: '#10b981', label: 'Entregado', icon: '✅' },
  route: { color: '#8c5cff', label: 'En camino', icon: '🛵' },
  pending: { color: '#94a3b8', label: 'Pendiente', icon: '⏳' },
  failed: { color: '#f43f5e', label: 'No entregado', icon: '✖️' },
};

export const motoIcon = (label?: string, color = '#8c5cff') =>
  L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-80%);display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))">
      <div style="font-size:32px;line-height:32px">🛵</div>
      ${label ? `<div style="margin-top:-2px;background:${color};color:#fff;font:700 11px/1 system-ui;padding:3px 6px;border-radius:8px;white-space:nowrap">${label}</div>` : ''}
    </div>`,
    iconSize: [0, 0],
  });

export const stopIcon = (seq: number | null, color: string) =>
  L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;background:${color};border:2px solid #fff;color:#fff;font:800 12px/22px system-ui;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.4)">${seq ?? '•'}</div>`,
    iconSize: [0, 0],
  });

const POLL_MS = 10_000;

/** Link de ruta global: la 🛵 y todas las entregas del día, sin datos de los clientes. */
export default function RoutePage({ token }: { token: string }) {
  const [data, setData] = useState<Route | null>(null);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = async () => {
      const { data: res } = await (supabase as any).rpc('get_route_tracking', { p_token: token });
      if (!alive) return;
      setData((res || { found: false }) as Route);
      if (res?.found && !res.finished) timer = window.setTimeout(load, POLL_MS);
    };
    void load();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [token]);

  useEffect(() => {
    if (!mapEl.current || mapRef.current || !data?.found) return;
    mapRef.current = L.map(mapEl.current, { zoomControl: false }).setView([-25.2867, -57.647], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapRef.current);
    L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
    layer.current = L.layerGroup().addTo(mapRef.current);
  }, [data?.found]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layer.current || !data?.found) return;
    layer.current.clearLayers();
    const points: L.LatLngExpression[] = [];
    if (data.trail && data.trail.length > 1) L.polyline(data.trail, { color: '#8c5cff', weight: 4, opacity: 0.7 }).addTo(layer.current);
    (data.stops || []).forEach((s) => {
      if (!s.dest) return;
      L.marker(s.dest, { icon: stopIcon(s.seq, STOP_STYLE[s.state].color) }).addTo(layer.current!);
      points.push(s.dest);
    });
    if (data.location) {
      L.marker(data.location, { icon: motoIcon(data.delivery_name) }).addTo(layer.current);
      points.push(data.location);
    }
    if (!fitted.current && points.length) {
      if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 15 });
      else map.setView(points[0], 14);
      fitted.current = true;
    }
  }, [data]);

  if (!data) return <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">Cargando ruta…</div>;
  if (!data.found) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div>
          <div className="text-5xl">🔗</div>
          <h1 className="mt-3 text-xl font-black">Link de ruta no válido</h1>
        </div>
      </div>
    );
  }

  const stops = data.stops || [];
  const done = stops.filter((s) => s.state === 'delivered' || s.state === 'failed').length;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <img src="/icon-192.png" alt="" className="h-9 w-9 rounded-xl" />
          <div>
            <div className="text-sm font-black leading-tight">Ruta de {data.delivery_name} · hoy</div>
            <div className="text-[11px] text-muted-foreground">
              {done} de {stops.length} entregas completadas
            </div>
          </div>
        </div>
        {!data.finished && data.location && (
          <span className="flex items-center gap-1.5 text-[11px] text-emerald-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> En vivo
          </span>
        )}
      </header>

      <div className="relative min-h-[50vh] flex-1">
        <div ref={mapEl} className="absolute inset-0" />
        {data.finished && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center bg-background/80 p-6 text-center backdrop-blur-sm">
            <div>
              <div className="text-5xl">🏁</div>
              <h2 className="mt-2 text-xl font-black">Recorrido del día finalizado</h2>
            </div>
          </div>
        )}
      </div>

      <section className="max-h-[40vh] overflow-y-auto border-t border-border p-4">
        <div className="mb-2 h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${stops.length ? Math.round((done / stops.length) * 100) : 0}%` }} />
        </div>
        <div className="space-y-1.5">
          {stops.map((s, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
                style={{ background: STOP_STYLE[s.state].color }}
              >
                {s.seq ?? '•'}
              </span>
              <span className="flex-1 truncate">Entrega #{s.seq ?? '?'} · {s.city || '—'}</span>
              <span className="text-xs text-muted-foreground">
                {STOP_STYLE[s.state].icon} {STOP_STYLE[s.state].label}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
