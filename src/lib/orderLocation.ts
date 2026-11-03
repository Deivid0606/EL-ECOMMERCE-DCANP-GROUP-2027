// Link de Google Maps o coordenadas que el vendedor pegó en la dirección / observación.
const LOCATION_RE =
  /(https?:\/\/\S*(?:goo\.gl|google\.[a-z.]+\/maps|maps\.google|maps\.app)\S*)|(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/i;

export function orderLocationText(order: any): string | null {
  for (const field of [order?.street, order?.district, order?.obs, order?.address, order?.reference]) {
    const m = String(field || '').match(LOCATION_RE);
    if (m) return m[1] || `${m[2]}, ${m[3]}`;
  }
  return null;
}

/**
 * ¿La dirección escrita es una calle real? (no un RUC, un número suelto o «-»).
 * Pide letras, al menos dos palabras y algo de dirección: un número de casa o
 * palabras como «casi», «esquina», «entre», «calle», «avda», «barrio».
 */
export function hasStreetAddress(order: any): boolean {
  const text = [order?.street, order?.district].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
  if (!text) return false;
  if (/^(ruc|r\.u\.c|ci|c\.i|cedula|cédula|doc)\b/i.test(text)) return false;
  const words = text.split(/\s+/).filter((w) => /[a-záéíóúñ]{2,}/i.test(w));
  if (words.length < 2) return false;
  return /\d/.test(text) || /\b(casi|esq|esquina|entre|calle|c\/|avda|avenida|av\.?|ruta|km|barrio|b°|bº|villa|compañ[ií]a|frente|detr[aá]s|al lado)\b/i.test(text);
}

/** El pedido tiene ubicación o dirección suficiente para mandar el link de seguimiento. */
export const canSendTracking = (order: any) => Boolean(orderLocationText(order)) || hasStreetAddress(order);
