// Genera con Claude los textos de una página de venta (Mi Tienda › Páginas)
// a partir del producto seleccionado: título, descripción, precio, garantía y
// fotos. Devuelve JSON listo para cargar en el editor.
//
// Requiere el secreto ANTHROPIC_API_KEY en Supabase (Edge Functions › Secrets).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DAILY_LIMIT = 40;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'page_name',
    'announcement',
    'hero_headline',
    'hero_description',
    'product_description',
    'button_text',
    'button_subtext',
    'checkout_title',
    'benefits',
    'faq',
    'sections',
    'image_blocks',
    'video_position',
  ],
  properties: {
    page_name: { type: 'string', description: 'Nombre corto de la página (2 a 5 palabras).' },
    announcement: { type: 'string', description: 'Barra superior de anuncio, corta, con 1 emoji.' },
    hero_headline: { type: 'string', description: 'Título principal con gancho, 1 emoji al inicio.' },
    hero_description: { type: 'string', description: '1 o 2 oraciones debajo del título.' },
    product_description: { type: 'string', description: 'Descripción vendedora del producto, 3 a 5 oraciones.' },
    button_text: { type: 'string', description: 'Texto del botón de compra, en mayúsculas, corto, con emojis 👉 👈.' },
    button_subtext: { type: 'string', description: 'Línea chica debajo del botón (pago al recibir, envío).' },
    checkout_title: { type: 'string', description: 'Título del formulario de pedido.' },
    benefits: { type: 'array', items: { type: 'string' }, description: '4 a 6 beneficios cortos.' },
    faq: {
      type: 'array',
      description: '4 a 6 preguntas frecuentes.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'answer'],
        properties: { question: { type: 'string' }, answer: { type: 'string' } },
      },
    },
    image_blocks: {
      type: 'array',
      description:
        'Una entrada por cada foto numerada que te pasaron (sin repetir), en el orden en que conviene mostrarlas para vender. Vacío si no hay fotos.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['photo', 'caption'],
        properties: {
          photo: { type: 'integer', description: 'Número de la foto (Foto 1 = 1).' },
          caption: {
            type: 'string',
            description:
              'Texto que va debajo de la foto: un título en MAYÚSCULAS con 1 emoji y, si suma, una línea más (separada con una línea en blanco) que empiece con 👉. Tiene que corresponder a lo que se ve en esa foto.',
          },
        },
      },
    },
    video_position: {
      type: 'integer',
      description:
        'Si hay videos: después de cuántas fotos se muestra la fila de videos (0 = antes de todas). Si no hay videos, 0.',
    },
    sections: {
      type: 'array',
      description:
        'Secciones de venta solo con texto. Si hay 3 fotos o más, devolvé 0 o 1; si hay menos, 3 o 4 (problema, solución, cómo se usa, por qué elegirlo).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['emoji', 'heading', 'text'],
        properties: { emoji: { type: 'string' }, heading: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
} as const;

const SYSTEM = `Sos un copywriter experto en e-commerce de Paraguay con pago contra entrega.
Escribís páginas de venta de un solo producto que convierten: claras, directas, con emojis con moderación.
Usás español de Paraguay con voseo ("comprá", "pagás", "recibilo").
Reglas:
- No inventes características técnicas, medidas, materiales ni certificaciones que no estén en los datos o se vean en las fotos.
- No prometas curas, resultados médicos ni garantías que no estén en los datos.
- El cliente paga al recibir; los precios son en guaraníes (Gs).
- Textos cortos y fáciles de leer en el celular.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json({ error: 'La IA todavía no está activada: falta cargar la clave ANTHROPIC_API_KEY en Supabase.' }, 503);
  }

  // Sólo usuarios con sesión.
  const authHeader = req.headers.get('Authorization') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: auth } = await userClient.auth.getUser();
  const email = auth.user?.email?.toLowerCase();
  if (!email) return json({ error: 'Iniciá sesión para usar la IA' }, 401);

  // Límite diario por usuario.
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin
    .from('ai_generations')
    .select('id', { count: 'exact', head: true })
    .eq('user_email', email)
    .gte('created_at', since);
  if ((count || 0) >= DAILY_LIMIT) {
    return json({ error: `Llegaste al límite de ${DAILY_LIMIT} generaciones por día. Probá mañana.` }, 429);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Datos inválidos' }, 400);
  }
  const product = body?.product || {};
  const title = String(product.title || '').slice(0, 200);
  if (!title) return json({ error: 'Elegí un producto' }, 400);

  const facts = [
    `Producto: ${title}`,
    product.price ? `Precio de venta: Gs ${Number(product.price).toLocaleString('es-PY')}` : '',
    product.compareAtPrice ? `Precio "antes": Gs ${Number(product.compareAtPrice).toLocaleString('es-PY')}` : '',
    product.description ? `Descripción del proveedor: ${String(product.description).slice(0, 3000)}` : '',
    product.warranty ? `Garantía: ${String(product.warranty).slice(0, 500)}` : '',
    body?.extraProducts?.length ? `También se venden en la misma página: ${body.extraProducts.slice(0, 5).join(', ')}` : '',
    body?.audience ? `Público objetivo: ${String(body.audience).slice(0, 300)}` : '',
    body?.tone ? `Tono: ${String(body.tone).slice(0, 100)}` : '',
    body?.notes ? `Indicaciones del vendedor: ${String(body.notes).slice(0, 1000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const isUrl = (u: unknown) => typeof u === 'string' && /^https:\/\//.test(u);
  // Fotos para armar la página (subidas por el vendedor o las del producto).
  const images: string[] = (Array.isArray(body?.photos) && body.photos.length ? body.photos : product.images || [])
    .filter(isUrl)
    .slice(0, 6);
  const videoCount = Math.max(0, Math.min(3, Number(body?.videoCount || 0)));

  const client = new Anthropic({ apiKey });

  const run = async (withImages: boolean) => {
    const content: any[] = [];
    if (withImages) {
      images.forEach((url, i) => {
        content.push({ type: 'text', text: `Foto ${i + 1}:` });
        content.push({ type: 'image', source: { type: 'url', url } });
      });
    }
    content.push({
      type: 'text',
      text:
        `Armá la página de venta con estos datos.\n` +
        `Fotos para la página: ${images.length}${!withImages && images.length ? ' (no se pudieron ver; escribí textos generales del producto para cada una)' : ''}.\n` +
        `Videos para la página: ${videoCount}.\n\n${facts}`,
    });
    return await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    } as any);
  };

  let response: any;
  try {
    response = await run(images.length > 0);
  } catch (error) {
    // Una foto que no se puede descargar no debe frenar todo: se reintenta sin fotos.
    if (images.length > 0 && error instanceof Anthropic.BadRequestError) {
      try {
        response = await run(false);
      } catch (retryError) {
        console.error(retryError);
        return json({ error: 'La IA no pudo generar la página. Probá de nuevo.' }, 502);
      }
    } else if (error instanceof Anthropic.RateLimitError) {
      return json({ error: 'La IA está ocupada, probá en un minuto.' }, 429);
    } else if (error instanceof Anthropic.AuthenticationError) {
      return json({ error: 'La clave ANTHROPIC_API_KEY no es válida.' }, 503);
    } else {
      console.error(error);
      return json({ error: 'La IA no pudo generar la página. Probá de nuevo.' }, 502);
    }
  }

  if (response.stop_reason === 'refusal') {
    return json({ error: 'La IA no pudo escribir textos para este producto. Probá cambiando la descripción.' }, 422);
  }
  const text = (response.content || []).find((b: any) => b.type === 'text')?.text || '';
  let copy: unknown;
  try {
    copy = JSON.parse(text);
  } catch {
    return json({ error: 'La respuesta de la IA llegó incompleta. Probá de nuevo.' }, 502);
  }

  await admin.from('ai_generations').insert({ user_email: email, kind: 'landing_copy', product_title: title });
  return json({ copy });
});
