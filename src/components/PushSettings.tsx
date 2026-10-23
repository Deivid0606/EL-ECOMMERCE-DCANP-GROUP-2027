import {useEffect, useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {activatePush, deactivatePush} from '@/lib/pushNotifications';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
export default function PushSettings() {
  const {user} = useAuth();
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration('/').then(async reg => {
      const s = await reg?.pushManager.getSubscription();
      if (!s) { setActive(false); return; }
      const {data} = await supabase.from('push_subscriptions' as any).select('id').eq('endpoint', s.endpoint).eq('user_id', user.id).maybeSingle();
      setActive(Boolean(data));
    }).catch(() => setActive(false));
  }, [user]);
  const change = async () => {
    if (!user) return;
    setBusy(true);
    try {
      if (active) { await deactivatePush(); setActive(false); toast.success('Notificaciones desactivadas en este dispositivo'); }
      else { await activatePush(user.id); setActive(true); toast.success('Notificaciones activadas en este dispositivo'); }
    } catch(e) { toast.error(e instanceof Error ? e.message : 'No fue posible cambiar las notificaciones'); }
    finally {setBusy(false);}
  };
  return <div className="app-card !p-4 mt-4">
    <h4 className="font-extrabold">🔔 Notificaciones al celular</h4>
    <p className="text-sm text-muted-foreground mb-3">Recibí avisos de mensajes, pedidos, comisiones, productos y stock. En iPhone instalá la aplicación en la pantalla de inicio antes de activar.</p>
    <button type="button" className="nav-btn active" disabled={busy || !user} onClick={change}>{busy?'Guardando...':active?'Desactivar notificaciones':'Activar notificaciones'}</button>
    <p className="text-xs text-muted-foreground mt-2">Estado en este dispositivo: {active?'Activadas':'Desactivadas'}</p>
  </div>;
}
