// Admin: pone una contraseña nueva a un usuario que la olvidó (sin email).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  });
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) return json({ error: 'Iniciá sesión' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const [{ data: prof }, { data: role }] = await Promise.all([
    admin.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle(),
    admin.from('user_roles').select('role, approved').eq('user_id', auth.user.id).maybeSingle(),
  ]);
  const isAdmin =
    String(prof?.role || '').toLowerCase() === 'admin' ||
    (String(role?.role || '').toUpperCase() === 'ADMIN' && role?.approved);
  if (!isAdmin) return json({ error: 'Sólo el administrador puede cambiar contraseñas' }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Datos inválidos' }, 400);
  }
  const userId = String(body?.user_id || '');
  const password = String(body?.password || '');
  if (!userId) return json({ error: 'Falta el usuario' }, 400);
  if (password.length < 6) return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400);

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
});
