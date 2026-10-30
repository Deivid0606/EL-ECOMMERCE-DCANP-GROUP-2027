-- Notificaciones push con preferencias por usuario.
-- Reemplaza la versión de 20261024000000_web_push.sql (que nunca se aplicó).
-- Los disparadores nunca bloquean la operación original: ante cualquier error
-- se registra un WARNING y la fila se guarda igual.

-- ============================================
-- SUSCRIPCIONES (un registro por dispositivo)
-- ============================================
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
CREATE POLICY push_own_read ON public.push_subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS push_own_insert ON public.push_subscriptions;
CREATE POLICY push_own_insert ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS push_own_update ON public.push_subscriptions;
CREATE POLICY push_own_update ON public.push_subscriptions FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS push_own_delete ON public.push_subscriptions;
CREATE POLICY push_own_delete ON public.push_subscriptions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================
-- COLA DE ENVÍO (sólo la usa el servidor)
-- ============================================
CREATE TABLE IF NOT EXISTS public.push_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  url text NOT NULL DEFAULT '/',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (user_id, event_key)
);
CREATE INDEX IF NOT EXISTS push_queue_due_idx ON public.push_queue(status, next_attempt_at);
ALTER TABLE public.push_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_queue FROM anon, authenticated;

-- ============================================
-- PREFERENCIAS POR USUARIO
-- ============================================
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_dm boolean NOT NULL DEFAULT true,
  chat_channels boolean NOT NULL DEFAULT false,
  store_sales boolean NOT NULL DEFAULT true,
  order_statuses text[] NOT NULL DEFAULT ARRAY['ENTREGADO','ENCOMIENDA ENTREGADA','CANCELADO','RECHAZADO','RECHAZADO EN EL LUGAR','DEVUELTO A DEPÓSITO'],
  stock_low boolean NOT NULL DEFAULT true,
  stock_threshold integer NOT NULL DEFAULT 5 CHECK (stock_threshold BETWEEN 0 AND 100000),
  new_products boolean NOT NULL DEFAULT true,
  commissions boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_prefs_own_read ON public.notification_preferences;
CREATE POLICY notif_prefs_own_read ON public.notification_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS notif_prefs_own_insert ON public.notification_preferences;
CREATE POLICY notif_prefs_own_insert ON public.notification_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS notif_prefs_own_update ON public.notification_preferences;
CREATE POLICY notif_prefs_own_update ON public.notification_preferences FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Preferencias efectivas: la fila guardada o los valores por defecto.
CREATE OR REPLACE FUNCTION public.notif_prefs(uid uuid)
RETURNS public.notification_preferences LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.notification_preferences;
BEGIN
  SELECT * INTO r FROM public.notification_preferences WHERE user_id = uid;
  IF NOT FOUND THEN
    r.user_id := uid;
    r.chat_dm := true;
    r.chat_channels := false;
    r.store_sales := true;
    r.order_statuses := ARRAY['ENTREGADO','ENCOMIENDA ENTREGADA','CANCELADO','RECHAZADO','RECHAZADO EN EL LUGAR','DEVUELTO A DEPÓSITO'];
    r.stock_low := true;
    r.stock_threshold := 5;
    r.new_products := true;
    r.commissions := true;
  END IF;
  RETURN r;
END; $$;

-- Usuarios (con al menos un dispositivo activo) que corresponden a un email.
CREATE OR REPLACE FUNCTION public.push_users(target_email text)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT p.user_id FROM public.profiles p
  WHERE target_email IS NOT NULL AND lower(p.email) = lower(trim(target_email)) AND p.user_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = p.user_id AND s.enabled);
$$;

-- Usuarios con un rol (y dispositivo activo).
CREATE OR REPLACE FUNCTION public.push_role_users(role_name text)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ur.user_id FROM public.user_roles ur
  WHERE ur.role::text = role_name
    AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = ur.user_id AND s.enabled);
$$;

