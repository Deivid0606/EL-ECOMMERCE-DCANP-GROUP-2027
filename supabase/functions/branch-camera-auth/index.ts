// MediaMTX external authentication for private Sucursal HLS playback.
// The browser sends a signed-in user's Supabase access token as a Bearer token.
// MediaMTX asks this endpoint to authorize EACH read request.
// No RTSP credentials, tunnel tokens, service-role keys, or camera identifiers
// with secrets are ever returned to the client.
import { createClient } from 'npm:@supabase/supabase-js@2.102.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny = (status = 403) => new Response('Forbidden', { status });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return deny(405);
  if (!SUPABASE_URL || !PUBLIC_KEY) return deny(503);
  let body: { action?: string; protocol?: string; path?: string; token?: string };
  try { body = await req.json(); } catch { return deny(400); }
  // Restrict both action and path so requests can't access any other cameras
  // or MediaMTX administrative endpoints.
  if (!['read', 'playback'].includes(body.action || '') ||
      body.protocol !== 'hls' || !uuid.test(body.path || '')) return deny();
  const token = (body.token || '').trim();
  if (!token || token.length > 10000) return deny(401);
  try {
    const supabase = createClient(SUPABASE_URL, PUBLIC_KEY, {
      global: { headers: { Authorization: 'Bearer ' + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // getUser validates the access token with the Auth server, not just its signature.
    const { data: userResult, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userResult.user) return deny(401);
    // Row Level Security permits reading only owner_user_id=auth.uid()
    // and only when the approved user's DB role is ADMIN or PROVEEDOR.
    const { data, error } = await supabase.from('branch_cameras')
      .select('id')
      .eq('stream_id', body.path)
      .eq('owner_user_id', userResult.user.id)
      .maybeSingle();
    if (error || !data) return deny();
    return new Response('', { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (_error) {
    return deny();
  }
});
