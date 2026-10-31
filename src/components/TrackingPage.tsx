import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '@/integrations/supabase/client';
import { etaMinutes, type LatLng } from '@/lib/tracking';

type Tracking = {
  found: boolean;
  finished?: boolean;
  expired?: boolean;
  status?: string;
  order_number?: string;
  customer?: string;
  city?: string;
  address?: string;
  total_gs?: number;
  items?: { title: string; qty: string }[];
  delivery_name?: string;
  dest?: LatLng | null;
  location?: (LatLng & { updated_at: string }) | null;
  trail?: [number, number][];
  queue?: { seq: number | null; total: number; done: number; ahead: number } | null;
};

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(n || 0));
const POLL_MS = 10_000;

const motoIcon = L.divIcon({
  className: '',
  html: '<div style="font-size:34px;line-height:34px;transform:translate(-17px,-24px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))">🛵</div>',
  iconSize: [0, 0],
});
const homeIcon = L.divIcon({
  className: '',
  html: '<div style="font-size:30px;line-height:30px;transform:translate(-15px,-28px)">🏠</div>',
  iconSize: [0, 0],
});

const minutesAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

export default function TrackingPage({ token }: { token: string }) {
  const [data, setData] = useState<Tracking | null>(null);
  const [geocoded, setGeocoded] = useState<LatLng | null>(null);

  // Modo repartidor: quien lleva el pedido abre el link logueado.
  const [driver, setDriver] = useState<{ is_tracker: boolean; status: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const lastSent = useRef(0);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: session }) => {
      if (!session.session) return;
      const { data: info } = await (supabase as any).rpc('tracking_driver_info', { p_token: token });
      if (info?.is_tracker) setDriver(info);
    });
  }, [token]);

  const driverOnRoute = Boolean(driver?.is_tracker) && String(data?.status || driver?.status || '').toUpperCase() === 'EN RUTA' && !data?.finished;

  // Con el pedido en camino, esta página envía la ubicación del repartidor.
  useEffect(() => {
    if (!driverOnRoute || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        setGpsError('');
        if (Date.now() - lastSent.current < 10_000) return;
        lastSent.current = Date.now();
        await (supabase as any).rpc('report_delivery_location', {
          p_lat: pos.coords.latitude,
          p_lng: pos.coords.longitude,
          p_accuracy: pos.coords.accuracy,
        });
      },
      (err) => setGpsError(err.code === err.PERMISSION_DENIED ? 'Permití la ubicación para que el cliente te vea' : 'Sin señal de GPS'),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [driverOnRoute]);

  const startRoute = async () => {
    setStarting(true);
    const { error } = await (supabase as any).rpc('tracking_start_route', { p_token: token });
    setStarting(false);
    if (error) {
      setGpsError(error.message);
      return;
    }
    setDriver((d) => (d ? { ...d, status: 'EN RUTA' } : d));
    setData((d) => (d ? { ...d, status: 'EN RUTA' } : d));
  };
  const mapRef = useRef<L.Map | null>(null);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const layers = useRef<{ moto?: L.Marker; home?: L.Marker; trail?: L.Polyline }>({});
  const fitted = useRef(false);

  // Consulta periódica mientras el pedido está en camino.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = async () => {
      const { data: res } = await (supabase as any).rpc('get_order_tracking', { p_token: token });
      if (!alive) return;
      setData((res || { found: false }) as Tracking);
      if (res?.found && !res.finished) timer = window.setTimeout(load, POLL_MS);
    };
    void load();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [token]);

  // Sin ubicación del cliente: se aproxima con la dirección del pedido.
  useEffect(() => {
    if (!data?.found || data.dest || geocoded || !data.city) return;
    const q = [data.address, data.city, 'Paraguay'].filter(Boolean).join(', ');
    fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then((rows: { lat: string; lon: string }[]) => {
        if (rows?.[0]) setGeocoded({ lat: Number(rows[0].lat), lng: Number(rows[0].lon) });
      })
      .catch(() => undefined);
  }, [data?.found, data?.dest, data?.city, data?.address, geocoded]);

  const dest = data?.dest || geocoded;
  const eta = useMemo(() => (data?.location && dest ? etaMinutes(data.location, dest) : null), [data?.location, dest]);

  // Mapa
  useEffect(() => {
    if (!mapEl.current || mapRef.current || !data?.found) return;
    mapRef.current = L.map(mapEl.current, { zoomControl: false, attributionControl: true }).setView([-25.2867, -57.647], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(mapRef.current);
    L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
  }, [data?.found]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data?.found) return;
    const { location, trail } = data;

    if (trail && trail.length > 1) {
      if (layers.current.trail) layers.current.trail.setLatLngs(trail);
      else layers.current.trail = L.polyline(trail, { color: '#8c5cff', weight: 5, opacity: 0.85 }).addTo(map);
    }
    if (location) {
      if (layers.current.moto) layers.current.moto.setLatLng(location);
      else layers.current.moto = L.marker(location, { icon: motoIcon }).addTo(map);
    } else if (layers.current.moto) {
      layers.current.moto.remove();
      layers.current.moto = undefined;
    }
    if (dest) {
      if (layers.current.home) layers.current.home.setLatLng(dest);
      else layers.current.home = L.marker(dest, { icon: homeIcon }).addTo(map);
    }

    const points = [location, dest].filter(Boolean) as LatLng[];
    if (!fitted.current && points.length) {
      if (points.length === 2) map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 16 });
      else map.setView(points[0], 15);
      fitted.current = true;
    } else if (location && !map.getBounds().pad(-0.15).contains(location)) {
      map.panTo(location);
    }
  }, [data, dest]);

  if (!data) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">Cargando seguimiento…</div>;
  }

  if (!data.found) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div>
          <div className="text-5xl">🔗</div>
          <h1 className="mt-3 text-xl font-black">Link de seguimiento no válido</h1>
          <p className="mt-1 text-sm text-muted-foreground">Pedile a tu vendedor un link nuevo.</p>
        </div>
      </div>
    );
  }

  const delivered = ['ENTREGADO', 'ENCOMIENDA ENTREGADA'].includes(String(data.status || '').toUpperCase());
  const stale = data.location ? minutesAgo(data.location.updated_at) : null;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <img src="/icon-192.png" alt="" className="h-9 w-9 rounded-xl" />
          <div>
            <div className="text-sm font-black leading-tight">DCANP GROUP</div>
            <div className="text-[11px] text-muted-foreground">Seguimiento de tu pedido</div>
          </div>
        </div>
        {data.order_number && <span className="chip !text-[11px]">Pedido {data.order_number}</span>}
      </header>

      <div className="relative flex-1 min-h-[52vh]">
        <div ref={mapEl} className="absolute inset-0" />
        {data.finished && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center bg-background/80 p-6 text-center backdrop-blur-sm">
            <div>
              <div className="text-6xl">{delivered ? '✅' : 'ℹ️'}</div>
              <h2 className="mt-3 text-2xl font-black">
                {delivered ? '¡Pedido entregado!' : data.expired ? 'Seguimiento finalizado' : `Pedido ${String(data.status || '').toLowerCase()}`}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {delivered ? 'Gracias por tu compra 💜' : 'La ubicación del delivery ya no se comparte.'}
              </p>
            </div>
          </div>
        )}
      </div>

      <section className="space-y-3 border-t border-border p-4">
        {!data.finished && (() => {
          // El texto sigue el estado real del pedido (no siempre "en camino").
          const st = String(data.status || '').toUpperCase();
          const who = data.delivery_name || 'Tu delivery';
          const onRoute = st === 'EN RUTA' || Boolean(data.location);
          const info = onRoute
            ? {
                label: `🛵 ${who} está en camino`,
                title: eta ? `~${eta.minutes} min` : data.location ? 'En camino' : 'Saliendo a entregar',
                sub: eta
                  ? `A ${eta.km.toFixed(1)} km aprox. · llegada estimada`
                  : data.location
                    ? 'Calculando la llegada…'
                    : `Vas a ver la 🛵 en el mapa apenas ${who} comparta su ubicación`,
                live: Boolean(data.location),
              }
            : st === 'REAGENDADO'
              ? { label: '📅 Entrega reprogramada', title: 'Tu entrega fue reagendada', sub: `${who} te va a avisar cuando salga a entregar.`, live: false }
              : st === 'NO CONTESTA'
                ? { label: `📞 ${who} intentó comunicarse`, title: 'No pudimos contactarte', sub: 'Respondé la llamada o el WhatsApp para coordinar la entrega.', live: false }
                : { label: `📦 Pedido asignado a ${who}`, title: 'Preparando tu entrega', sub: `Cuando ${who} salga vas a ver la 🛵 en el mapa.`, live: false };
          return (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4">
              <div>
                <div className="text-xs text-muted-foreground">{info.label}</div>
                <div className="text-2xl font-black">{info.title}</div>
                <div className="text-[11px] text-muted-foreground">
                  {info.sub}
                  {stale !== null && stale > 2 ? ` · última ubicación hace ${stale} min` : ''}
                </div>
              </div>
              {info.live && (
                <span className="relative flex h-3 w-3 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
                </span>
              )}
            </div>
          );
        })()}

        {driver?.is_tracker && !data.finished && (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4">
            <div className="text-xs font-black uppercase tracking-wider text-amber-200">Modo repartidor</div>
            {driverOnRoute ? (
              <p className="mt-1 text-sm">
                🛵 <b>Estás en camino.</b> Dejá esta página abierta: el cliente ve tu ubicación en vivo.
                {gpsError && <span className="block text-xs text-rose-300">{gpsError}</span>}
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">Cuando salgas con este pedido, avisale al cliente:</p>
                <button
                  type="button"
                  className="nav-btn active mt-2 w-full !py-3 !text-base"
                  disabled={starting}
                  onClick={() => void startRoute()}
                >
                  {starting ? 'Avisando…' : '🛵 Estoy en camino'}
                </button>
                {gpsError && <p className="mt-1 text-xs text-rose-300">{gpsError}</p>}
              </>
            )}
          </div>
        )}

        {data.queue && data.queue.total > 1 && (
          <div className="rounded-2xl border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs text-muted-foreground">Entregas de {data.delivery_name || 'tu delivery'} hoy</div>
                <div className="text-lg font-black">
                  {data.queue.ahead === 0 ? '¡Sos la próxima entrega! 🎉' : `Faltan ${data.queue.ahead} entrega${data.queue.ahead === 1 ? '' : 's'} antes que vos`}
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                {data.queue.done} de {data.queue.total}
                <br />
                completadas
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((data.queue.done / data.queue.total) * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-border p-4">
          <div className="text-sm font-black">{data.customer ? `Hola ${data.customer} 👋` : 'Tu pedido'}</div>
          <div className="mt-2 space-y-1 text-sm">
            {(data.items || []).map((it, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="truncate">{it.title}</span>
                <span className="text-muted-foreground">×{it.qty}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t border-border pt-2 text-sm">
            <span className="text-muted-foreground">Total a pagar</span>
            <b>Gs. {nf(Number(data.total_gs || 0))}</b>
          </div>
          {(data.address || data.city) && (
            <div className="mt-2 text-xs text-muted-foreground">📍 {[data.address, data.city].filter(Boolean).join(' · ')}</div>
          )}
          {!data.dest && geocoded && <div className="mt-1 text-[11px] text-muted-foreground">Destino ubicado por dirección (aproximado).</div>}
        </div>
      </section>
    </div>
  );
}
