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
