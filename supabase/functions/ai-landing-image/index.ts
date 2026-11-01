// Genera UNA imagen de venta para la página (Mi Tienda › Páginas) con el
// generador de imágenes de OpenAI, usando la foto real del producto como
// referencia para que el producto se vea igual. La guarda en el bucket
// landing-media y devuelve la URL pública.
//
// Requiere el secreto OPENAI_API_KEY en Supabase (Edge Functions › Secrets).
// Opcional: OPENAI_IMAGE_MODEL (por defecto gpt-image-1).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const DAILY_LIMIT = 60;
const BUCKET = 'landing-media';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const STYLE =
  'Professional e-commerce advertising photo shot by a commercial photographer for a Paraguayan online store. Photorealistic, studio-quality lighting, sharp focus, rich colors, shallow depth of field, premium and modern look, ' +
  'high detail, vertical-friendly composition with the product clearly visible and recognizable. ' +
  'Keep the product exactly as in the reference photo (same shape, colors and details). ' +
  'Do NOT add any text, letters, logos, watermarks or prices to the image.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    return json({ error: 'Las imágenes con IA todavía no están activadas: falta cargar la clave OPENAI_API_KEY en Supabase.' }, 503);
  }
  const model = Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-1';

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  });
  const { data: auth } = await userClient.auth.getUser();
  const email = auth.user?.email?.toLowerCase();
  if (!email) return json({ error: 'Iniciá sesión para usar la IA' }, 401);

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin
    .from('ai_generations')
    .select('id', { count: 'exact', head: true })
    .eq('user_email', email)
    .eq('kind', 'landing_image')
    .gte('created_at', since);
  if ((count || 0) >= DAILY_LIMIT) {
    return json({ error: `Llegaste al límite de ${DAILY_LIMIT} imágenes por día. Probá mañana.` }, 429);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Datos inválidos' }, 400);
  }
  const scene = String(body?.prompt || '').slice(0, 2000);
  const productTitle = String(body?.productTitle || '').slice(0, 200);
  if (!scene) return json({ error: 'Falta la descripción de la imagen' }, 400);
  const hook = String(body?.hook || '').slice(0, 60);
  const style = hook
    ? STYLE.replace(
        'Do NOT add any text, letters, logos, watermarks or prices to the image.',
        `Write ONLY this Spanish headline in the image, big, bold and perfectly spelled: "${hook}". No other text, no prices, no logos, no watermarks.`,
      )
    : STYLE;
  const prompt = `${style}\nProduct: ${productTitle}.\nScene: ${scene}`;
  const quality = body?.quality === 'high' ? 'high' : 'medium';

  // Foto real del producto como referencia (si se puede descargar).
  let reference: Blob | null = null;
  const refUrl = String(body?.referenceUrl || '');
  if (/^https:\/\//.test(refUrl)) {
    try {
      const r = await fetch(refUrl);
      const type = r.headers.get('content-type') || '';
      if (r.ok && /image\/(png|jpe?g|webp)/.test(type)) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.byteLength < 20 * 1024 * 1024) reference = new Blob([bytes], { type: type.split(';')[0] });
      }
    } catch {
      // Sin referencia: se genera sólo con la descripción.
    }
  }

  let res: Response;
  if (reference) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', '1024x1024');
    form.append('quality', quality);
    form.append('n', '1');
    const ext = reference.type.includes('png') ? 'png' : reference.type.includes('webp') ? 'webp' : 'jpg';
    form.append('image', reference, `product.${ext}`);
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: '1024x1024', quality, n: 1 }),
    });
  }

  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('openai image error', res.status, JSON.stringify(out).slice(0, 500));
    if (res.status === 401) return json({ error: 'La clave OPENAI_API_KEY no es válida.' }, 503);
    if (res.status === 429) return json({ error: 'El generador de imágenes está ocupado o sin saldo. Probá en un minuto.' }, 429);
    if (res.status === 400 && /safety|moderation/i.test(JSON.stringify(out))) {
      return json({ error: 'El generador no aceptó esta imagen. Probá con otra descripción.' }, 422);
    }
    return json({ error: 'No se pudo generar la imagen. Probá de nuevo.' }, 502);
  }

  const item = out?.data?.[0];
  let bytes: Uint8Array | null = null;
  if (item?.b64_json) {
    bytes = Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0));
  } else if (item?.url) {
    const img = await fetch(item.url);
    if (img.ok) bytes = new Uint8Array(await img.arrayBuffer());
  }
  if (!bytes) return json({ error: 'El generador no devolvió la imagen.' }, 502);

  const path = `${email}/ai/${crypto.randomUUID()}.png`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: false });
  if (upErr) {
    console.error(upErr);
    return json({ error: 'No se pudo guardar la imagen.' }, 500);
  }
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);

  await admin.from('ai_generations').insert({ user_email: email, kind: 'landing_image', product_title: productTitle });
  return json({ url: pub.publicUrl });
});
