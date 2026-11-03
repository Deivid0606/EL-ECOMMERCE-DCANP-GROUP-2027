// Mensajes de WhatsApp al cliente para coordinar la entrega. Cada mensaje de
// una tanda tiene otro saludo, otra forma de pedir la ubicación y otro cierre,
// pero siempre el mismo orden: saludo, detalle del pedido, datos de entrega,
// ubicación, link de seguimiento y cierre.
//
// Sólo emojis «clásicos» (✅ ⭐ ✨ ☎️ ⏰ ➡️): los links de WhatsApp (wa.me) rompen los
// emojis nuevos (📍 🛵 👋…) y llegan como «�».

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(Number(n) || 0));

const items = (order: any): any[] => {
  try {
    const raw = typeof order?.items_json === 'string' ? JSON.parse(order.items_json || '[]') : order?.items_json || [];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
const firstName = (full: string) => cap(String(full || '').trim().split(/\s+/)[0] || '');

/** Teléfono como lo escribe la gente en Paraguay: 0971 224 024. */
export const localPhone = (phone: string) => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('595')) d = d.slice(3);
  if (!d.startsWith('0')) d = `0${d}`;
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : d;
};

const LINE = '━━━━━━━━━━━━━━━━━━━━';
// WhatsApp no centra: se agregan espacios «de cifra» (no se borran) delante del texto.
const PAD = '\u2007';
const WIDTH = 30;
export const centered = (text: string) => {
  const visible = text.replace(/\*/g, '').replace(/[\uFE0F]/g, '').length;
  return PAD.repeat(Math.max(0, Math.round((WIDTH - visible) / 2.4))) + text;
};
const section = (title: string, lines: string[]) => [LINE, centered(title), LINE, ...lines].join('\n');

const GREETINGS = [
  (n: string) => `*¡Buenas ${n}!* ✨\nLe escribo para coordinar la entrega de su pedido.`,
  (n: string) => `*¡Hola ${n}!* ✨\nLe escribo por la entrega de su pedido.`,
  (n: string) => `*¡Buen día ${n}!* ⭐\nSoy el delivery que le va a llevar su pedido.`,
  (n: string) => `*¿Qué tal ${n}?* ✨\nMe comunico para coordinar la entrega de su compra.`,
  (n: string) => `*¡Hola ${n}! ¿Cómo está?* ⭐\nTengo su pedido listo para entregar.`,
  (n: string) => `*¡Saludos ${n}!* ✨\nLe escribo para coordinar cuándo le entrego su pedido.`,
  (n: string) => `*¡Buenas ${n}!* ⭐\nHoy salgo con su pedido y quería coordinar con usted.`,
];

const ASKS = [
  '¿Me podría enviar su *ubicación de Google Maps* para realizar la entrega?',
  '¿Me pasa su *ubicación de Google Maps* así llego sin problema?',
  'Para no perderme, ¿me comparte su *ubicación* por WhatsApp? (Adjuntar > Ubicación)',
  '¿Me confirma la dirección y me envía su *ubicación de Google Maps*, por favor?',
  '¿Me podría mandar su *ubicación actual* para organizar el recorrido?',
];

// Cuando el vendedor ya cargó la ubicación: sólo se confirma, no se vuelve a pedir.
const CONFIRMS = [
  'Ya tengo su *ubicación cargada*. ¿Me confirma que es ahí donde lo recibe?',
  'Tengo su *ubicación en el mapa*. ¿Me confirma que la entrega es en ese lugar?',
  'Ya cuento con su *ubicación*. ¿Sigue siendo la misma para la entrega?',
];

const TRACK_TITLES = ['➡️ *Siga su pedido en vivo:*', '➡️ *Vea cuándo llega su pedido:*', '➡️ *Link de seguimiento de su pedido:*'];

const CLOSINGS = [
  'Quedo atento a su respuesta. *¡Gracias!* ⭐',
  '*¡Muchas gracias!* Cualquier consulta me escribe por acá. ✨',
  'Le aviso cuando esté en camino. *¡Gracias!* ⭐',
  '*Gracias, quedo atento.* ✨',
  '⏰ ¿En qué horario le queda mejor recibir? *¡Gracias!*',
];

/** Detalle del pedido y datos de entrega (sin precios por producto: sólo el total a pagar). */
export function orderGuideText(order: any, phone: string) {
  const list = items(order);
  const products = list.length
    ? list.map((it) => `▪️ ${String(it.title || it.name || it.sku || 'Producto').trim()} *x${Number(it.qty || it.quantity || it.cantidad || 1)}*`)
    : ['▪️ Sin detalle de productos'];
  const address = [String(order?.street || '').trim(), String(order?.district || '').trim()].filter(Boolean).join(', ');
  const detail = section('✅ *DETALLE DE SU PEDIDO*', [
    `*Pedido:* ${order?.order_number || String(order?.id || '').slice(0, 8) || '-'}`,
    ...products,
    '',
    centered(`*TOTAL A PAGAR: Gs ${nf(Number(order?.total_gs || 0))}*`),
  ]);
  const delivery = section(
    '☎️ *DATOS DE ENTREGA*',
    [
      `*Cliente:* ${String(order?.customer_name || '').trim().split(/\s+/).map(cap).join(' ')}`,
      `*Teléfono:* ${localPhone(phone)}`,
      `*Ciudad:* ${String(order?.city || '').trim()}`,
      address ? `*Dirección:* ${address}` : '',
    ].filter(Boolean),
  );
  return `${detail}\n\n${delivery}`;
}

/**
 * Mensaje número `index` de una tanda: mensajes seguidos nunca repiten el mismo
 * saludo, pedido de ubicación ni cierre. Con `trackUrl` suma el link de
 * seguimiento; con `hasLocation` confirma la ubicación en vez de pedirla.
 */
export function customerMessageVariant(order: any, phone: string, index: number, trackUrl?: string | null, hasLocation = false) {
  const name = firstName(order?.customer_name);
  const greeting = GREETINGS[index % GREETINGS.length](name)
    .split('\n')
    .map((l, i) => (i === 0 ? centered(l) : l))
    .join('\n');
  const ask = hasLocation ? CONFIRMS[index % CONFIRMS.length] : ASKS[(index * 2 + 1) % ASKS.length];
  const closing = CLOSINGS[(index * 3 + 2) % CLOSINGS.length];
  const blocks = [greeting, orderGuideText(order, phone), ask];
  if (trackUrl) blocks.push(`${TRACK_TITLES[index % TRACK_TITLES.length]}\n${trackUrl}`);
  blocks.push(`${LINE}\n${centered(closing)}`);
  // Una línea en blanco entre cada bloque para que se lea ordenado.
  return blocks.join('\n\n');
}
