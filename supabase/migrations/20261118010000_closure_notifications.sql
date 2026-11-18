-- 🔔 Cierres: recordatorio diario a las 20:00 (Paraguay) al delivery con el cierre pendiente,
-- y aviso a admin y proveedor cuando un delivery envía su cierre. Activado por defecto.

ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS closures boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.notif_prefs(uid uuid)
 RETURNS notification_preferences LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
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
    r.all_orders := false;
    r.closures := true;
  END IF;
  RETURN r;
END; $function$;

-- Aviso a admin y al proveedor destino cuando un delivery envía su comprobante de cierre.
CREATE OR REPLACE FUNCTION public.push_closure_submission_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE uid uuid; who text; dest text; is_admin_user boolean;
BEGIN
  BEGIN
    SELECT coalesce(nullif(trim(name), ''), NEW.delivery_email) INTO who FROM public.profiles WHERE lower(email) = lower(NEW.delivery_email) LIMIT 1;
    who := coalesce(who, NEW.delivery_email);
    SELECT coalesce(nullif(trim(name), ''), NEW.destination_email) INTO dest FROM public.profiles WHERE lower(email) = lower(NEW.destination_email) LIMIT 1;
    dest := coalesce(dest, NEW.destination_email, 'proveedor');
    FOR uid IN
      SELECT DISTINCT u FROM (
        SELECT public.push_role_users('ADMIN') u
        UNION SELECT public.push_users(NEW.destination_email)
      ) x WHERE u IS NOT NULL
    LOOP
      IF (public.notif_prefs(uid)).closures THEN
        is_admin_user := EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text = 'ADMIN');
        PERFORM public.push_add(
          uid,
          'closure-sent:' || NEW.id,
          '🧾 ' || who || ' hizo su cierre',
          'Envió su comprobante de ' || public.push_gs(NEW.amount_gs)
            || CASE WHEN is_admin_user THEN ' para ' || dest ELSE '' END
            || '. Revisalo en Cierres › Pagos de cierre.',
          '/'
        );
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_closure_submission_trigger: %', SQLERRM;
  END;
  RETURN NEW;
END; $function$;
DROP TRIGGER IF EXISTS push_closure_submission ON public.delivery_closure_submissions;
CREATE TRIGGER push_closure_submission AFTER INSERT ON public.delivery_closure_submissions
FOR EACH ROW EXECUTE FUNCTION public.push_closure_submission_trigger();

-- ⏰ 20:00: a cada delivery con el día sin finalizar o con entregados sin rendir.
CREATE OR REPLACE FUNCTION public.closure_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE d record; today date := public.py_day(now()); n integer := 0; body text;
BEGIN
  FOR d IN
    SELECT u.user_id, lower(p.email) email,
      (SELECT count(*) FROM public.orders o
        WHERE lower(o.assigned_delivery) = lower(p.email) AND public.py_day(o.assigned_at) = today) AS today_orders,
      EXISTS (SELECT 1 FROM public.delivery_day_closures c WHERE lower(c.delivery_email) = lower(p.email) AND c.day = today) AS finalized,
      (SELECT count(*) FROM public.orders o
        WHERE lower(o.assigned_delivery) = lower(p.email)
          AND o.status IN ('ENTREGADO', 'ENCOMIENDA ENTREGADA')
          AND coalesce(o.delivery_settled, false) = false
          AND NOT EXISTS (SELECT 1 FROM public.delivery_closure_orders x WHERE x.order_id = o.id)) AS to_render
    FROM public.push_role_users('DELIVERY') u(user_id)
    JOIN public.profiles p ON p.user_id = u.user_id
  LOOP
    CONTINUE WHEN NOT (public.notif_prefs(d.user_id)).closures;
    CONTINUE WHEN NOT ((d.today_orders > 0 AND NOT d.finalized) OR d.to_render > 0);
    body := concat_ws(' ',
      CASE WHEN d.today_orders > 0 AND NOT d.finalized THEN 'Finalizá tu día (' || d.today_orders || ' pedido(s) de hoy).' END,
      CASE WHEN d.to_render > 0 THEN 'Tenés ' || d.to_render || ' pedido(s) entregado(s) para rendir: subí tu comprobante.' END);
    PERFORM public.push_add(d.user_id, 'closure-reminder:' || today, '⏰ Ya son las 20:00: tu cierre está pendiente', body, '/');
    n := n + 1;
  END LOOP;
  RETURN n;
END; $function$;
REVOKE ALL ON FUNCTION public.closure_reminders() FROM public, anon, authenticated;

-- Todos los días a las 20:00 de Paraguay (23:00 UTC).
SELECT cron.unschedule('dcanp-closure-reminder') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dcanp-closure-reminder');
SELECT cron.schedule('dcanp-closure-reminder', '0 23 * * *', 'SELECT public.closure_reminders()');

-- Estado del cierre del delivery logueado (para el aviso dentro de la app).
CREATE OR REPLACE FUNCTION public.my_closure_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  WITH me AS (SELECT lower(email) email FROM public.profiles WHERE user_id = auth.uid())
  SELECT jsonb_build_object(
    'today_orders', (SELECT count(*) FROM public.orders o, me WHERE lower(o.assigned_delivery) = me.email AND public.py_day(o.assigned_at) = public.py_day(now())),
    'finalized', EXISTS (SELECT 1 FROM public.delivery_day_closures c, me WHERE lower(c.delivery_email) = me.email AND c.day = public.py_day(now())),
    'to_render', (SELECT count(*) FROM public.orders o, me
                  WHERE lower(o.assigned_delivery) = me.email AND o.status IN ('ENTREGADO', 'ENCOMIENDA ENTREGADA')
                    AND coalesce(o.delivery_settled, false) = false
                    AND NOT EXISTS (SELECT 1 FROM public.delivery_closure_orders x WHERE x.order_id = o.id))
  );
$function$;
REVOKE ALL ON FUNCTION public.my_closure_status() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_closure_status() TO authenticated;
