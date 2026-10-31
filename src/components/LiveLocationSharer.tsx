import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const CHECK_MS = 30_000;
const SEND_EVERY_MS = 10_000;

/**
 * Delivery: mientras tenga links de seguimiento activos, comparte su ubicación
 * para que el cliente vea la 🛵 en vivo. Funciona con la app abierta (el
 * navegador no permite enviar ubicación con la pantalla apagada).
 */
export default function LiveLocationSharer() {
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');
  const [keepAwake, setKeepAwake] = useState(false);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const wakeLock = useRef<any>(null);

  // ¿Hay links activos?
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const { data } = await (supabase as any).rpc('my_active_tracking_count');
      if (alive) setActive(Number(data || 0));
    };
    void check();
    const timer = window.setInterval(check, CHECK_MS);
    // Al volver a la app (desbloquear el celular, cambiar de pestaña) se revisa al instante.
    const onVisible = () => document.visibilityState === 'visible' && void check();
    window.addEventListener('dcanp-tracking-created', check);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('dcanp-tracking-created', check);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, []);

  // Compartir ubicación sólo con links activos.
  useEffect(() => {
    if (!active || !('geolocation' in navigator)) return;
    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        setError('');
        if (Date.now() - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = Date.now();
        const { data } = await (supabase as any).rpc('report_delivery_location', {
          p_lat: pos.coords.latitude,
          p_lng: pos.coords.longitude,
          p_accuracy: pos.coords.accuracy,
        });
        if (typeof data === 'number') setActive(data);
      },
      (err) => setError(err.code === err.PERMISSION_DENIED ? 'Permití la ubicación para que el cliente vea tu recorrido' : 'Sin señal de GPS'),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [active]);

  // Pantalla encendida mientras comparte (si el navegador lo permite).
  useEffect(() => {
    const nav = navigator as any;
    if (!active || !keepAwake || !nav.wakeLock) return;
    let released = false;
    const request = async () => {
      try {
        wakeLock.current = await nav.wakeLock.request('screen');
      } catch {
        setKeepAwake(false);
      }
    };
    void request();
    const onVisible = () => document.visibilityState === 'visible' && !released && void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      void wakeLock.current?.release?.();
    };
  }, [active, keepAwake]);

  if (!active) return null;

  return (
    <div className="fixed bottom-3 left-3 z-50 max-w-[calc(100vw-24px)] rounded-2xl border border-emerald-500/40 bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="flex items-center gap-2 font-bold">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        🛵 Compartiendo tu ubicación en vivo · {active} entrega{active === 1 ? '' : 's'}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {error || 'Mantené la app abierta hasta entregar.'}
      </div>
      {'wakeLock' in navigator && (
        <label className="mt-1 flex items-center gap-1.5 text-[11px]">
          <input type="checkbox" checked={keepAwake} onChange={(e) => setKeepAwake(e.target.checked)} />
          Mantener la pantalla encendida
        </label>
      )}
    </div>
  );
}
