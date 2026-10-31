import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const CHECK_MS = 30_000;
const SEND_EVERY_MS = 10_000;

type GeoPermission = 'granted' | 'prompt' | 'denied' | 'unknown';
const GEO_OK_KEY = 'dcanp-geo-ok';
const SNOOZE_KEY = 'dcanp-geo-snooze';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * Delivery: durante su jornada (pedidos del día sin terminar, hasta "Finalicé
 * mi día") comparte su ubicación para el mapa en vivo y los links de los
 * clientes. Al abrir la app pide el permiso una vez; el navegador lo recuerda.
 * Funciona con la app abierta (el navegador no permite enviar ubicación con la
 * app cerrada).
 */
export default function LiveLocationSharer({ askOnOpen = false }: { askOnOpen?: boolean }) {
  const [active, setActive] = useState(0);
  const [permission, setPermission] = useState<GeoPermission>('unknown');
  const [askOpen, setAskOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [mini, setMini] = useState(() => {
    try {
      return localStorage.getItem('dcanp-geo-mini') === '1';
    } catch {
      return false;
    }
  });
  const setMiniSaved = (v: boolean) => {
    setMini(v);
    try {
      localStorage.setItem('dcanp-geo-mini', v ? '1' : '0');
    } catch {
      // ignorar
    }
  };
  const [error, setError] = useState('');
  const [keepAwake, setKeepAwake] = useState(false);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const wakeLock = useRef<any>(null);

  // Permiso de ubicación: se consulta al abrir la app y se sigue si cambia.
  useEffect(() => {
    if (!askOnOpen || !('geolocation' in navigator)) return;
    let status: PermissionStatus | null = null;
    const apply = (state: GeoPermission) => {
      setPermission(state);
      let snoozed = false;
      try {
        snoozed = sessionStorage.getItem(SNOOZE_KEY) === '1';
      } catch {
        // Sin almacenamiento: se pregunta igual.
      }
      setAskOpen(state === 'denied' || (state === 'prompt' && !snoozed));
    };
    const perms = (navigator as any).permissions;
    if (perms?.query) {
      perms
        .query({ name: 'geolocation' })
        .then((st: PermissionStatus) => {
          status = st;
          apply(st.state as GeoPermission);
          st.onchange = () => apply(st.state as GeoPermission);
        })
        .catch(() => apply('prompt'));
    } else {
      // Navegadores sin consulta de permisos (iPhone viejo): si ya aceptó antes, se pide en silencio.
      let ok = false;
      try {
        ok = localStorage.getItem(GEO_OK_KEY) === '1';
      } catch {
        // ignorar
      }
      if (ok) navigator.geolocation.getCurrentPosition(() => setPermission('granted'), () => apply('prompt'));
      else apply('prompt');
    }
    return () => {
      if (status) status.onchange = null;
    };
  }, [askOnOpen]);

  const requestPermission = () => {
    setAsking(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setAsking(false);
        setPermission('granted');
        setAskOpen(false);
        try {
          localStorage.setItem(GEO_OK_KEY, '1');
        } catch {
          // ignorar
        }
        // Primera ubicación al instante (si tiene jornada activa).
        const { data } = await (supabase as any).rpc('report_delivery_location', {
          p_lat: pos.coords.latitude,
          p_lng: pos.coords.longitude,
          p_accuracy: pos.coords.accuracy,
        });
        if (typeof data === 'number') setActive(data);
      },
      (err) => {
        setAsking(false);
        if (err.code === err.PERMISSION_DENIED) setPermission('denied');
      },
      { enableHighAccuracy: true, timeout: 30_000 },
    );
  };

  const snooze = () => {
    setAskOpen(false);
    try {
      sessionStorage.setItem(SNOOZE_KEY, '1');
    } catch {
      // ignorar
    }
  };

  // ¿Tiene jornada activa o links activos?
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
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError('Permití la ubicación para aparecer en el mapa');
          setPermission('denied');
          if (askOnOpen) setAskOpen(true);
        } else setError('Sin señal de GPS');
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [active, askOnOpen]);

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

  const askCard = askOpen ? (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-background p-5 shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 text-3xl">📍</div>
        {permission === 'denied' ? (
          <>
            <h3 className="mt-3 text-center text-lg font-black">La ubicación está bloqueada</h3>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              Sin ubicación no aparecés en el mapa ni los clientes ven tu 🛵. Activala una vez y queda guardada:
            </p>
            <ul className="mt-3 space-y-1.5 rounded-xl bg-secondary/50 p-3 text-xs">
              {isIOS() ? (
                <>
                  <li>
                    1. <b>Ajustes</b> del iPhone › <b>Privacidad</b> › <b>Localización</b>: activada.
                  </li>
                  <li>
                    2. <b>Ajustes</b> › <b>Safari</b> (o la app que uses) › <b>Ubicación</b> › <b>Permitir</b>.
                  </li>
                  <li>3. Volvé a abrir la app DCANP.</li>
                </>
              ) : (
                <>
                  <li>
                    1. Tocá el <b>🔒 candado</b> o los <b>⋮ tres puntos</b> junto a la dirección de la página.
                  </li>
                  <li>
                    2. <b>Permisos</b> / <b>Configuración del sitio</b> › <b>Ubicación</b> › <b>Permitir</b>.
                  </li>
                  <li>
                    3. En el celular, la ubicación (GPS) también tiene que estar encendida.
                  </li>
                </>
              )}
            </ul>
            <div className="mt-4 flex gap-2">
              <button type="button" className="nav-btn flex-1" onClick={snooze}>
                Después
              </button>
              <button type="button" className="nav-btn active flex-1" onClick={() => window.location.reload()}>
                Ya la activé
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="mt-3 text-center text-lg font-black">Activá tu ubicación</h3>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              Se usa sólo durante tu jornada (mientras tengas pedidos del día y hasta que toques <b>Finalicé mi día</b>) para el mapa en vivo y
              para que tus clientes vean la 🛵 llegando.
            </p>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Cuando el navegador pregunte, elegí <b>Permitir</b>{isIOS() ? '' : ' (o "Permitir siempre en este sitio")'}: queda guardado y no te
              vuelve a preguntar.
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="nav-btn flex-1" onClick={snooze}>
                Ahora no
              </button>
              <button type="button" className="nav-btn active flex-1" disabled={asking} onClick={requestPermission}>
                {asking ? 'Esperando…' : '📍 Activar ubicación'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;

  if (!active) return askCard;

  return (
    <>
    {askCard}
    {mini ? (
      <button
        type="button"
        title="Compartiendo tu ubicación"
        className="fixed bottom-3 left-3 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/40 bg-background/95 text-lg shadow-xl"
        onClick={() => setMiniSaved(false)}
      >
        🛵
        <span className={`absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full ${error ? 'bg-amber-400' : 'animate-pulse bg-emerald-400'}`} />
      </button>
    ) : (
    <div className="fixed bottom-3 left-3 z-50 max-w-[calc(100vw-24px)] rounded-2xl border border-emerald-500/40 bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <button type="button" className="float-right ml-2 text-muted-foreground" onClick={() => setMiniSaved(true)} title="Minimizar">
        ▾
      </button>
      <div className="flex items-center gap-2 font-bold">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        🛵 Compartiendo tu ubicación · {active} entrega{active === 1 ? '' : 's'} pendiente{active === 1 ? '' : 's'}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {error || 'Se apaga solo al tocar "Finalicé mi día". Mantené la app abierta mientras repartís.'}
      </div>
      {'wakeLock' in navigator && (
        <label className="mt-1 flex items-center gap-1.5 text-[11px]">
          <input type="checkbox" checked={keepAwake} onChange={(e) => setKeepAwake(e.target.checked)} />
          Mantener la pantalla encendida
        </label>
      )}
    </div>
    )}
    </>
  );
}
