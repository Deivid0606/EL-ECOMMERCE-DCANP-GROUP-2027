// Genera con Claude los textos de una página de venta (Mi Tienda › Páginas)
// a partir del producto seleccionado: título, descripción, precio, garantía y
// fotos. Devuelve JSON listo para cargar en el editor.
//
// Motor: Claude (ANTHROPIC_API_KEY) u OpenAI (OPENAI_API_KEY, modelo en
// OPENAI_TEXT_MODEL, por defecto gpt-4.1). Se elige desde el editor.
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
    'analysis',
    'hero',
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
    'generated_images',
    'banners',
    'video_position',
  ],
  properties: {
    analysis: {
      type: 'object',
      additionalProperties: false,
      description: 'Análisis del producto ANTES de escribir (paso 1 del método).',
      required: ['product', 'problem', 'pains', 'audience', 'objections', 'angle', 'promise', 'missing_data'],
      properties: {
        product: { type: 'string', description: 'Qué es y cómo se usa.' },
        problem: { type: 'string', description: 'Problema principal que resuelve.' },
        pains: { type: 'array', items: { type: 'string' }, description: 'Dolores y frustraciones del cliente.' },
        audience: { type: 'string', description: 'Público objetivo en Paraguay.' },
        objections: { type: 'array', items: { type: 'string' }, description: 'Objeciones antes de comprar.' },
        angle: { type: 'string', description: 'Ángulo de venta para Meta Ads y concepto publicitario.' },
        promise: { type: 'string', description: 'Promesa central sin exageraciones.' },
        missing_data: { type: 'array', items: { type: 'string' }, description: 'Datos importantes que faltan y NO se usaron.' },
      },
    },
    hero: {
      type: 'object',
      additionalProperties: false,
      description:
        'Imagen principal HERO (va como foto principal del producto, fuera del cuerpo). Si "Imágenes a crear" es 0, dejá prompt vacío.',
      required: ['prompt', 'hook'],
      properties: {
        prompt: {
          type: 'string',
          description:
            'Escena EN INGLÉS para el generador: producto protagonista, fondo publicitario relacionado al uso, iluminación profesional, contraste, look premium que frene el scroll. Indicá que el texto del gancho va escrito en la imagen exactamente como en "hook", grande y legible.',
        },
        hook: { type: 'string', description: 'Gancho corto en español para escribir en la HERO (máx. 6 palabras, sin precio).' },
      },
    },
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
      description: 'Exactamente 3 preguntas frecuentes que respondan las objeciones principales.',
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
    generated_images: {
      type: 'array',
      description:
        'Si te piden imágenes nuevas (ver "Imágenes a crear"), exactamente esa cantidad; si no, vacío. En este orden y con estas funciones: ' +
        '1) PROBLEMA Y DOLOR: situación cotidiana frustrante y reconocible en Paraguay que el producto resuelve ("esto me pasa a mí"); ' +
        '2) SOLUCIÓN Y BENEFICIOS: el producto en uso real resolviendo el problema ("es justo lo que necesito"); ' +
        '3) FUNCIONES Y DETALLES: acercamientos reales a sus partes y funciones (sólo las que existen) ("ahora entiendo por qué vale la pena"); ' +
        '4) DESEO Y CONVERSIÓN: el producto en su situación ideal, satisfacción y tranquilidad ("lo quiero tener"). Coherencia visual entre todas, sin repetir escenas.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt', 'caption'],
        properties: {
          prompt: {
            type: 'string',
            description:
              'Descripción de la escena EN INGLÉS para un generador de imágenes: lugar, personas, acción, luz y encuadre. Sin texto ni letras en la imagen.',
          },
          caption: {
            type: 'string',
            description:
              'Texto que va debajo de esa imagen en la página: título en MAYÚSCULAS con 1 emoji y, si suma, una línea más (separada con una línea en blanco) que empiece con 👉.',
          },
        },
      },
    },
    banners: {
      type: 'array',
      description:
        'Si te piden banners (ver "Banners a diseñar"), exactamente esa cantidad; si no, vacío. Son las imágenes cuadradas del cuerpo de la página, diseñadas en HTML, con las mismas 4 funciones en orden: ' +
        '1) problema y dolor, 2) solución y beneficios, 3) funciones y detalles, 4) deseo, confianza y llamada a la acción (pago contra entrega). ' +
        'Textos breves e impactantes, sin saturar, sin repetir el mismo mensaje entre banners y SIN PRECIOS.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['html', 'caption'],
        properties: {
          html: {
            type: 'string',
            description:
              'Un solo <div> raíz con estilos INLINE (style="..."), sin <script>, sin <style>, sin eventos, sin fuentes ni recursos externos salvo las fotos del producto que te pasaron (por URL exacta). ' +
              'Formato cuadrado (width:100%; aspect-ratio:1/1; max-width:100%; overflow:hidden; box-sizing:border-box; position:relative), fondo con degradé llamativo, la foto del producto grande y nítida (<img src="URL" style="object-fit:contain">), ' +
              'un título grande en MAYÚSCULAS, 2 o 3 insignias o íconos con emojis y textos cortos. Fuente: font-family:system-ui,Arial,sans-serif. Tamaños en % o clamp() para que se vea bien en celular y PC.',
          },
          caption: {
            type: 'string',
            description: 'Texto opcional debajo del banner (puede ir vacío si el banner ya lo dice todo).',
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

const SYSTEM = `Sos experto en marketing digital, investigación de productos, copywriting persuasivo, psicología del consumidor, diseño publicitario y landing pages de alta conversión para e-commerce en Paraguay con pago contra entrega.
Método: primero analizás el producto (qué es, problema, dolores, público, objeciones, ángulo para Meta Ads, promesa) y después escribís todo siguiendo el recorrido ATENCIÓN → IDENTIFICACIÓN CON EL PROBLEMA → SOLUCIÓN → BENEFICIOS → CONFIANZA → DESEO → ACCIÓN.
Usás español natural de Paraguay con voseo ("comprá", "pagás", "recibilo"), lenguaje sencillo y beneficios concretos.
Reglas obligatorias:
- No inventes características, materiales, funciones, accesorios, certificaciones ni resultados que no estén en los datos o se vean en las fotos. Si faltan datos, anotalos en analysis.missing_data y no los uses.
- Fidelidad absoluta al producto real: mismos colores, formas, piezas y diseño.
- NUNCA pongas precios dentro de las imágenes ni de los banners.
- No inventes testimonios, garantías, descuentos, envío gratis, tiempos de entrega ni stock limitado: sólo mencioná lo que esté en los datos o en las indicaciones del vendedor. Pago contra entrega y entrega a domicilio sí se pueden mencionar.
- No prometas resultados imposibles ni uses afirmaciones engañosas.
- Cada imagen y cada texto cumplen una función distinta; no repitas el mismo mensaje.
- Textos cortos y fáciles de leer en el celular; emojis con moderación.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
  const openaiKey = Deno.env.get('OPENAI_API_KEY') || '';
  if (!apiKey && !openaiKey) {
    return json({ error: 'La IA todavía no está activada: falta cargar la clave ANTHROPIC_API_KEY u OPENAI_API_KEY en Supabase.' }, 503);
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
    .eq('kind', 'landing_copy')
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
  // Motor elegido en el editor (si falta su clave, se usa el otro).
  let provider: 'claude' | 'openai' = body?.provider === 'openai' ? 'openai' : 'claude';
  if (provider === 'openai' && !openaiKey) {
    return json({ error: 'Para usar OpenAI falta cargar la clave OPENAI_API_KEY en Supabase.' }, 503);
  }
  if (provider === 'claude' && !apiKey) provider = 'openai';
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
  const usingUploads = Array.isArray(body?.photos) && body.photos.length > 0;
  const videoCount = Math.max(0, Math.min(3, Number(body?.videoCount || 0)));
  const imagesToCreate = Math.max(0, Math.min(4, Number(body?.generateImages || 0)));
  const bannersToDesign = Math.max(0, Math.min(4, Number(body?.designBanners || 0)));
  const productPhotos: string[] = (product.images || []).filter(isUrl).slice(0, 3);
  const proMode = imagesToCreate > 0 && bannersToDesign > 0;
  const brandColor = /^#[0-9a-f]{6}$/i.test(String(body?.brandColor || '')) ? String(body.brandColor) : '';

  const buildText = (withImages: boolean) =>
        `Armá la página de venta con estos datos.\n` +
        (usingUploads
          ? `Fotos para la página: ${images.length}${!withImages ? ' (no se pudieron ver; escribí textos generales del producto para cada una)' : ''}.\n`
          : `Fotos para la página: 0 (las fotos de arriba son sólo de referencia del producto; image_blocks vacío).\n`) +
        `Videos para la página: ${videoCount}.\n` +
        `Imágenes a crear: ${imagesToCreate}${imagesToCreate ? ' (además de la HERO, que va aparte)' : ''}.\n` +
        `Banners a diseñar: ${bannersToDesign}.\n` +
        (bannersToDesign
          ? (proMode
              ? `MODO PRO (sin precios en ningún banner): cada banner N usa como FONDO a pantalla completa la foto profesional N que se va a generar con la escena de generated_images[N]. ` +
                `Usá exactamente src="{{FOTO_IA_N}}" (ej. {{FOTO_IA_1}}) en un <img> con position:absolute; inset:0; width:100%; height:100%; object-fit:cover. ` +
                `Encima poné una capa de degradé oscuro para que se lea el texto, el título grande y las insignias, como un anuncio profesional de Instagram. ` +
                `En las escenas de generated_images dejá espacio libre (arriba o abajo) para el texto.\n`
              : `URLs de las fotos del producto para usar en los banners:\n${productPhotos.map((u, i) => `${i + 1}. ${u}`).join('\n') || '(no hay; diseñá sin foto, con ilustraciones SVG, íconos y emojis grandes)'}\n` +
                `DISEÑO PRO (como anuncios de Instagram/TikTok de marcas grandes), cada banner distinto:\n` +
                `- Si la foto tiene fondo blanco o claro, poné el producto sobre un fondo CLARO y usá mix-blend-mode:multiply en el <img> para que el fondo blanco desaparezca y el producto quede "flotando"; agregá una sombra suave debajo (un div ovalado con filter:blur).\n` +
                `- Banner 1 (problema y dolor): gancho que conecte con la frustración del cliente, producto presentado como la solución.\n` +
                `- Banner 2 (solución y beneficios): producto grande protagonista con halo de luz o rayos (SVG) y 3 beneficios con íconos.\n` +
                `- Banner 3 (funciones y detalles): acercamiento a un detalle (misma foto con transform:scale(1.6–2.2) y object-position hacia la parte importante, dentro de un círculo o recuadro con borde) + funciones reales.\n` +
                `- Banner 4 (deseo y acción): beneficio final, "Pagás al recibir" y una llamada a la acción corta ("PEDILO AHORA" con flecha). Sin precio.\n` +
                `- Podés dibujar ilustraciones vectoriales con <svg> inline (formas, ondas, chispas, rayos, íconos simples); nada de texto dentro del SVG.\n` +
                `- Paleta de 2–3 colores que combinen con el producto y la marca, contraste alto, títulos con font-weight:900 y letter-spacing, bordes redondeados, sombras (box-shadow) y degradés.\n` +
                `- Todo debe verse perfecto en un celular de 360px de ancho (usá %, clamp() y aspect-ratio:1/1).\n`) +
            (brandColor ? `Color de la marca: ${brandColor}.\n` : '')
          : '') +
        `\n${facts}`;

  // ---------- OpenAI ----------
  if (provider === 'openai') {
    const callOpenAI = async (withImages: boolean) => {
      const content: any[] = [];
      if (withImages) {
        images.forEach((url, i) => {
          content.push({ type: 'text', text: `Foto ${i + 1}:` });
          content.push({ type: 'image_url', image_url: { url } });
        });
      }
      content.push({ type: 'text', text: buildText(withImages) });
      return await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: Deno.env.get('OPENAI_TEXT_MODEL') || 'gpt-4.1',
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'landing_page', strict: true, schema: SCHEMA } },
          max_completion_tokens: 32000,
        }),
      });
    };
    let res = await callOpenAI(images.length > 0);
    if (!res.ok && res.status === 400 && images.length > 0) res = await callOpenAI(false);
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('openai text error', res.status, JSON.stringify(out).slice(0, 500));
      if (res.status === 401) return json({ error: 'La clave OPENAI_API_KEY no es válida.' }, 503);
      if (res.status === 429) return json({ error: 'OpenAI está ocupado o sin saldo. Probá en un minuto.' }, 429);
      return json({ error: 'La IA no pudo generar la página. Probá de nuevo.' }, 502);
    }
    const msg = out?.choices?.[0]?.message;
    if (msg?.refusal) {
      return json({ error: 'La IA no pudo escribir textos para este producto. Probá cambiando la descripción.' }, 422);
    }
    let copyOpenAI: unknown;
    try {
      copyOpenAI = JSON.parse(String(msg?.content || ''));
    } catch {
      return json({ error: 'La respuesta de la IA llegó incompleta. Probá de nuevo.' }, 502);
    }
    await admin.from('ai_generations').insert({ user_email: email, kind: 'landing_copy', product_title: title });
    return json({ copy: copyOpenAI, provider: 'openai' });
  }

  // ---------- Claude ----------
  const client = new Anthropic({ apiKey });

  const run = async (withImages: boolean) => {
    const content: any[] = [];
    if (withImages) {
      images.forEach((url, i) => {
        content.push({ type: 'text', text: `Foto ${i + 1}:` });
        content.push({ type: 'image', source: { type: 'url', url } });
      });
    }
    content.push({ type: 'text', text: buildText(withImages) });
    // Respuesta larga (análisis + 4 banners): streaming para no cortar por tiempo.
    return await client.beta.messages
      .stream({
      model: 'claude-opus-5-5',
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    } as any)
      .finalMessage();
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
  return json({ copy, provider: 'claude' });
});
