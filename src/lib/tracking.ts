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

// Busca un lugar o dirección de Paraguay y pide confirmar el resultado.
async function geocodeAndConfirm(place: string): Promise<LatLng | null> {
  const { data, error } = await (supabase as any).rpc('geocode_place_py', { p_text: place });
  if (error || !data?.lat) return null;
  const ok = window.confirm(
    `Encontré esta ubicación${data.approx ? ' (aproximada)' : ''}:\n\n${data.name}\n\n¿Usarla como destino del cliente?`,
  );
  return ok ? { lat: Number(data.lat), lng: Number(data.lng) } : null;
}

// Acepta: coordenadas, links de Google Maps (también los cortos de "Compartir",
// que se resuelven en el servidor) o una dirección escrita.
export async function resolveCoords(text: string): Promise<LatLng | null> {
  const direct = parseCoords(text);
  if (direct) return direct;

  const url = String(text || '').match(/https?:\/\/\S+/)?.[0];
  if (url && /goo\.gl|google\./i.test(url)) {
    const { data, error } = await supabase.functions.invoke('resolve-maps-link', { body: { url } });
    if (error) return null;
    if (data?.lat && data?.lng) return { lat: Number(data.lat), lng: Number(data.lng) };
    const fromUrl = data?.url ? parseCoords(String(data.url)) : null;
    if (fromUrl) return fromUrl;
    // Lugar compartido sin coordenadas (iPhone): se busca por nombre y dirección.
    if (data?.place) return geocodeAndConfirm(String(data.place));
    return null;
  }

  // Dirección escrita a mano.
  if (!url && String(text || '').trim().length > 5) return geocodeAndConfirm(String(text).trim());
  return null;
}

export const trackingUrl = (token: string) => `${window.location.origin}/?seguimiento=${token}`;

/**
 * Genera el link de seguimiento de un pedido, lo copia y ofrece enviarlo por
 * WhatsApp al cliente. Pide (opcional) la ubicación del cliente para calcular
 * la llegada estimada.
 */
