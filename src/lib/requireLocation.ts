import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export const LOCATION_HELP = isIOS()
  ? 'Activala en Ajustes › Privacidad › Localización (encendida) y en Ajustes › Safari › Ubicación › Permitir. Después volvé a intentar.'
  : 'Tocá el 🔒 junto a la dirección de la página › Permisos › Ubicación › Permitir, y encendé el GPS del celular. Después volvé a intentar.';

/** Mensaje del servidor sin el código interno. */
export const cleanLocationError = (msg: string) =>
  String(msg || '').includes('UBICACION_REQUERIDA') ? `📍 Activá tu ubicación para reportar tus pedidos. ${LOCATION_HELP}` : msg;

/**
 * El delivery sólo puede reportar con la ubicación prendida: toma la ubicación
 * actual y la envía. Si no se puede, avisa cómo activarla y devuelve false.
 */
export async function requireDeliveryLocation(): Promise<boolean> {
  if (!('geolocation' in navigator)) {
    toast.error('📍 Este celular no permite compartir la ubicación: no podés reportar pedidos desde acá.', { duration: 10000 });
    return false;
  }
  const loading = toast.loading('📍 Verificando tu ubicación…');
  const pos = await new Promise<GeolocationPosition | null>((resolve) =>
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000,
    }),
  );
  toast.dismiss(loading);
  if (!pos) {
    toast.error(`📍 Tenés que prender la ubicación para reportar tus pedidos. ${LOCATION_HELP}`, { duration: 15000 });
    return false;
  }
  const { error } = await (supabase as any).rpc('report_delivery_location', {
    p_lat: pos.coords.latitude,
    p_lng: pos.coords.longitude,
    p_accuracy: pos.coords.accuracy,
  });
  if (error) {
    toast.error(`No se pudo enviar tu ubicación: ${error.message}`);
    return false;
  }
  return true;
}
