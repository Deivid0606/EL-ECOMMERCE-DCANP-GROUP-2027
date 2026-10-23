import { supabase } from '@/integrations/supabase/client';
const publicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined;
function decodeKey(value: string): Uint8Array {
  const padded = (value + '='.repeat((4 - value.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
export async function activatePush(userId: string) {
  if (!publicKey) throw new Error('Falta configurar VITE_WEB_PUSH_PUBLIC_KEY en Vercel.');
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Este navegador no admite Web Push o requiere HTTPS. En iPhone instalá primero la app en pantalla de inicio.');
  const reg = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('No se concedió permiso de notificaciones.');
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(publicKey) as BufferSource });
  const s = subscription.toJSON();
  if (!s.endpoint || !s.keys?.p256dh || !s.keys?.auth) throw new Error('El navegador no devolvió una suscripción válida.');
  const {error} = await supabase.from('push_subscriptions' as any).upsert({ user_id: userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, enabled: true, updated_at: new Date().toISOString() } as any, { onConflict: 'endpoint' });
  if (error) throw error;
}
export async function deactivatePush() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  const {error} = await supabase.from('push_subscriptions' as any).delete().eq('endpoint', subscription.endpoint);
  if (error) throw error;
  await subscription.unsubscribe();
}
export async function detachPushOnSignOut() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await supabase.from('push_subscriptions' as any).delete().eq('endpoint', subscription.endpoint);
  await subscription.unsubscribe();
}
