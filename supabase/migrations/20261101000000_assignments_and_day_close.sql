-- Asignaciones numeradas, "Finalicé mi día" y pase de pedidos al siguiente día hábil.
--
-- orders.assignment_count  veces que se asignó el pedido a un delivery (1, 2, 3…)
-- orders.day_seq           número del pedido en la ruta del delivery ese día (#1, #2…)
-- orders.first_assigned_at primera asignación (para saber si viene de otra fecha)
-- orders.carried_over_count veces que pasó al día siguiente por fin de día
--
-- Las fechas del día se calculan en hora de Paraguay.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assignment_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS day_seq integer;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS first_assigned_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS carried_over_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.order_status_history ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'status';

CREATE OR REPLACE FUNCTION public.py_day(ts timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT (ts AT TIME ZONE 'America/Asuncion')::date $$;

CREATE INDEX IF NOT EXISTS orders_delivery_day_idx ON public.orders (lower(assigned_delivery), public.py_day(assigned_at));

-- Datos existentes: una asignación, número del día según la hora de asignación.
-- Sin tocar updated_at (se usa para contar guías del día).
ALTER TABLE public.orders DISABLE TRIGGER update_orders_updated_at;
UPDATE public.orders SET first_assigned_at = assigned_at WHERE first_assigned_at IS NULL AND assigned_at IS NOT NULL;
UPDATE public.orders SET assignment_count = 1 WHERE assignment_count = 0 AND assigned_delivery IS NOT NULL;
UPDATE public.orders o SET day_seq = x.n
FROM (
  SELECT id, row_number() OVER (PARTITION BY lower(assigned_delivery), public.py_day(assigned_at) ORDER BY assigned_at, id) n
  FROM public.orders WHERE assigned_delivery IS NOT NULL AND assigned_at IS NOT NULL
) x
WHERE o.id = x.id AND o.day_seq IS NULL;
ALTER TABLE public.orders ENABLE TRIGGER update_orders_updated_at;

-- Numeración al asignar (o al cambiar el día de la asignación).
CREATE OR REPLACE FUNCTION public.order_assignment_numbers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE delivery_changed boolean; day_changed boolean;
BEGIN
  IF NEW.assigned_delivery IS NULL OR trim(NEW.assigned_delivery) = '' THEN
    NEW.day_seq := NULL;
    RETURN NEW;
  END IF;

  delivery_changed := TG_OP = 'INSERT' OR lower(coalesce(OLD.assigned_delivery, '')) IS DISTINCT FROM lower(NEW.assigned_delivery);
  IF delivery_changed AND (TG_OP = 'INSERT' OR NEW.assigned_at IS NOT DISTINCT FROM OLD.assigned_at) THEN
    NEW.assigned_at := coalesce(CASE WHEN TG_OP = 'INSERT' THEN NEW.assigned_at END, now());
  END IF;
  NEW.assigned_at := coalesce(NEW.assigned_at, now());
  day_changed := TG_OP = 'INSERT' OR public.py_day(NEW.assigned_at) IS DISTINCT FROM public.py_day(OLD.assigned_at);

  IF delivery_changed THEN
    NEW.assignment_count := coalesce(CASE WHEN TG_OP = 'UPDATE' THEN OLD.assignment_count END, 0) + 1;
    NEW.first_assigned_at := coalesce(CASE WHEN TG_OP = 'UPDATE' THEN OLD.first_assigned_at END, NEW.assigned_at);
  END IF;

  IF delivery_changed OR day_changed OR NEW.day_seq IS NULL THEN
    NEW.day_seq := 1 + coalesce((
      SELECT max(o.day_seq) FROM public.orders o
      WHERE lower(o.assigned_delivery) = lower(NEW.assigned_delivery)
        AND public.py_day(o.assigned_at) = public.py_day(NEW.assigned_at)
        AND o.id <> NEW.id
    ), 0);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS order_assignment_numbers ON public.orders;
CREATE TRIGGER order_assignment_numbers BEFORE INSERT OR UPDATE OF assigned_delivery, assigned_at ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.order_assignment_numbers();

-- Historial: "Asignado a Juan · asignación #2 · pedido #5 del día" con fecha y hora.
CREATE OR REPLACE FUNCTION public.order_assignment_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor text; actor_role text; delivery_name text;
BEGIN
  BEGIN
    IF NEW.assigned_delivery IS NULL OR trim(NEW.assigned_delivery) = '' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND lower(coalesce(OLD.assigned_delivery, '')) = lower(NEW.assigned_delivery) THEN RETURN NEW; END IF;

    SELECT p.email, coalesce(p.role, '') INTO actor, actor_role FROM public.profiles p WHERE p.user_id = auth.uid();
    delivery_name := coalesce((SELECT nullif(regexp_replace(trim(name), '\s+', ' ', 'g'), '') FROM public.profiles WHERE lower(email) = lower(NEW.assigned_delivery) LIMIT 1), NEW.assigned_delivery);

    INSERT INTO public.order_status_history(order_id, previous_status, new_status, changed_by_email, changed_by_role, message, event_type)
    VALUES (NEW.id, NEW.status, coalesce(NEW.status, 'PENDIENTE'), coalesce(actor, 'sistema'), coalesce(nullif(actor_role, ''), 'SISTEMA'),
            '🚚 Asignado a ' || delivery_name || ' · asignación #' || NEW.assignment_count || ' · pedido #' || NEW.day_seq || ' del ' ||
            to_char(NEW.assigned_at AT TIME ZONE 'America/Asuncion', 'DD/MM/YYYY HH24:MI'),
            'assignment');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'order_assignment_history: %', SQLERRM;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS order_assignment_history ON public.orders;
CREATE TRIGGER order_assignment_history AFTER INSERT OR UPDATE OF assigned_delivery ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.order_assignment_history();

-- Los avisos de "X reportó…" sólo para cambios de estado.
DROP TRIGGER IF EXISTS push_order_report ON public.order_status_history;
CREATE TRIGGER push_order_report AFTER INSERT ON public.order_status_history
FOR EACH ROW WHEN (coalesce(NEW.event_type, 'status') = 'status') EXECUTE FUNCTION public.push_order_report_trigger();

-- ============================================
-- FINALICÉ MI DÍA
-- ============================================

-- Lunes a jueves → día siguiente. Viernes, sábado y domingo → lunes.
CREATE OR REPLACE FUNCTION public.next_business_day(d date)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT d + CASE extract(isodow FROM d)::int WHEN 5 THEN 3 WHEN 6 THEN 2 ELSE 1 END;
$$;

CREATE TABLE IF NOT EXISTS public.delivery_day_closures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_email text NOT NULL,
  day date NOT NULL,
  next_day date NOT NULL,
  orders_total integer NOT NULL DEFAULT 0,
  delivered integer NOT NULL DEFAULT 0,
  moved integer NOT NULL DEFAULT 0,
  finalized_by text,
  finalized_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_email, day)
);
ALTER TABLE public.delivery_day_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_day_closures_read ON public.delivery_day_closures;
CREATE POLICY delivery_day_closures_read ON public.delivery_day_closures FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.delivery_day_closures FROM anon, authenticated;

