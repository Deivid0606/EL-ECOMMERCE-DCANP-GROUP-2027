// Convierte un link de Google Maps (incluidos los cortos maps.app.goo.gl que
// genera "Compartir") en coordenadas.
//
// 1. Sigue las redirecciones (el navegador no puede por CORS).
// 2. Si alguna URL trae coordenadas (@lat,lng · q=lat,lng · !3d…!4d…), las usa.
// 3. Si no (al compartir un lugar desde el iPhone llega "?q=Nombre+dirección&ftid=…"),
//    intenta leer la página del lugar y, si tampoco, devuelve el nombre /
//    dirección para que la app lo busque (geocode_place_py).
// Sólo acepta dominios de Google y ubicaciones dentro de Paraguay.
const GOOGLE_HOST = /^([a-z0-9-]+\.)*(goo\.gl|google\.[a-z.]+)$/i;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Paraguay (con margen).
const inParaguay = (lat: number, lng: number) => lat > -28.5 && lat < -18.5 && lng > -63.5 && lng < -53.5;

const COORD_PATTERNS = [
  /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
  /[?&](?:q|query|ll|destination|daddr|center)=(-?\d{1,2}\.\d+)\s*,\s*\+?(-?\d{1,3}\.\d+)/,
  /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
  /\/(?:search|place|dir)\/[^/]*?(-?\d{1,2}\.\d{3,})\s*,\s*\+?(-?\d{1,3}\.\d{3,})/,
];

function coordsFromUrl(raw: string) {
  let text = raw;
  try {
    text = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    // URL con escapes inválidos: se usa tal cual.
  }
  for (const re of COORD_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (inParaguay(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

function coordsFromHtml(html: string) {
  const patterns = [
    /staticmap\?center=(-?\d{1,2}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/i,
    /markers=(-?\d{1,2}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/i,
    /\[null,null,(-?\d{1,2}\.\d{4,}),(-?\d{1,3}\.\d{4,})\]/,
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(new RegExp(re, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (inParaguay(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

// Texto del lugar en la URL (?q=Nombre, dirección · /place/Nombre).
function placeText(u: URL) {
  const q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('destination') || '';
  if (q) return q;
  const m = u.pathname.match(/\/(?:place|search)\/([^/]+)/);
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { url } = await req.json();
    let current = new URL(String(url || '').trim());
    const chain: string[] = [];

    for (let hop = 0; hop < 8; hop++) {
      if (!['http:', 'https:'].includes(current.protocol) || !GOOGLE_HOST.test(current.hostname)) {
        return Response.json({ error: 'Sólo se aceptan links de Google Maps' }, { status: 400, headers: cors });
      }
      chain.push(current.toString());

      const direct = coordsFromUrl(current.toString());
      if (direct) return Response.json({ ...direct, url: current.toString(), via: 'url' }, { headers: cors });

      // Página de consentimiento: el destino real viene en "continue".
      const cont = current.hostname.startsWith('consent.') ? current.searchParams.get('continue') : null;
      if (cont) {
        current = new URL(cont);
        continue;
      }

      const res = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': UA, 'Accept-Language': 'es-PY,es;q=0.9' },
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current);
        continue;
      }

      if (res.ok) {
        const html = (await res.text()).slice(0, 1_500_000);
        const fromPage = coordsFromHtml(html);
        if (fromPage) return Response.json({ ...fromPage, url: current.toString(), via: 'page' }, { headers: cors });
      }
      break;
    }

    // Sin coordenadas: se devuelve el nombre / dirección del lugar; la app lo busca
    // con geocode_place_py (OpenStreetMap bloquea las consultas desde acá).
    console.log('resolve-maps-link sin coordenadas', JSON.stringify(chain));
    return Response.json({ url: current.toString(), lat: null, lng: null, place: placeText(current) || null }, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message || 'Link inválido' }, { status: 400, headers: cors });
  }
});
