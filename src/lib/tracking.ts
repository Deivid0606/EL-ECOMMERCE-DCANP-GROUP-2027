import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type LatLng = { lat: number; lng: number };

// Lee coordenadas de un link de Google Maps / WhatsApp o de "lat, lng".
export function parseCoords(text: string): LatLng | null {
  const value = decodeURIComponent(String(text || '').trim());
  if (!value) return null;
  const patterns = [
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, // .../@-25.28,-57.63,17z
    /[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, // ?q=-25.28,-57.63
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, // ...!3d-25.28!4d-57.63
    /^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/, // -25.28, -57.63
  ];
  for (const re of patterns) {
    const m = value.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

// Distancia en km (línea recta).
export function distanceKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Llegada aproximada en moto: distancia por calles ≈ 1,35 × línea recta, a 25 km/h.
export function etaMinutes(from: LatLng, to: LatLng) {
  const km = distanceKm(from, to) * 1.35;
  return { km, minutes: Math.max(1, Math.round((km / 25) * 60)) };
}

export const trackingUrl = (token: string) => `${window.location.origin}/?seguimiento=${token}`;

/**
 * Genera el link de seguimiento de un pedido, lo copia y ofrece enviarlo por
 * WhatsApp al cliente. Pide (opcional) la ubicación del cliente para calcular
 * la llegada estimada.
 */
export async function generateTrackingLink(order: { id: string; phone?: string | null; customer_name?: string | null; order_number?: string | null }) {
  const answer = window.prompt(
    'Ubicación del cliente (opcional, para calcular la llegada):\n' +
      'pegá el link de Google Maps o la ubicación que te mandó por WhatsApp, o "latitud, longitud".\n' +
      'Dejalo vacío para usar la dirección del pedido.',
    '',
  );
  if (answer === null) return null;

  const dest = answer.trim() ? parseCoords(answer) : null;
  if (answer.trim() && !dest) {
    toast.error('No se pudo leer la ubicación. Pegá un link de Google Maps con coordenadas o "latitud, longitud".');
    return null;
  }

  const { data, error } = await (supabase as any).rpc('create_tracking_link', {
    p_order_id: order.id,
    p_dest_lat: dest?.lat ?? null,
    p_dest_lng: dest?.lng ?? null,
  });
  if (error || !data) {
    toast.error(error?.message || 'No se pudo generar el link');
    return null;
  }

  const url = trackingUrl(String(data));
  try {
    await navigator.clipboard.writeText(url);
    toast.success('🛵 Link de seguimiento copiado');
  } catch {
    toast.success('🛵 Link de seguimiento generado');
  }

  const phone = String(order.phone || '').replace(/\D/g, '').replace(/^0/, '595');
  const name = String(order.customer_name || '').split(' ')[0];
  const text = `Hola${name ? ` ${name}` : ''} 👋 Tu pedido${order.order_number ? ` ${order.order_number}` : ''} está en camino 🛵. Seguilo en vivo acá: ${url}`;
  if (phone.length >= 9 && window.confirm('¿Enviar el link al cliente por WhatsApp?')) {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }
  return url;
}