export async function generateTrackingLink(order: { id: string; phone?: string | null; customer_name?: string | null; order_number?: string | null; status?: string | null; assigned_delivery?: string | null }) {
  const answer = window.prompt(
    'Ubicación del cliente (opcional, para calcular la llegada):\n' +
      'pegá el link de Google Maps (también el de "Compartir"), la ubicación que te mandó por WhatsApp, "latitud, longitud" o la dirección.\n' +
      'Dejalo vacío para usar la dirección del pedido.',
    '',
  );
  if (answer === null) return null;

  const loading = answer.trim() ? toast.loading('Buscando la ubicación…') : undefined;
  const dest = answer.trim() ? await resolveCoords(answer) : null;
  if (loading !== undefined) toast.dismiss(loading);
  if (answer.trim() && !dest) {
    toast.error('No se encontró la ubicación. En Google Maps mantené apretado el punto exacto del cliente, copiá las coordenadas que aparecen arriba (ej. -25.3092, -57.6325) y pegalas.', { duration: 10000 });
    return null;
  }

  // ¿Quién muestra la 🛵? Por defecto el delivery asignado; admin / proveedor
  // pueden usar su propio celular (entrega en persona o para probar).
  const { data: auth } = await supabase.auth.getUser();
  const me = String(auth.user?.email || '').toLowerCase();
  const assigned = String(order.assigned_delivery || '').toLowerCase();
  const selfTracker =
    Boolean(me) &&
    me !== assigned &&
    window.confirm(
      `¿La 🛵 sos VOS desde este celular?\n\n` +
        `Aceptar: se muestra la ubicación de ESTE celular (entregás vos o estás probando).\n` +
        `Cancelar: se muestra la ubicación del delivery asignado${assigned ? ` (${assigned})` : ''} cuando abra la app.`,
    );

  const { data, error } = await (supabase as any).rpc('create_tracking_link', {
    p_order_id: order.id,
    p_dest_lat: dest?.lat ?? null,
    p_dest_lng: dest?.lng ?? null,
    p_self_tracker: selfTracker,
  });
  if (error || !data) {
    toast.error(error?.message || 'No se pudo generar el link');
    return null;
  }

  const url = trackingUrl(String(data));

  const digits = String(order.phone || '').replace(/\D/g, '');
  const phone = digits.startsWith('595') ? digits : digits.replace(/^0/, '595');
  const name = String(order.customer_name || '').trim().split(/\s+/)[0];
  const text = `Hola${name ? ` ${name}` : ''} 👋 Tu pedido${order.order_number ? ` ${order.order_number}` : ''} está en camino 🛵. Seguilo en vivo acá: ${url}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Sin portapapeles: se puede copiar desde el aviso.
  }
  const waUrl = phone.length >= 11 ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;

  // El iPhone bloquea abrir WhatsApp después de esperar al servidor: se abre
  // con un toque en el botón del aviso (gesto del usuario).
  toast.success('🛵 Link de seguimiento listo', {
    description:
      (order.status && String(order.status).toUpperCase() !== 'EN RUTA'
        ? `Ojo: el pedido está en ${order.status}; el cliente lo ve así hasta que pase a EN RUTA. `
        : '') +
      (phone.length >= 11 ? `Tocá "Enviar por WhatsApp" para mandárselo al ${digits}. ` : 'Tocá "Enviar por WhatsApp" y elegí el chat del cliente. ') +
      (selfTracker
        ? 'La 🛵 es este celular: dejá la app abierta y permití la ubicación.'
        : 'La motito aparece cuando el delivery abre la app DCANP y acepta la ubicación.'),
    duration: 60000,
    action: {
      label: '📲 Enviar por WhatsApp',
      onClick: () => {
        // Nueva pestaña (en PC no se sale de la app); si el navegador la bloquea, se abre acá.
        const tab = window.open(waUrl, '_blank', 'noopener');
        if (!tab) window.location.href = waUrl;
      },
    },
    cancel: {
      label: '📋 Copiar mensaje',
      onClick: () => {
        // El mismo mensaje que se manda por WhatsApp, para pegarlo a mano.
        void navigator.clipboard?.writeText(text).then(
          () => toast.success('Mensaje copiado: pegalo en el chat del cliente'),
          () => window.prompt('Copiá el mensaje:', text),
        );
      },
    },
  });
  return url;
}

export const routeUrl = (token: string) => `${window.location.origin}/?ruta=${token}`;

/**
 * Link global de la ruta del día de un delivery: el cliente ve la 🛵 y cuántas
 * entregas tiene antes (sin datos de otros clientes). Sin email = mi propia ruta.
 */
export async function generateRouteLink(deliveryEmail?: string | null, name?: string | null) {
  const { data, error } = await (supabase as any).rpc('create_route_link', { p_delivery_email: deliveryEmail ?? null });
  if (error || !data) {
    toast.error(error?.message || 'No se pudo generar el link de ruta');
    return null;
  }
  const url = routeUrl(String(data));
  const who = String(name || '').trim();
  const text = `Hola 👋 Seguí en vivo la ruta de entregas${who ? ` de ${who}` : ''} de hoy 🛵 y mirá cuántas entregas faltan antes de la tuya: ${url}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Sin portapapeles: se copia desde el aviso.
  }
  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  toast.success('🌐 Link de ruta listo', {
    description: 'Sirve para todos los clientes del día: ven la 🛵 en vivo y las entregas pendientes (sin datos de los demás).',
    duration: 60000,
    action: {
      label: '📲 Enviar por WhatsApp',
      onClick: () => {
        const tab = window.open(waUrl, '_blank', 'noopener');
        if (!tab) window.location.href = waUrl;
      },
    },
    cancel: {
      label: '📋 Copiar mensaje',
      onClick: () => {
        void navigator.clipboard?.writeText(text).then(
          () => toast.success('Mensaje copiado'),
          () => window.prompt('Copiá el mensaje:', text),
        );
      },
    },
  });
  return url;
}
