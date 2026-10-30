// Envía las notificaciones pendientes de push_queue.
// La llama la tarea programada skyline-push-dispatch (pg_cron) cada minuto.
// Secreto y claves VAPID se leen de Vault mediante push_dispatch_config().
import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import webpush from 'npm:web-push@3.6.7';

const env = (k: string) => Deno.env.get(k) || '';

type Job = {id: number; user_id: string; event_key: string; title: string; body: string; url: string; attempt_count: number};

Deno.serve(async req => {
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  const {data: config, error: configError} = await db.rpc('push_dispatch_config');
  if (configError || !config?.secret) return new Response('Missing push configuration', {status: 500});
  if (req.headers.get('x-push-secret') !== config.secret) return new Response('Unauthorized', {status: 401});
  if (!config.public || !config.private) return new Response('Missing VAPID keys', {status: 500});

  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:soporte@el-ecommercedcanpgroup.com', config.public, config.private);

  // Recuperar trabajos que quedaron "processing" por una ejecución interrumpida.
  await db.from('push_queue').update({status: 'failed'}).eq('status', 'processing')
    .lt('next_attempt_at', new Date(Date.now() - 5 * 60_000).toISOString());

  const {data: rows, error} = await db.from('push_queue').select('*')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', new Date().toISOString())
    .lt('attempt_count', 6)
    .order('created_at')
    .limit(100);
  if (error) return new Response(error.message, {status: 500});

  let sent = 0;
  for (const job of (rows || []) as Job[]) {
    const {data: claimed} = await db.from('push_queue')
      .update({status: 'processing', attempt_count: job.attempt_count + 1, next_attempt_at: new Date().toISOString()})
      .eq('id', job.id).in('status', ['pending', 'failed']).select('id').maybeSingle();
    if (!claimed) continue;

    const {data: subs} = await db.from('push_subscriptions').select('*').eq('user_id', job.user_id).eq('enabled', true);
    let ok = 0;
    let fail = 0;
    let lastError = '';
    for (const s of subs || []) {
      try {
        await webpush.sendNotification(
          {endpoint: s.endpoint, keys: {auth: s.auth, p256dh: s.p256dh}},
          JSON.stringify({title: job.title, body: job.body, url: job.url, tag: job.event_key}),
          {TTL: 86400},
        );
        ok++;
      } catch (e) {
        const status = (e as {statusCode?: number}).statusCode;
        // El dispositivo canceló la suscripción: se elimina.
        if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
        else {
          fail++;
          lastError = `${status || ''} ${(e as Error).message || ''}`.trim();
        }
      }
    }

    const retry = fail > 0 && ok === 0 && job.attempt_count + 1 < 6;
    await db.from('push_queue').update({
      status: retry ? 'failed' : 'sent',
      processed_at: retry ? null : new Date().toISOString(),
      next_attempt_at: new Date(Date.now() + Math.min(3_600_000, 60_000 * 2 ** job.attempt_count)).toISOString(),
      last_error: fail ? lastError.slice(0, 300) : null,
    }).eq('id', job.id);
    if (ok) sent++;
  }

  // Limpieza: los avisos enviados se conservan una semana.
  await db.from('push_queue').delete().eq('status', 'sent').lt('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString());

  return Response.json({handled: rows?.length || 0, sent});
});
