-- REEMPLAZADA por 20261030000000_notification_preferences.sql (esta versión nunca se aplicó).
-- Push: ejecutar DESPUÉS de hacer respaldo. Seguridad por auth.uid().
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions(user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_own_read ON public.push_subscriptions;
CREATE POLICY push_own_read ON public.push_subscriptions FOR SELECT TO authenticated USING (user_id=auth.uid());
DROP POLICY IF EXISTS push_own_insert ON public.push_subscriptions;
CREATE POLICY push_own_insert ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid());
DROP POLICY IF EXISTS push_own_update ON public.push_subscriptions;
CREATE POLICY push_own_update ON public.push_subscriptions FOR UPDATE TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
DROP POLICY IF EXISTS push_own_delete ON public.push_subscriptions;
CREATE POLICY push_own_delete ON public.push_subscriptions FOR DELETE TO authenticated USING (user_id=auth.uid());
-- Restrict changing endpoint ownership through upsert: clients delete local registration when changing users.
CREATE TABLE IF NOT EXISTS public.push_queue (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 event_key text NOT NULL,
 title text NOT NULL,
 body text NOT NULL,
 url text NOT NULL DEFAULT '/#/',
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
 attempt_count integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz,
 UNIQUE(user_id,event_key)
);
CREATE INDEX IF NOT EXISTS push_queue_due_idx ON public.push_queue(status,next_attempt_at);
ALTER TABLE public.push_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_queue FROM anon, authenticated;
-- Secure queue: triggers run using definer privilege, clients cannot create messages for others.
CREATE OR REPLACE FUNCTION public.push_enqueue(target_email text, event_id text, notif_title text, notif_body text, notif_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.push_queue(user_id,event_key,title,body,url)
 SELECT p.user_id, left(event_id,250), left(notif_title,130), left(notif_body,300),
 CASE WHEN notif_url LIKE '/#/%' THEN notif_url ELSE '/#/' END
 FROM public.profiles p WHERE lower(p.email)=lower(target_email)
 ON CONFLICT (user_id,event_key) DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION public.push_enqueue(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.push_event_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v jsonb; oldv jsonb; recipient text; r record; role_name text;
BEGIN
 v:=to_jsonb(NEW);
 IF TG_OP='UPDATE' THEN oldv:=to_jsonb(OLD); END IF;
 IF TG_TABLE_NAME='chat_dm_messages' AND TG_OP='INSERT' THEN
   PERFORM public.push_enqueue(v->>'to_email','chat:'||(v->>'id'),'💬 Nuevo mensaje','Tenés un mensaje nuevo.','/#/');
 ELSIF TG_TABLE_NAME='chat_messages' AND TG_OP='INSERT' THEN
   -- Channel messages: notify the owner of the thread, not the sender.
   recipient:=v->>'thread_email';
   IF recipient IS DISTINCT FROM (v->>'sender_email') THEN
     PERFORM public.push_enqueue(recipient,'channel:'||(v->>'id'),'💬 Nuevo mensaje','Tenés un mensaje en el chat.','/#/');
   END IF;
 ELSIF TG_TABLE_NAME='orders' THEN
   IF TG_OP='INSERT' OR v->>'status' IS DISTINCT FROM oldv->>'status' THEN
     PERFORM public.push_enqueue(v->>'created_by','order:'||(v->>'id')||':'||(v->>'status'),'📦 Estado de pedido','Pedido '||coalesce(v->>'order_number','')||': '||coalesce(v->>'status','nuevo'),'/#/');
     -- Fallback path normalized in helper.
     recipient:=v->>'assigned_delivery';
     IF recipient IS NOT NULL THEN
       PERFORM public.push_enqueue(recipient,'deliveryorder:'||(v->>'id')||':'||(v->>'status'),'🚚 Actualización de pedido','Pedido '||coalesce(v->>'order_number','')||': '||coalesce(v->>'status','nuevo'),'/#/');
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='commission_requests' THEN
   IF TG_OP='INSERT' THEN
     FOR r IN SELECT DISTINCT p.email FROM public.profiles p JOIN public.user_roles ur ON ur.user_id=p.user_id WHERE ur.role='ADMIN' OR (ur.role='PROVEEDOR' AND lower(p.email)=lower(coalesce(v->>'provider_email',''))) LOOP
       PERFORM public.push_enqueue(r.email,'commission-request:'||(v->>'id'),'💰 Solicitud de comisión','Hay una solicitud de comisión pendiente.','/#/');
     END LOOP;
   ELSIF v->>'status' IS DISTINCT FROM oldv->>'status' THEN
     PERFORM public.push_enqueue(v->>'vendor_email','commission-status:'||(v->>'id')||':'||(v->>'status'),'💰 Actualización de comisión','Tu comisión cambió a '||coalesce(v->>'status','actualizada'),'/#/');
   END IF;
 ELSIF TG_TABLE_NAME='products' THEN
   IF TG_OP='INSERT' AND coalesce((v->>'is_private')::boolean,false)=false THEN
     FOR r IN SELECT DISTINCT p.email FROM public.profiles p JOIN public.user_roles ur ON ur.user_id=p.user_id WHERE ur.role='VENDEDOR' AND ur.approved=true LOOP
       PERFORM public.push_enqueue(r.email,'new-product:'||(v->>'id'),'🛍️ Producto nuevo',left(coalesce(v->>'title','Nuevo producto público'),150),'/#/');
     END LOOP;
   END IF;
   IF coalesce((v->>'stock')::integer,0)<=5 AND (TG_OP='INSERT' OR coalesce((oldv->>'stock')::integer,0)>5 OR (coalesce((v->>'stock')::integer,0)=0 AND coalesce((oldv->>'stock')::integer,0)>0)) THEN
     FOR r IN SELECT DISTINCT p.email FROM public.profiles p JOIN public.user_roles ur ON ur.user_id=p.user_id WHERE ur.role='ADMIN' OR (ur.role='PROVEEDOR' AND lower(p.email)=lower(coalesce(v->>'provider_email',''))) LOOP
       PERFORM public.push_enqueue(r.email,'stock:'||(v->>'id')||':'||(v->>'stock'),'⚠️ Alerta de stock',left(coalesce(v->>'title','Producto')||': '||coalesce(v->>'stock','0')||' unidades.',200),'/#/');
     END LOOP;
   END IF;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS push_chat_dm ON public.chat_dm_messages;
CREATE TRIGGER push_chat_dm AFTER INSERT ON public.chat_dm_messages FOR EACH ROW EXECUTE FUNCTION public.push_event_trigger();
DROP TRIGGER IF EXISTS push_chat_channels ON public.chat_messages;
CREATE TRIGGER push_chat_channels AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.push_event_trigger();
DROP TRIGGER IF EXISTS push_orders ON public.orders;
CREATE TRIGGER push_orders AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.push_event_trigger();
DROP TRIGGER IF EXISTS push_commissions ON public.commission_requests;
CREATE TRIGGER push_commissions AFTER INSERT OR UPDATE OF status ON public.commission_requests FOR EACH ROW EXECUTE FUNCTION public.push_event_trigger();
DROP TRIGGER IF EXISTS push_products ON public.products;
CREATE TRIGGER push_products AFTER INSERT OR UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION public.push_event_trigger();
-- Tiendas públicas: instalación condicionada a existencia de la tabla.
CREATE OR REPLACE FUNCTION public.push_store_order_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v jsonb; recipient text; r record;
BEGIN
 v:=to_jsonb(NEW);
 recipient:=coalesce(v->>'seller_email',v->>'vendor_email',v->>'owner_email');
 IF recipient IS NOT NULL THEN
   PERFORM public.push_enqueue(recipient,'storeorder:'||(v->>'id'),'🛒 Nueva venta en Mi Tienda','Recibiste un pedido nuevo.','/#/');
 END IF;
 RETURN NEW;
END; $$;
DO $$ BEGIN
 IF to_regclass('public.landing_page_orders') IS NOT NULL THEN
 EXECUTE 'DROP TRIGGER IF EXISTS push_store_order ON public.landing_page_orders';
 EXECUTE 'CREATE TRIGGER push_store_order AFTER INSERT ON public.landing_page_orders FOR EACH ROW EXECUTE FUNCTION public.push_store_order_trigger()';
 END IF;
END $$;
-- El procesador de Supabase Edge Functions usa service_role y debe ejecutarse por un cron seguro.
