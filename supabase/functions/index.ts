import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import webpush from 'npm:web-push@3.6.7';
const env=(k:string)=>Deno.env.get(k) || '';
Deno.serve(async req=>{
  const secret=env('PUSH_DISPATCH_SECRET');
  if (!secret || req.headers.get('x-push-secret')!==secret) return new Response('Unauthorized',{status:401});
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY')) return new Response('Missing VAPID keys',{status:500});
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com',env('VAPID_PUBLIC_KEY'),env('VAPID_PRIVATE_KEY'));
  const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
  const {data:rows,error}=await db.from('push_queue').select('*').in('status',['pending','failed']).lte('next_attempt_at',new Date().toISOString()).lt('attempt_count',6).order('created_at').limit(30);
  if(error) return new Response(error.message,{status:500});
  let handled=0;
  for(const job of rows || []) {
    // Single worker only: use one cron invocation at a time; deduplication is per user/event.
    const {data:claimed}=await db.from('push_queue').update({status:'processing',attempt_count:job.attempt_count+1}).eq('id',job.id).in('status',['pending','failed']).select('id').maybeSingle();
    if(!claimed) continue;
    const {data:subs}=await db.from('push_subscriptions').select('*').eq('user_id',job.user_id).eq('enabled',true);
    let ok=0;let fail=0;
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({endpoint:s.endpoint,keys:{auth:s.auth,p256dh:s.p256dh}},JSON.stringify({title:job.title,body:job.body,url:job.url,tag:job.event_key}),{TTL:86400});
        ok++;
      } catch(e) {
        const status=(e as {statusCode?:number}).statusCode;
        if(status===404 || status===410) await db.from('push_subscriptions').delete().eq('id',s.id);
        else fail++;
      }
    }
    const retry=fail>0 && ok===0 && (job.attempt_count+1)<6;
    await db.from('push_queue').update({status:retry?'failed':'sent',processed_at:retry?null:new Date().toISOString(),next_attempt_at:new Date(Date.now()+Math.min(3600000,60000*2**job.attempt_count)).toISOString(),last_error:retry?`${fail} dispositivos fallaron`:null}).eq('id',job.id);
    handled++;
  }
  return Response.json({handled});
});
