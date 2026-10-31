-- Reportes de pedidos: "Delivery Juan reportó NO CONTESTA".
-- * order_status_history guarda el nombre de quien reporta.
-- * Cada reporte genera la notificación del cambio de estado con quién, qué y
--   el comentario. Usa la misma clave que push_order_status_trigger, así no
--   llegan dos avisos (el reporte se guarda antes de cambiar el estado).
-- * Quien hace el cambio no recibe aviso de su propio reporte.

ALTER TABLE public.order_status_history ADD COLUMN IF NOT EXISTS changed_by_name text;

CREATE OR REPLACE FUNCTION public.role_label(r text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(coalesce(r, ''))
    WHEN 'DELIVERY' THEN 'Delivery'
    WHEN 'ADMIN' THEN 'Admin'
    WHEN 'PROVEEDOR' THEN 'Proveedor'
    WHEN 'VENDEDOR' THEN 'Vendedor'
    WHEN 'DESPACHANTE' THEN 'Despachante'
    ELSE initcap(coalesce(nullif(r, ''), 'Usuario'))
  END;
$$;

CREATE OR REPLACE FUNCTION public.order_history_set_name() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(NEW.changed_by_name, '') = '' THEN
    NEW.changed_by_name := (SELECT nullif(regexp_replace(trim(name), '\s+', ' ', 'g'), '') FROM public.profiles WHERE lower(email) = lower(NEW.changed_by_email) LIMIT 1);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS order_history_set_name ON public.order_status_history;
CREATE TRIGGER order_history_set_name BEFORE INSERT ON public.order_status_history FOR EACH ROW EXECUTE FUNCTION public.order_history_set_name();

-- Nombres en el historial existente.
UPDATE public.order_status_history h SET changed_by_name = nullif(regexp_replace(trim(p.name), '\s+', ' ', 'g'), '')
FROM public.profiles p
WHERE h.changed_by_name IS NULL AND lower(p.email) = lower(h.changed_by_email);

CREATE OR REPLACE FUNCTION public.push_order_report_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o public.orders;
  uid uuid;
  pr public.notification_preferences;
  actor uuid;
  status_text text := upper(trim(coalesce(NEW.new_status, '')));
  who text;
  title text;
  body text;
BEGIN
  BEGIN
    IF status_text = '' THEN RETURN NEW; END IF;
    SELECT * INTO o FROM public.orders WHERE id = NEW.order_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    SELECT user_id INTO actor FROM public.profiles WHERE lower(email) = lower(NEW.changed_by_email) LIMIT 1;
    who := public.role_label(NEW.changed_by_role) || ' ' || coalesce(nullif(NEW.changed_by_name, ''), NEW.changed_by_email, '');
    title := left(CASE upper(coalesce(NEW.changed_by_role, '')) WHEN 'DELIVERY' THEN '🚚 ' ELSE '📦 ' END || who || ' reportó ' || status_text, 130);
    body := left(
      'Pedido ' || coalesce(o.order_number::text, '') || ' · ' || coalesce(o.customer_name, 'Cliente') || ' · ' || coalesce(o.city, '')
      || CASE WHEN coalesce(trim(NEW.message), '') <> '' THEN E'\n💬 ' || trim(NEW.message) ELSE '' END
      || CASE WHEN NEW.attachment_url IS NOT NULL THEN E'\n📷 Con foto adjunta' ELSE '' END,
      300);

    FOR uid IN
      SELECT DISTINCT u FROM (
        SELECT public.push_users(o.created_by) u
        UNION SELECT public.push_users(o.provider_email)
        UNION SELECT public.push_users(o.assigned_delivery)
      ) x WHERE u IS NOT NULL AND u IS DISTINCT FROM actor
    LOOP
      IF status_text = ANY ((public.notif_prefs(uid)).order_statuses) THEN
        PERFORM public.push_add(uid, 'order:' || o.id || ':' || status_text, title, body, '/?go=orders');
      END IF;
    END LOOP;

    FOR uid IN SELECT public.push_role_users('ADMIN') LOOP
      CONTINUE WHEN uid IS NOT DISTINCT FROM actor;
      pr := public.notif_prefs(uid);
      IF pr.all_orders AND status_text = ANY (pr.order_statuses) THEN
        PERFORM public.push_add(uid, 'order:' || o.id || ':' || status_text, title, body, '/?go=orders');
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_order_report_trigger: %', SQLERRM;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS push_order_report ON public.order_status_history;
CREATE TRIGGER push_order_report AFTER INSERT ON public.order_status_history FOR EACH ROW EXECUTE FUNCTION public.push_order_report_trigger();

-- Aviso genérico de cambio de estado (cuando no hay reporte): tampoco se avisa
-- a quien hizo el cambio.
CREATE OR REPLACE FUNCTION public.push_order_status_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid; pr public.notification_preferences; status_text text := upper(trim(coalesce(NEW.status, ''))); seller text; actor uuid := auth.uid();
BEGIN
  BEGIN
    IF status_text <> '' AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      FOR uid IN
        SELECT DISTINCT u FROM (
          SELECT public.push_users(NEW.created_by) u
          UNION SELECT public.push_users(NEW.provider_email)
          UNION SELECT public.push_users(NEW.assigned_delivery)
        ) x WHERE u IS NOT NULL AND u IS DISTINCT FROM actor
      LOOP
        IF status_text = ANY ((public.notif_prefs(uid)).order_statuses) THEN
          PERFORM public.push_add(uid, 'order:' || NEW.id || ':' || status_text,
            '📦 ' || status_text || ' · Pedido ' || coalesce(NEW.order_number::text, ''),
            left(coalesce(NEW.customer_name, 'Cliente') || ' · ' || coalesce(NEW.city, '') || ' · ' || public.push_gs(NEW.total_gs), 300),
            '/?go=orders');
        END IF;
      END LOOP;

      FOR uid IN SELECT public.push_role_users('ADMIN') LOOP
        CONTINUE WHEN uid IS NOT DISTINCT FROM actor;
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
