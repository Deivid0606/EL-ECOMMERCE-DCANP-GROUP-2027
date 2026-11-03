// Mensajes de WhatsApp al cliente para coordinar la entrega: cada uno con un
// saludo y una forma de pedir la ubicación distinta, pero siempre con la guía
// completa del pedido (número, cliente, ciudad, dirección, productos y total).

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(Number(n) || 0));

const items = (order: any): any[] => {
  try {
    const raw = typeof order?.items_json === 'string' ? JSON.parse(order.items_json || '[]') : order?.items_json || [];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

const firstName = (full: string) => String(full || '').trim().split(/\s+/)[0] || '';

const GREETINGS = [
  (n: string) => `*Buenas ${n}, le escribo para coordinar la entrega de su pedido.*`,
  (n: string) => `*Hola ${n}! 👋 Le escribo por la entrega de su pedido.*`,
  (n: string) => `*Buen día ${n}, soy el delivery que le va a llevar su pedido 🛵*`,
  (n: string) => `*¿Qué tal ${n}? Me comunico para coordinar la entrega de su compra.*`,
  (n: string) => `*Hola ${n}, ¿cómo está? Tengo su pedido listo para entregar.*`,
  (n: string) => `*Saludos ${n} 😊 Le escribo para coordinar cuándo le entrego su pedido.*`,
  (n: string) => `*Buenas ${n}! Hoy salgo con su pedido y quería coordinar con usted.*`,
];

const ASKS = [
  '*¿Me podría enviar su ubicación por Google Maps para poder realizar la entrega?*',
  '*¿Me pasa su ubicación de Google Maps así llego sin problema?*',
  '*Para no perderme, ¿me comparte la ubicación por WhatsApp (📍 Ubicación)?*',
  '*¿Me confirma la dirección y me envía la ubicación de Google Maps, por favor?*',
  '*¿Me podría mandar su ubicación actual para organizar el recorrido?*',
];

const CLOSINGS = [
  'Quedo atento a su respuesta. ¡Gracias!',
  '¡Muchas gracias! Cualquier consulta me escribe por acá.',
  'Le aviso cuando esté en camino 🙌',
  'Gracias, quedo atento 👍',
  '¿En qué horario le queda mejor recibir?',
];

/** Guía del pedido (sin precios por producto: sólo el total a cobrar). */
export function orderGuideText(order: any, phone: string) {
  const list = items(order);
  const products = list.length
    ? list.map((it, i) => `${i + 1}. ${String(it.title || it.name || it.sku || 'Producto').trim()} x${Number(it.qty || it.quantity || it.cantidad || 1)}`).join('\n')
    : 'Sin detalle de productos';
  const address = [String(order?.street || '').trim(), String(order?.district || '').trim()].filter(Boolean).join(', ');
  return [
    `GUÍA DE ENVÍO — ${order?.order_number || String(order?.id || '').slice(0, 8) || '—'}`,
    `Cliente: ${order?.customer_name || ''}`,
    `Teléfono: ${phone}`,
    `Ciudad: ${order?.city || ''}`,
    address ? `Dirección: ${address}` : '',
    'Productos:',
    products,
    `Total: Gs ${nf(Number(order?.total_gs || 0))}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// Cuando el vendedor ya cargó la ubicación: sólo se confirma, no se vuelve a pedir.
const CONFIRMS = [
  '*Ya tengo su ubicación cargada 📍 ¿Me confirma que es ahí donde lo recibe?*',
  '*Tengo su ubicación en el mapa. ¿Me confirma que la entrega es en ese lugar?*',
  '*Ya cuento con su ubicación 👍 ¿Sigue siendo la misma para la entrega?*',
];

const TRACK_LINES = [
  (u: string) => `📍 Seguí tu pedido en vivo acá: ${u}`,
  (u: string) => `🛵 Podés ver cuándo llega tu pedido en este link: ${u}`,
  (u: string) => `📲 Link de seguimiento de tu pedido: ${u}`,
];

/**
 * Mensaje número `index` de una tanda: mensajes seguidos nunca repiten el mismo
 * saludo, pedido de ubicación ni cierre. Con `trackUrl` suma el link de
 * seguimiento; con `hasLocation` confirma la ubicación en vez de pedirla.
 */
export function customerMessageVariant(order: any, phone: string, index: number, trackUrl?: string | null, hasLocation = false) {
  const name = firstName(order?.customer_name) || '';
  const g = GREETINGS[index % GREETINGS.length](name);
  const a = hasLocation ? CONFIRMS[index % CONFIRMS.length] : ASKS[(index * 2 + 1) % ASKS.length];
  const c = CLOSINGS[(index * 3 + 2) % CLOSINGS.length];
  const track = trackUrl ? ['', TRACK_LINES[index % TRACK_LINES.length](trackUrl)] : [];
  return [g, '', a, '', orderGuideText(order, phone), ...track, '', c].join('\n');
}
