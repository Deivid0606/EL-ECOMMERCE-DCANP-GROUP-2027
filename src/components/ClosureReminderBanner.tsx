import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { activatePush, currentPushEndpoint } from '@/lib/pushNotifications';

/**
 * ⏰ Desde las 20:00 (Paraguay), si el delivery tiene el día sin finalizar o
 * entregados sin rendir, se lo recuerda dentro de la app. Si todavía no activó
 * las notificaciones en este celular, ofrece activarlas.
 */

type Status = { today_orders: number; finalized: boolean; to_render: number };

const pyHour = () => new Date(Date.now() - 3 * 3600_000).getUTCHours();
const pyDay = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const HIDE_KEY = 'dcanp-closure-reminder-hidden';

export default function ClosureReminderBanner({ userId, onGo }: { userId: string; onGo: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pushOn, setPushOn] = useState(true);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === pyDay();
    } catch {
      return false;
    }
  });
  const [late, setLate] = useState(pyHour() >= 20);

  useEffect(() => {
    const t = window.setInterval(() => setLate(pyHour() >= 20), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!late) return;
    let alive = true;
    const check = async () => {
      const { data } = await (supabase as any).rpc('my_closure_status');
      if (alive && data) setStatus(data as Status);
    };
    void check();
    const t = window.setInterval(check, 5 * 60_000);
    currentPushEndpoint()
      .then((ep) => alive && setPushOn(Boolean(ep)))
      .catch(() => alive && setPushOn(false));
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [late]);

  if (!late || hidden || !status) return null;
  const dayPending = status.today_orders > 0 && !status.finalized;
  if (!dayPending && status.to_render <= 0) return null;

  const enablePush = async () => {
    try {
      await activatePush(userId);
      setPushOn(true);
      toast.success('🔔 Notificaciones activadas: te avisamos a las 20:00 si tenés el cierre pendiente');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudieron activar las notificaciones');
    }
  };

  return (
    <div className="mx-auto mb-3 max-w-5xl rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/20 to-orange-500/10 p-3 shadow-xl">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-2xl">⏰</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-amber-200">Ya son las 20:00: tu cierre está pendiente</div>
          <div className="text-xs text-amber-100/80">
            {[
              dayPending ? `Finalizá tu día (${status.today_orders} pedido(s) de hoy).` : '',
              status.to_render > 0 ? `Tenés ${status.to_render} pedido(s) entregado(s) para rendir: subí tu comprobante.` : '',
            ]
              .filter(Boolean)
              .join(' ')}
          </div>
        </div>
        <button type="button" className="nav-btn active !py-1.5" onClick={onGo}>
          Ir a Cierres
        </button>
        {!pushOn && (
          <button type="button" className="nav-btn !py-1.5" onClick={() => void enablePush()}>
            🔔 Activar notificaciones
          </button>
        )}
        <button
          type="button"
          className="text-xs text-amber-100/70 underline"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(HIDE_KEY, pyDay());
            } catch {
              /* sin almacenamiento */
            }
          }}
        >
          Ocultar hoy
        </button>
      </div>
    </div>
  );
}
