// Auto-carga de "Pedidos Shopify" en el servidor: funciona aunque nadie tenga la
// app abierta. La llama la tarea programada skyline-shopify-autoload cada 5 min.
// Para cada usuario con la auto-carga activa lee su Google Sheet y carga los
// pedidos pendientes con ciudad con cobertura, producto seguro y monto.
// Mismas reglas que la pestaña (ShopifyInboxView).
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { compactKey, resolveCity, type CityPrice } from './fuzzyMatch.ts';

const env = (k: string) => Deno.env.get(k) || '';
const MAX_PER_USER = 60;

// ---------- Sheet ----------
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (quoted) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field.trim()); field = ''; }
    else if (c === '\n' || (c === '\r' && n !== '\n')) { row.push(field.trim()); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field.trim() || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

async function readSheet(url: string): Promise<{ headers: string[]; orders: Record<string, string>[] } | { error: string }> {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return { error: 'URL de Google Sheets inválida' };
  const gid = url.match(/gid=(\d+)/)?.[1] || '0';
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`);
  if (!res.ok) return { error: `No se pudo leer el Sheet [${res.status}]` };
  const text = await res.text();
  if (text.includes('<html') || text.includes('<!DOCTYPE')) return { error: 'La hoja no está pública' };
  const rows = parseCSV(text);
  if (rows.length < 2) return { headers: rows[0] || [], orders: [] };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const orders = rows.slice(1).map((r, idx) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => (o[h] = (r[i] || '').trim()));
    o.__row = String(idx + 2);
    return o;
  });
  return { headers, orders };
}

// ---------- Mismas reglas que la pestaña ----------
const normalizeText = (t: string) =>
  String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').replace(/\./g, '').replace(/-/g, '').trim();

function findColumns(h: string[]) {
  const find = (...cands: string[]) => {
    for (const header of h) {
      const nh = normalizeText(header);
      for (const c of cands) {
        const nc = normalizeText(c);
        if (nh === nc || nh.includes(nc)) return header;
      }
    }
    return '';
  };
  return {
    name: find('nombre', 'cliente', 'customer', 'name'),
    phone: find('telefono', 'phone', 'tel', 'celular', 'whatsapp'),
    street: find('calle', 'direccion', 'address', 'street'),
    city: find('ciudad', 'city', 'localidad', 'distrito'),
    product: find('producto', 'product', 'articulo'),
    qty: find('cantidad', 'qty', 'quantity', 'unidades'),
    amount: find('total', 'monto', 'precio', 'importe', 'venta'),
  };
}

function parseQuantity(v: unknown): number {
  const s = String(v || '').split('\n')[0].replace(/["']/g, '');
  const m = s.match(/\d+/);
  const n = m ? parseInt(m[0], 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseMoney(v: unknown): number {
  let s = String(v || '').split('\n')[0].replace(/["']/g, '').replace(/[^\d.,]/g, '');
  if (!s) return 0;
  s = s.replace(/\./g, '').replace(',', '.');
  return Math.round(Number(s) || 0);
}

function amountOf(order: Record<string, string>, amountCol: string): number {
  // En automático sólo se usa la columna del total (sin adivinar con otros números de la fila).
  if (amountCol) {
    const v = parseMoney(order[amountCol]);
    if (v > 0) return v;
  }
  const v = parseMoney(order['total a pagar']);
  return v > 0 ? v : 0;
}

function phoneOf(v: unknown): string {
  let p = String(v || '').replace(/[\s\-().+]/g, '').trim();
  if (p.startsWith('595')) p = '0' + p.slice(3);
  if (p.length === 9 && /^\d+$/.test(p)) p = '0' + p;
  return p;
}

Deno.serve(async (req) => {
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: config } = await db.rpc('push_dispatch_config');
  if (!config?.secret || req.headers.get('x-push-secret') !== config.secret) return new Response('Unauthorized', { status: 401 });

  // Modo prueba (sólo con la clave): {"dryRun": true, "email": "..."} informa qué cargaría, sin cargar.
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun === true && typeof body?.email === 'string';
  let settings: any[] | null;
  if (dryRun) {
    const email = String(body.email).toLowerCase();
    const { data } = await db.from('shopify_autoload_settings').select('*').eq('user_email', email);
    settings = data?.length ? data : [{ user_email: email, city_aliases: {}, product_aliases: {} }];
  } else {
    settings = (await db.from('shopify_autoload_settings').select('*').eq('enabled', true)).data;
  }
  if (!settings?.length) return Response.json({ users: 0 });

  // Datos comunes: tarifas por ciudad y catálogo.
  const { data: priceRows } = await db.from('client_prices').select('city, price_gs, departamento');
  const cities: CityPrice[] = (priceRows || [])
    .filter((r) => r.city && Number(r.price_gs) > 0)
    .map((r) => ({ city: String(r.city).trim(), price: Number(r.price_gs), departamento: String(r.departamento || '').trim() }));
  const products: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('products').select('*').range(from, from + 999);
    products.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [String(p.sku).trim().toLowerCase(), p]));

  const summary: Record<string, unknown> = {};
  for (const s of settings) {
    const email = String(s.user_email).toLowerCase();
    const result = { loaded: 0, skipped: 0, error: '' as string, orders: [] as string[], preview: [] as unknown[], skippedRows: [] as unknown[] };
    try {
      const { data: profile } = await db.from('profiles').select('user_id, email, sheet_url').ilike('email', email).maybeSingle();
      const sheetUrl = profile?.sheet_url || '';
      if (!sheetUrl) throw new Error('Sin URL de Google Sheet en el perfil');
      const sheet = await readSheet(sheetUrl);
      if ('error' in sheet) throw new Error(sheet.error);
      const col = findColumns(sheet.headers);

      // Estados ya guardados (cargados, cancelados, a dropear...).
      const done = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data } = await db.from('sheet_row_statuses').select('row_index').eq('user_email', profile!.email).eq('sheet_url', sheetUrl).range(from, from + 999);
        (data || []).forEach((r) => done.add(String(r.row_index)));
        if ((data || []).length < 1000) break;
      }

      const { data: maps } = await db.from('product_title_mappings').select('title_key, sku').eq('owner_email', email);
      const skuByTitle = new Map((maps || []).map((m) => [m.title_key, String(m.sku).trim().toLowerCase()]));
      const productAliases: Record<string, string> = s.product_aliases || {};
      const cityAliases = Object.fromEntries(Object.entries(s.city_aliases || {}).map(([k, v]) => [compactKey(k), String(v)]));

      const findProduct = (raw: string) => {
        if (!raw) return null;
        const mapped = skuByTitle.get(compactKey(raw));
        if (mapped && bySku.get(mapped)) return bySku.get(mapped);
        const names = [productAliases[normalizeText(raw)] || '', raw].filter(Boolean).map(normalizeText);
        for (const n of names) {
          const exact = products.find((p) => normalizeText(p.title || '') === n);
          if (exact) return exact;
        }
        for (const n of names) {
          const inc = products.find((p) => {
            const t = normalizeText(p.title || '');
            return t && (t.includes(n) || n.includes(t));
          });
          if (inc) return inc;
        }
        return null; // "parecidos" esperan confirmación en la app.
      };

      for (const order of sheet.orders) {
        if (result.loaded >= MAX_PER_USER) break;
        const row = order.__row;
        if (done.has(row)) continue;
        const city = resolveCity(order[col.city] || '', cities, cityAliases);
        const product = findProduct(order[col.product] || '');
        const sale = amountOf(order, col.amount);
        if (!city || !product || !sale) {
          result.skipped++;
          if (dryRun && result.skippedRows.length < 15) {
            result.skippedRows.push({ row, city: order[col.city], product: order[col.product], sale, why: !city ? 'ciudad' : !product ? 'producto' : 'monto' });
          }
          continue;
        }

        const qty = parseQuantity(order[col.qty]);
        const cost = Number(product.provider_price_gs || 0);
        const delivery = Number(city.price);
        const orderNumber = `SHOPIFY${Date.now()}${Math.floor(Math.random() * 10000)}`;
        if (dryRun) {
          result.loaded++;
          if (result.preview.length < 15) {
            result.preview.push({ row, rawCity: order[col.city], city: city.city.trim(), delivery, product: product.title, sku: product.sku, qty, sale, commission: sale - (cost * qty + delivery) });
          }
          continue;
        }

        // Primero se "reserva" la fila: si otro (la app u otra ejecución) ya la tomó, se salta.
        const { error: claimErr } = await db.from('sheet_row_statuses').insert({
          user_email: profile!.email, sheet_url: sheetUrl, row_index: Number(row), status: 'CARGADO', order_number: orderNumber,
          updated_at: new Date().toISOString(),
        });
        if (claimErr) { done.add(row); continue; }

        const { error: insErr } = await db.from('orders').insert({
          order_number: orderNumber,
          created_by: profile!.email,
          customer_name: order[col.name] || '',
          phone: phoneOf(order[col.phone]),
          city: city.city.trim(),
          departamento: city.departamento || '',
          street: order[col.street] || '',
          district: '', email: '', obs: '🤖 Cargado automático desde Shopify',
          items_json: [{ sku: product.sku || '', title: product.title, qty, sale_gs: sale, provider_price_gs: cost, provider_email: product.provider_email || '' }],
          total_gs: sale,
          delivery_gs: delivery,
          commission_gs: sale - (cost * qty + delivery),
          provider_emails_list: product.provider_email || '',
        });
        if (insErr) {
          await db.from('sheet_row_statuses').delete().eq('user_email', profile!.email).eq('sheet_url', sheetUrl).eq('row_index', Number(row)).eq('order_number', orderNumber);
          result.skipped++;
          console.error('insert order', email, insErr.message);
          continue;
        }
        result.loaded++;
        result.orders.push(orderNumber);
      }

      if (result.loaded && profile?.user_id && !dryRun) {
        await db.rpc('push_add', {
          uid: profile.user_id,
          event_id: `shopify-autoload:${result.orders[0]}`,
          notif_title: '🤖 Pedidos Shopify cargados',
          notif_body: `Se cargaron ${result.loaded} pedido(s) nuevo(s) automáticamente.`,
          notif_url: '/',
        });
      }
    } catch (e) {
      result.error = (e as Error).message;
    }
    if (dryRun) {
      summary[email] = { wouldLoad: result.loaded, skipped: result.skipped, error: result.error, preview: result.preview, skippedRows: result.skippedRows };
      continue;
    }
    await db.from('shopify_autoload_settings').update({ last_run_at: new Date().toISOString(), last_result: { loaded: result.loaded, skipped: result.skipped, error: result.error, orders: result.orders } }).eq('user_email', s.user_email);
    summary[email] = { loaded: result.loaded, skipped: result.skipped, error: result.error };
  }
  return Response.json({ users: settings.length, summary });
});
