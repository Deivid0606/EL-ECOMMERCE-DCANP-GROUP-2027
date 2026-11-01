// Copia de src/lib/fuzzyMatch.ts (misma detección que la app). Mantener ambas iguales.
// Detección tolerante a errores de ciudades y productos (pedidos de Shopify / WhatsApp).

/** Minúsculas, sin acentos, sin espacios ni signos. */
export const compactKey = (text: string): string =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]/g, '');

/** Minúsculas, sin acentos, palabras separadas por un espacio. */
export const wordsKey = (text: string): string =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export type CityPrice = { city: string; price: number; departamento: string };
export type CityMatch = CityPrice & { method: 'exacta' | 'alias' | 'contiene' | 'parecida'; score: number };

// Variantes y abreviaturas frecuentes → nombre (compactKey) de la ciudad.
const CITY_ALIASES: Record<string, string> = {
  cde: 'ciudaddeleste',
  cdeleste: 'ciudaddeleste',
  cdedeleste: 'ciudaddeleste',
  ciudadeste: 'ciudaddeleste',
  cneloviedo: 'coroneloviedo',
  coviedo: 'coroneloviedo',
  oviedo: 'coroneloviedo',
  augustosaldivar: 'jaugustosaldivar',
  joseaugustosaldivar: 'jaugustosaldivar',
  saldivar: 'jaugustosaldivar',
  juanleonmallorquin: 'juanleonmalloriquin',
  mallorquin: 'juanleonmalloriquin',
  mra: 'marianoroquealonso',
  mroquealonso: 'marianoroquealonso',
  mauriciotroche: 'mauriciojosetroche',
  mingaguasu: 'mingaguazu',
  puertopresidentefranco: 'presidentefranco',
  ptofranco: 'presidentefranco',
  pdtefranco: 'presidentefranco',
  sanjosearroyos: 'sanjosedelosarroyos',
  santahelena: 'santaelena',
  fdo: 'fernandodelamora',
  fdomora: 'fernandodelamora',
  fernandomora: 'fernandodelamora',
  fdodelamora: 'fernandodelamora',
  pjc: 'pedrojuancaballero',
  pedrojuan: 'pedrojuancaballero',
  slorenzo: 'sanlorenzo',
  stalorenzo: 'sanlorenzo',
  asu: 'asuncion',
  capital: 'asuncion',
  interior: 'interiorpagoanticipado',
  pagoanticipado: 'interiorpagoanticipado',
};

// Abreviaturas comunes en direcciones ("Pto. Pdte. Franco", "Cnel. Oviedo").
const ABBREVIATIONS: Record<string, string> = {
  pdte: 'presidente', pte: 'presidente', pdt: 'presidente', pres: 'presidente',
  pto: 'puerto', pt: 'puerto',
  cnel: 'coronel', cnl: 'coronel',
  gral: 'general', grl: 'general',
  sta: 'santa', sto: 'santo', sn: 'san',
  mcal: 'mariscal', mal: 'mariscal',
  dr: 'doctor', fdo: 'fernando', j: 'jose',
};
const expandAbbreviations = (text: string) =>
  wordsKey(text)
    .split(' ')
    .map((w) => ABBREVIATIONS[w] || w)
    .join(' ');

/**
 * Busca la ciudad de cobertura que corresponde al texto escrito por el cliente,
 * aunque tenga errores, abreviaturas o texto de más ("Barrio X, San Lorenzo").
 */
export function resolveCity(raw: string, cities: CityPrice[], userAliases: Record<string, string> = {}): CityMatch | null {
  const text = String(raw || '').trim();
  if (!text || !cities.length) return null;
  const byKey = new Map(cities.map((c) => [compactKey(c.city), c]));
  const key = compactKey(text);
  if (!key) return null;

  // Alias propio del vendedor (unificó a mano un nombre con una ciudad).
  const own = userAliases[key];
  if (own && compactKey(own) !== key) {
    const viaAlias = resolveCity(own, cities);
    if (viaAlias) return { ...viaAlias, method: 'alias', score: 1 };
  }

  if (byKey.has(key)) return { ...byKey.get(key)!, method: 'exacta', score: 1 };
  if (CITY_ALIASES[key] && byKey.has(CITY_ALIASES[key])) return { ...byKey.get(CITY_ALIASES[key])!, method: 'alias', score: 1 };

  // Con las abreviaturas expandidas ("pto pdte franco" → "puerto presidente franco").
  const expandedText = expandAbbreviations(text);
  const expandedKey = compactKey(expandedText);
  if (expandedKey !== key && byKey.has(expandedKey)) return { ...byKey.get(expandedKey)!, method: 'alias', score: 1 };

  // El nombre de una ciudad aparece dentro del texto (se elige el más largo).
  let contained: CityPrice | null = null;
  for (const c of cities) {
    const ck = compactKey(c.city);
    if (ck.length >= 5 && (key.includes(ck) || expandedKey.includes(ck)) && (!contained || ck.length > compactKey(contained.city).length)) contained = c;
  }
  if (contained) return { ...contained, method: 'contiene', score: 0.95 };

  // Alias dentro del texto ("cde", "mra" sueltos entre otras palabras).
  for (const word of wordsKey(text).split(' ')) {
    const target = CITY_ALIASES[word];
    if (target && byKey.has(target)) return { ...byKey.get(target)!, method: 'alias', score: 0.95 };
  }

  // Parecida (errores de tipeo): se compara el texto completo y cada grupo de 1 a 4 palabras.
  const words = expandedText.split(' ').filter(Boolean);
  const candidates = new Set<string>([key, expandedKey]);
  for (let size = 1; size <= 4; size++) {
    for (let i = 0; i + size <= words.length; i++) candidates.add(words.slice(i, i + size).join(''));
  }
  let best: { city: CityPrice; score: number } | null = null;
  for (const c of cities) {
    const ck = compactKey(c.city);
    for (const cand of candidates) {
      if (cand.length < 3) continue;
      const dist = levenshtein(cand, ck);
      const maxLen = Math.max(cand.length, ck.length);
      const allowed = ck.length <= 5 ? 1 : ck.length <= 9 ? 2 : 3;
      if (dist > allowed) continue;
      const score = 1 - dist / maxLen;
      if (!best || score > best.score) best = { city: c, score };
    }
  }
  if (best && best.score >= 0.75) return { ...best.city, method: 'parecida', score: best.score };
  return null;
}

/** Parecido entre dos títulos de producto (0 a 1) por palabras en común. */
export function titleSimilarity(a: string, b: string): number {
  const stop = new Set(['de', 'la', 'el', 'para', 'con', 'y', 'en', 'del', 'los', 'las', 'un', 'una', 'x']);
  const wa = new Set(wordsKey(a).split(' ').filter((w) => w.length > 1 && !stop.has(w)));
  const wb = new Set(wordsKey(b).split(' ').filter((w) => w.length > 1 && !stop.has(w)));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  wa.forEach((w) => {
    if (wb.has(w) || [...wb].some((x) => x.length > 3 && w.length > 3 && levenshtein(x, w) <= 1)) common++;
  });
  return (2 * common) / (wa.size + wb.size);
}
