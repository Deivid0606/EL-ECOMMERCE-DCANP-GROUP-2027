-- 1) REAGENDADO con fecha.
--    - Fecha = próximo día hábil (o antes): el pedido sigue con el delivery.
--    - Fecha más lejana: el proveedor lo desasigna a mano y el pedido vuelve a
--      Despacho recién en esa fecha, para aprobar el despacho otra vez.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rescheduled_for date;

CREATE OR REPLACE FUNCTION public.reschedule_order(p_order_id uuid, p_date date, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o public.orders; me public.profiles; today date := public.py_day(now()); nd date; my_role text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  SELECT * INTO me FROM public.profiles WHERE user_id = auth.uid();
  IF me.email IS NULL THEN RAISE EXCEPTION 'Usuario no identificado'; END IF;
  IF NOT (public.can_edit_order_items(o)
          OR lower(coalesce(o.assigned_delivery, '')) = lower(me.email)
          OR lower(coalesce(o.delivery_owner, '')) = lower(me.email)) THEN
    RAISE EXCEPTION 'No podés reagendar este pedido';
  END IF;
  IF p_date IS NULL OR p_date <= today THEN RAISE EXCEPTION 'Elegí una fecha a partir de mañana'; END IF;
  IF p_date > today + 60 THEN RAISE EXCEPTION 'La fecha no puede ser a más de 60 días'; END IF;
  nd := public.next_business_day(today);
  my_role := CASE WHEN public.has_role(auth.uid(), 'ADMIN') THEN 'ADMIN'
                  WHEN public.has_role(auth.uid(), 'PROVEEDOR') THEN 'PROVEEDOR'
                  WHEN public.has_role(auth.uid(), 'DESPACHANTE') THEN 'DESPACHANTE'
                  ELSE 'DELIVERY' END;

  UPDATE public.orders SET status = 'REAGENDADO', rescheduled_for = p_date, updated_at = now() WHERE id = p_order_id;

  INSERT INTO public.order_status_history(order_id, previous_status, new_status, changed_by_email, changed_by_name, changed_by_role, message)
  VALUES (p_order_id, o.status, 'REAGENDADO', me.email, me.name, my_role,
          '📅 Reagendado para el ' ||
          (ARRAY['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[extract(isodow FROM p_date)::int] || ' ' || to_char(p_date, 'DD/MM') ||
          coalesce(' · ' || nullif(trim(p_note), ''), ''));

  RETURN jsonb_build_object('rescheduled_for', p_date, 'needs_release', p_date > nd, 'next_business_day', nd);
END; $$;
REVOKE ALL ON FUNCTION public.reschedule_order(uuid, date, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_order(uuid, date, text) TO authenticated;

-- Desasignar (lo hace el proveedor / admin a mano): sale del delivery y vuelve a
-- Despacho sin guía; aparece en Despacho recién en la fecha reagendada.
CREATE OR REPLACE FUNCTION public.release_rescheduled_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o public.orders; me public.profiles;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF NOT public.can_edit_order_items(o) THEN RAISE EXCEPTION 'Sólo el proveedor o el admin pueden desasignar'; END IF;
  IF upper(coalesce(o.status, '')) <> 'REAGENDADO' THEN RAISE EXCEPTION 'El pedido no está REAGENDADO'; END IF;
  IF coalesce(o.assigned_delivery, '') = '' THEN RAISE EXCEPTION 'El pedido ya no tiene delivery'; END IF;
  SELECT * INTO me FROM public.profiles WHERE user_id = auth.uid();

  UPDATE public.orders
  SET assigned_delivery = NULL, delivery_owner = NULL, assigned_team_member = NULL, assigned_at = NULL,
      status2 = NULL, updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_status_history(order_id, previous_status, new_status, changed_by_email, changed_by_name, changed_by_role, message, event_type)
  VALUES (p_order_id, o.status, o.status, me.email, me.name, 'PROVEEDOR',
          '↩️ Desasignado de ' || o.assigned_delivery || '. Vuelve a Despacho' ||
          coalesce(' el ' || to_char(o.rescheduled_for, 'DD/MM'), '') || ' para despacharse de nuevo.',
          'release');
  RETURN jsonb_build_object('ok', true, 'rescheduled_for', o.rescheduled_for);
END; $$;
REVOKE ALL ON FUNCTION public.release_rescheduled_order(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.release_rescheduled_order(uuid) TO authenticated;

-- Fin de día: los reagendados para después del próximo día hábil no pasan al día
-- siguiente (esperan que el proveedor los desasigne).
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
      AND NOT (upper(coalesce(status, '')) = 'REAGENDADO' AND rescheduled_for IS NOT NULL AND rescheduled_for > nd)
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

-- 2) Pago por estado por delivery: '' = todos; una regla de un delivery tiene prioridad.
ALTER TABLE public.delivery_status_pay ADD COLUMN IF NOT EXISTS delivery_email text NOT NULL DEFAULT '';
ALTER TABLE public.delivery_status_pay DROP CONSTRAINT IF EXISTS delivery_status_pay_pkey;
ALTER TABLE public.delivery_status_pay ADD CONSTRAINT delivery_status_pay_pkey PRIMARY KEY (status, delivery_email);

CREATE OR REPLACE FUNCTION public.delivery_attempt_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cfg public.delivery_status_pay; base numeric; amt numeric; today date := public.py_day(now()); delivery text;
BEGIN
  BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    delivery := lower(trim(coalesce(NEW.assigned_delivery, '')));
    IF delivery = '' THEN RETURN NEW; END IF;

    DELETE FROM public.delivery_attempt_payments
    WHERE order_id = NEW.id AND lower(delivery_email) = delivery AND day = today AND closure_id IS NULL;

    -- Regla del delivery (si existe) o la general. Si la del delivery está apagada, no se paga.
    SELECT * INTO cfg FROM public.delivery_status_pay
    WHERE upper(status) = upper(trim(coalesce(NEW.status, '')))
      AND lower(delivery_email) IN ('', delivery)
    ORDER BY (lower(delivery_email) = delivery) DESC
    LIMIT 1;
    IF NOT FOUND OR NOT cfg.active THEN RETURN NEW; END IF;

    base := public.order_city_fee(NEW);
    amt := CASE WHEN cfg.mode = 'fixed' THEN cfg.value ELSE round(base * cfg.value / 100) END;
    IF amt <= 0 THEN RETURN NEW; END IF;

    INSERT INTO public.delivery_attempt_payments(order_id, delivery_email, provider_email, status, day, base_fee, amount)
    VALUES (NEW.id, delivery,
            lower(nullif(trim(coalesce(NEW.provider_email, split_part(coalesce(NEW.provider_emails_list, ''), ',', 1))), '')),
            upper(trim(NEW.status)), today, base, amt)
    ON CONFLICT (order_id, delivery_email, day) DO UPDATE
      SET status = EXCLUDED.status, base_fee = EXCLUDED.base_fee, amount = EXCLUDED.amount, created_at = now()
      WHERE public.delivery_attempt_payments.closure_id IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'delivery_attempt_trigger: %', SQLERRM;
  END;
  RETURN NEW;
END; $$;

-- 3) REAGENDADO siempre con fecha (venga de donde venga el cambio).
CREATE OR REPLACE FUNCTION public.orders_reschedule_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF upper(coalesce(NEW.status, '')) = 'REAGENDADO'
     AND upper(coalesce(OLD.status, '')) IS DISTINCT FROM 'REAGENDADO'
     AND (NEW.rescheduled_for IS NULL OR NEW.rescheduled_for <= public.py_day(now())) THEN
    RAISE EXCEPTION 'REAGENDADO: elegí la fecha en el calendario';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS orders_reschedule_guard ON public.orders;
CREATE TRIGGER orders_reschedule_guard BEFORE UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_reschedule_guard();