CREATE OR REPLACE FUNCTION public.push_add(uid uuid, event_id text, notif_title text, notif_body text, notif_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.push_queue(user_id, event_key, title, body, url)
  VALUES (uid, left(event_id, 250), left(notif_title, 130), left(notif_body, 300),
          CASE WHEN notif_url LIKE '/%' AND notif_url NOT LIKE '//%' THEN notif_url ELSE '/' END)
  ON CONFLICT (user_id, event_key) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.push_gs(amount numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'Gs. ' || replace(to_char(round(coalesce(amount, 0)), 'FM999,999,999,999'), ',', '.');
$$;

REVOKE ALL ON FUNCTION public.notif_prefs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_users(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_role_users(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_add(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ============================================
-- CHAT: mensajes directos y canales
-- ============================================
CREATE OR REPLACE FUNCTION public.push_chat_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb := to_jsonb(NEW); uid uuid; sender text; preview text;
BEGIN
  BEGIN
    preview := left(coalesce(nullif(trim(v->>'message_text'), ''), '📎 Archivo adjunto'), 120);
    IF TG_TABLE_NAME = 'chat_dm_messages' THEN
      sender := coalesce((SELECT name FROM public.profiles WHERE lower(email) = lower(v->>'from_email') LIMIT 1), v->>'from_email');
      FOR uid IN SELECT public.push_users(v->>'to_email') LOOP
        IF (public.notif_prefs(uid)).chat_dm THEN
          PERFORM public.push_add(uid, 'chat:' || (v->>'id'), '💬 ' || left(sender, 60), preview, '/?go=chat');
        END IF;
      END LOOP;
    ELSE
      sender := coalesce((SELECT name FROM public.profiles WHERE lower(email) = lower(v->>'sender_email') LIMIT 1), v->>'sender_email');
      IF v->>'thread_email' IS NOT NULL THEN
        FOR uid IN SELECT public.push_users(v->>'thread_email') LOOP
          IF lower(v->>'thread_email') <> lower(coalesce(v->>'sender_email', '')) AND (public.notif_prefs(uid)).chat_dm THEN
            PERFORM public.push_add(uid, 'chat:' || (v->>'id'), '💬 ' || left(sender, 60), preview, '/?go=chat');
          END IF;
        END LOOP;
      ELSE
        FOR uid IN
          SELECT s.user_id FROM public.push_subscriptions s
          JOIN public.profiles p ON p.user_id = s.user_id
          WHERE s.enabled AND lower(p.email) <> lower(coalesce(v->>'sender_email', ''))
          GROUP BY s.user_id
        LOOP
          IF (public.notif_prefs(uid)).chat_channels THEN
            PERFORM public.push_add(uid, 'channel:' || (v->>'id'), '💬 #' || coalesce(v->>'channel_key', 'canal') || ' · ' || left(sender, 50), preview, '/?go=chat');
          END IF;
        END LOOP;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_chat_trigger: %', SQLERRM;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS push_chat_dm ON public.chat_dm_messages;
CREATE TRIGGER push_chat_dm AFTER INSERT ON public.chat_dm_messages FOR EACH ROW EXECUTE FUNCTION public.push_chat_trigger();
DROP TRIGGER IF EXISTS push_chat_channels ON public.chat_messages;
CREATE TRIGGER push_chat_channels AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.push_chat_trigger();

-- ============================================
-- VENTAS DE MI TIENDA
-- ============================================
CREATE OR REPLACE FUNCTION public.push_store_order_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid;
BEGIN
  BEGIN
    FOR uid IN SELECT public.push_users(NEW.seller_email) LOOP
      IF (public.notif_prefs(uid)).store_sales THEN
        PERFORM public.push_add(uid, 'storeorder:' || NEW.id,
          '🛒 Nueva venta de ' || public.push_gs(NEW.total_gs),
          left(coalesce(NEW.page_name, 'Tu página') || ': ' || coalesce(NEW.product_title, 'Producto') || ' ×' || coalesce(NEW.quantity, 1) || ' · ' || coalesce(NEW.city, ''), 300),
          '/?go=store');
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_store_order_trigger: %', SQLERRM;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS push_store_order ON public.landing_page_orders;
CREATE TRIGGER push_store_order AFTER INSERT ON public.landing_page_orders FOR EACH ROW EXECUTE FUNCTION public.push_store_order_trigger();

-- ============================================
-- ESTADOS DE PEDIDOS (vendedor, proveedor y delivery)
-- ============================================
CREATE OR REPLACE FUNCTION public.push_order_status_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid; status_text text := upper(trim(coalesce(NEW.status, '')));
BEGIN
  BEGIN
    IF status_text <> '' AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      FOR uid IN
        SELECT DISTINCT u FROM (
          SELECT public.push_users(NEW.created_by) u
          UNION SELECT public.push_users(NEW.provider_email)
          UNION SELECT public.push_users(NEW.assigned_delivery)
        ) x WHERE u IS NOT NULL
      LOOP
        IF status_text = ANY ((public.notif_prefs(uid)).order_statuses) THEN
          PERFORM public.push_add(uid, 'order:' || NEW.id || ':' || status_text,
            '📦 ' || status_text || ' · Pedido ' || coalesce(NEW.order_number::text, ''),
            left(coalesce(NEW.customer_name, 'Cliente') || ' · ' || coalesce(NEW.city, '') || ' · ' || public.push_gs(NEW.total_gs), 300),
            '/?go=orders');
        END IF;
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_order_status_trigger: %', SQLERRM;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS push_orders ON public.orders;
CREATE TRIGGER push_orders AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.push_order_status_trigger();

-- ============================================
-- PRODUCTOS: stock bajo (proveedor y admin) y productos nuevos (vendedores)
-- ============================================
CREATE OR REPLACE FUNCTION public.push_product_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid; pr public.notification_preferences; new_stock integer := coalesce(NEW.stock, 0); old_stock integer;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' THEN old_stock := coalesce(OLD.stock, 0); END IF;

    IF TG_OP = 'UPDATE' AND new_stock IS DISTINCT FROM old_stock OR TG_OP = 'INSERT' THEN
      FOR uid IN
        SELECT DISTINCT u FROM (
          SELECT public.push_role_users('ADMIN') u
          UNION SELECT public.push_users(NEW.provider_email)
        ) x WHERE u IS NOT NULL
      LOOP
        pr := public.notif_prefs(uid);
        IF pr.stock_low AND new_stock <= pr.stock_threshold
           AND (TG_OP = 'INSERT' OR old_stock > pr.stock_threshold OR (new_stock = 0 AND old_stock > 0)) THEN
          PERFORM public.push_add(uid, 'stock:' || NEW.id || ':' || new_stock || ':' || extract(epoch FROM now())::bigint / 3600,
            CASE WHEN new_stock = 0 THEN '🚨 Sin stock' ELSE '⚠️ Stock bajo' END,
            left(coalesce(NEW.title, 'Producto') || ': quedan ' || new_stock || ' unidades', 300),
            '/?go=products');
        END IF;
      END LOOP;
    END IF;

    IF TG_OP = 'INSERT' AND NOT coalesce(NEW.is_private, false) THEN
      FOR uid IN SELECT DISTINCT ur.user_id FROM public.user_roles ur
                 WHERE ur.role::text = 'VENDEDOR' AND ur.approved
                   AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = ur.user_id AND s.enabled)
      LOOP
        IF (public.notif_prefs(uid)).new_products THEN
          PERFORM public.push_add(uid, 'new-product:' || NEW.id, '🛍️ Producto nuevo', left(coalesce(NEW.title, 'Nuevo producto'), 150), '/?go=products');
        END IF;
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_product_trigger: %', SQLERRM;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS push_products ON public.products;
CREATE TRIGGER push_products AFTER INSERT OR UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION public.push_product_trigger();

-- ============================================
-- COMISIONES
-- ============================================
CREATE OR REPLACE FUNCTION public.push_commission_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb := to_jsonb(NEW); oldv jsonb; uid uuid;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      FOR uid IN
        SELECT DISTINCT u FROM (
          SELECT public.push_role_users('ADMIN') u
          UNION SELECT public.push_users(v->>'provider_email')
        ) x WHERE u IS NOT NULL
      LOOP
        IF (public.notif_prefs(uid)).commissions THEN
          PERFORM public.push_add(uid, 'commission-request:' || (v->>'id'), '💰 Solicitud de comisión', 'Hay una solicitud de comisión pendiente.', '/');
        END IF;
      END LOOP;
    ELSE
      oldv := to_jsonb(OLD);
      IF v->>'status' IS DISTINCT FROM oldv->>'status' THEN
        FOR uid IN SELECT public.push_users(v->>'vendor_email') LOOP
          IF (public.notif_prefs(uid)).commissions THEN
            PERFORM public.push_add(uid, 'commission-status:' || (v->>'id') || ':' || coalesce(v->>'status', ''), '💰 Comisión ' || lower(coalesce(v->>'status', 'actualizada')), 'Tu solicitud de comisión cambió de estado.', '/');
          END IF;
        END LOOP;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_commission_trigger: %', SQLERRM;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS push_commissions ON public.commission_requests;
CREATE TRIGGER push_commissions AFTER INSERT OR UPDATE OF status ON public.commission_requests FOR EACH ROW EXECUTE FUNCTION public.push_commission_trigger();

-- Funciones de la versión anterior (no aplicada) que ya no se usan.
DROP FUNCTION IF EXISTS public.push_event_trigger() CASCADE;
DROP FUNCTION IF EXISTS public.push_enqueue(text, text, text, text, text);

-- La tarea programada que llama a la función push-dispatch se crea aparte,
-- porque necesita el secreto guardado en Vault (ver push_dispatch_cron).

-- ============================================
-- CONFIGURACIÓN DE ENVÍO (claves en Vault)
-- Secretos en vault.secrets: push_dispatch_secret, push_vapid_public, push_vapid_private.
-- La tarea pg_cron "skyline-push-dispatch" llama cada minuto a la función
-- push-dispatch con el encabezado x-push-secret tomado de Vault.
-- ============================================
CREATE OR REPLACE FUNCTION public.push_dispatch_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_dispatch_secret'),
    'public', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_vapid_public'),
    'private', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_vapid_private')
  );
$$;
REVOKE ALL ON FUNCTION public.push_dispatch_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_dispatch_config() TO service_role;

-- La clave pública VAPID no es secreta: la app la pide para suscribir el dispositivo.
CREATE OR REPLACE FUNCTION public.push_public_key()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_vapid_public';
$$;
REVOKE ALL ON FUNCTION public.push_public_key() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_public_key() TO authenticated;

-- Notificación de prueba para el propio usuario (botón "Enviar prueba" en Perfil).
CREATE OR REPLACE FUNCTION public.push_test()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  PERFORM public.push_add(auth.uid(), 'test:' || extract(epoch FROM clock_timestamp())::bigint,
    '🔔 Notificaciones activadas', 'Así vas a recibir los avisos que elegiste.', '/?go=profile');
END; $$;
REVOKE ALL ON FUNCTION public.push_test() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_test() TO authenticated;

-- Admin: estados de pedidos de todos los vendedores (opción "Pedidos de todos los vendedores").
-- (Aplicado en producción como migración push_admin_all_orders.)
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS all_orders boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.push_order_status_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid; pr public.notification_preferences; status_text text := upper(trim(coalesce(NEW.status, ''))); seller text;
BEGIN
  BEGIN
    IF status_text <> '' AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      -- Partes del pedido: vendedor, proveedor y delivery.
      FOR uid IN
        SELECT DISTINCT u FROM (
          SELECT public.push_users(NEW.created_by) u
          UNION SELECT public.push_users(NEW.provider_email)
          UNION SELECT public.push_users(NEW.assigned_delivery)
        ) x WHERE u IS NOT NULL
      LOOP
        IF status_text = ANY ((public.notif_prefs(uid)).order_statuses) THEN
          PERFORM public.push_add(uid, 'order:' || NEW.id || ':' || status_text,
            '📦 ' || status_text || ' · Pedido ' || coalesce(NEW.order_number::text, ''),
            left(coalesce(NEW.customer_name, 'Cliente') || ' · ' || coalesce(NEW.city, '') || ' · ' || public.push_gs(NEW.total_gs), 300),
            '/?go=orders');
        END IF;
      END LOOP;

      -- Admins que eligieron ver los pedidos de todos los vendedores.
      FOR uid IN SELECT public.push_role_users('ADMIN') LOOP
        pr := public.notif_prefs(uid);
        IF pr.all_orders AND status_text = ANY (pr.order_statuses) THEN
          IF seller IS NULL THEN
            seller := coalesce((SELECT name FROM public.profiles WHERE lower(email) = lower(NEW.created_by) LIMIT 1), NEW.created_by, 'Sin vendedor');
          END IF;
          PERFORM public.push_add(uid, 'order:' || NEW.id || ':' || status_text,
            '📦 ' || status_text || ' · Pedido ' || coalesce(NEW.order_number::text, ''),
            left(coalesce(NEW.customer_name, 'Cliente') || ' · ' || coalesce(NEW.city, '') || ' · ' || public.push_gs(NEW.total_gs) || ' · Vendedor: ' || seller, 300),
            '/?go=orders');
        END IF;
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_order_status_trigger: %', SQLERRM;
  END;
  RETURN NEW;
END; $$;
