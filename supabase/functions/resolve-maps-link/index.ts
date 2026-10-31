// Resuelve links cortos de Google Maps (maps.app.goo.gl, goo.gl/maps) a la URL
// final, que trae las coordenadas. El navegador no puede seguir la redirección
// por CORS, por eso se hace acá. Sólo acepta dominios de Google Maps.
const ALLOWED = /^(maps\.app\.goo\.gl|goo\.gl|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+)$/i;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { url } = await req.json();
    let current = new URL(String(url || '').trim());

    for (let hop = 0; hop < 6; hop++) {
      if (!['http:', 'https:'].includes(current.protocol) || !ALLOWED.test(current.hostname)) {
        return Response.json({ error: 'Sólo se aceptan links de Google Maps' }, { status: 400, headers: cors });
      }
      const res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (DCANP)' } });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current);
        continue;
      }
      // Las coordenadas se leen sólo de la URL final (el HTML trae otras
      // ubicaciones, por ejemplo la del servidor).
      return Response.json({ url: current.toString() }, { headers: cors });
    }
    return Response.json({ url: current.toString() }, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message || 'Link inválido' }, { status: 400, headers: cors });
  }
});