-- Día desde el que aplica el pase automático (los días anteriores no se tocan).
CREATE OR REPLACE FUNCTION public.day_close_start() RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT date '2026-10-31' $$;

-- Pedidos que quedan sin reportar (bloquean el fin de día).
CREATE OR REPLACE FUNCTION public.is_unreported_status(s text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(trim(coalesce(s, ''))) IN ('', 'PENDIENTE', 'EN RUTA');
$$;

-- Estados que se quedan en su fecha.
CREATE OR REPLACE FUNCTION public.stays_on_day_status(s text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(trim(coalesce(s, ''))) IN ('ENTREGADO', 'ENCOMIENDA ENTREGADA', 'DEVUELTO A DEPÓSITO');
$$;

CREATE OR REPLACE FUNCTION public.finalize_delivery_day(p_day date DEFAULT NULL, p_delivery_email text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me text;
  is_admin boolean;
  target text;
  d date := coalesce(p_day, public.py_day(now()));
  nd date;
  pending jsonb;
  total_n integer;
  delivered_n integer;
  moved_n integer := 0;
  o record;
BEGIN
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  IF me IS NULL THEN RAISE EXCEPTION 'Usuario no identificado'; END IF;
  is_admin := public.has_role(auth.uid(), 'ADMIN');
  target := lower(trim(coalesce(nullif(p_delivery_email, ''), me)));
  IF target <> me AND NOT is_admin THEN RAISE EXCEPTION 'Sólo podés finalizar tu propio día'; END IF;
  IF NOT is_admin AND NOT public.has_role(auth.uid(), 'DELIVERY') THEN RAISE EXCEPTION 'Sólo un delivery puede finalizar su día'; END IF;
  IF d < public.day_close_start() THEN RAISE EXCEPTION 'El fin de día aplica desde el %', to_char(public.day_close_start(), 'DD/MM/YYYY'); END IF;
  IF d > public.py_day(now()) THEN RAISE EXCEPTION 'No se puede finalizar un día futuro'; END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_day_closures WHERE delivery_email = target AND day = d) THEN
    RAISE EXCEPTION 'Este día ya fue finalizado';
  END IF;

  PERFORM 1 FROM public.orders
  WHERE lower(assigned_delivery) = target AND public.py_day(assigned_at) = d
  FOR UPDATE;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'order_number', order_number, 'status', status) ORDER BY day_seq), '[]'::jsonb)
  INTO pending
  FROM public.orders
  WHERE lower(assigned_delivery) = target AND public.py_day(assigned_at) = d AND public.is_unreported_status(status);

  IF jsonb_array_length(pending) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Faltan reportar pedidos', 'pending', pending);
  END IF;

  SELECT count(*), count(*) FILTER (WHERE upper(status) IN ('ENTREGADO', 'ENCOMIENDA ENTREGADA'))
  INTO total_n, delivered_n
  FROM public.orders WHERE lower(assigned_delivery) = target AND public.py_day(assigned_at) = d;

  nd := public.next_business_day(d);

  FOR o IN
    SELECT id, status, assigned_at FROM public.orders
    WHERE lower(assigned_delivery) = target AND public.py_day(assigned_at) = d AND NOT public.stays_on_day_status(status)
    ORDER BY day_seq
  LOOP
    UPDATE public.orders
    SET assigned_at = ((nd + (o.assigned_at AT TIME ZONE 'America/Asuncion')::time) AT TIME ZONE 'America/Asuncion'),
        carried_over_count = carried_over_count + 1,
        updated_at = now()
    WHERE id = o.id;

    INSERT INTO public.order_status_history(order_id, previous_status, new_status, changed_by_email, changed_by_role, message, event_type)
    VALUES (o.id, o.status, o.status, me, CASE WHEN is_admin THEN 'ADMIN' ELSE 'DELIVERY' END,
            '📅 Fin de día: pasa del ' || to_char(d, 'DD/MM') || ' al ' ||
            (ARRAY['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[extract(isodow FROM nd)::int] || ' ' || to_char(nd, 'DD/MM') ||
            ' (estado ' || coalesce(o.status, '—') || ')',
            'carry');
    moved_n := moved_n + 1;
  END LOOP;

  INSERT INTO public.delivery_day_closures(delivery_email, day, next_day, orders_total, delivered, moved, finalized_by)
  VALUES (target, d, nd, total_n, delivered_n, moved_n, me);

  RETURN jsonb_build_object('ok', true, 'day', d, 'next_day', nd, 'total', total_n, 'delivered', delivered_n, 'moved', moved_n);
END; $$;
REVOKE ALL ON FUNCTION public.finalize_delivery_day(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_delivery_day(date, text) TO authenticated;
