-- El delivery tiene que tener la ubicación prendida para reportar sus pedidos:
-- su última ubicación tiene que ser de los últimos 15 minutos.
-- Además se aceptan todos los estados que usa el delivery en Cierres.
CREATE OR REPLACE FUNCTION public.delivery_location_fresh(p_email text, p_minutes integer DEFAULT 15)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_locations
    WHERE lower(delivery_email) = lower(coalesce(p_email, ''))
      AND updated_at > now() - make_interval(mins => p_minutes)
  );
$$;
GRANT EXECUTE ON FUNCTION public.delivery_location_fresh(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_update_order_status(p_order_ids uuid[], p_status text, p_message text DEFAULT NULL::text, p_attachment_url text DEFAULT NULL::text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_email text;
  v_role text;
  v_count integer := 0;
begin
  if p_order_ids is null or cardinality(p_order_ids) = 0 then
    raise exception 'No se seleccionaron pedidos';
  end if;

  if p_status not in (
    'PENDIENTE', 'EN RUTA', 'ENTREGADO', 'ENCOMIENDA ENTREGADA', 'CANCELADO', 'DEVUELTO A DEPÓSITO',
    'REAGENDADO', 'NO CONTESTA', 'NO DESEA', 'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'CANCELÓ POR WHATSAPP'
  ) then
    raise exception 'Estado no válido: %', p_status;
  end if;

  v_email := public.current_profile_email();

  select upper(ur.role::text)
  into v_role
  from public.user_roles ur
  where ur.user_id = auth.uid()
    and coalesce(ur.approved, false) = true
    and upper(ur.role::text) in ('ADMIN','PROVEEDOR','DELIVERY')
  order by case upper(ur.role::text) when 'ADMIN' then 1 when 'PROVEEDOR' then 2 else 3 end
  limit 1;

  if v_role is null then
    raise exception 'No tenés permiso para cambiar estados';
  end if;

  if v_role = 'DELIVERY' and p_status = 'DEVUELTO A DEPÓSITO' then
    raise exception 'Los repartidores no pueden cambiar a DEVUELTO A DEPÓSITO';
  end if;

  if v_role = 'DELIVERY' and not public.delivery_location_fresh(v_email, 15) then
    raise exception 'UBICACION_REQUERIDA: Activá tu ubicación para reportar tus pedidos';
  end if;

  if v_role = 'DELIVERY'
     and p_status in ('NO CONTESTA','CANCELADO')
     and (coalesce(trim(p_message), '') = '' or coalesce(trim(p_attachment_url), '') = '') then
    raise exception 'Para % el delivery debe adjuntar comentario y captura', p_status;
  end if;

  insert into public.order_status_history (order_id, previous_status, new_status, changed_by_email, changed_by_role, message, attachment_url)
  select o.id, coalesce(o.status, 'PENDIENTE'), p_status, v_email, v_role,
         nullif(trim(coalesce(p_message, '')), ''), nullif(trim(coalesce(p_attachment_url, '')), '')
  from public.orders o
  where o.id = any(p_order_ids)
    and (
      v_role = 'ADMIN'
      or (v_role = 'PROVEEDOR' and lower(coalesce(o.provider_email, '')) = v_email)
      or (v_role = 'DELIVERY' and (lower(coalesce(o.delivery_owner, '')) = v_email or lower(coalesce(o.assigned_delivery, '')) = v_email))
    );

  update public.orders o
  set status = p_status, updated_at = now()
  where o.id = any(p_order_ids)
    and (
      v_role = 'ADMIN'
      or (v_role = 'PROVEEDOR' and lower(coalesce(o.provider_email, '')) = v_email)
      or (v_role = 'DELIVERY' and (lower(coalesce(o.delivery_owner, '')) = v_email or lower(coalesce(o.assigned_delivery, '')) = v_email))
    );

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'No se pudo modificar ningún pedido seleccionado';
  end if;
  return v_count;
end;
$$;

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
  IF my_role = 'DELIVERY' AND NOT public.delivery_location_fresh(me.email, 15) THEN
    RAISE EXCEPTION 'UBICACION_REQUERIDA: Activá tu ubicación para reportar tus pedidos';
  END IF;

  UPDATE public.orders SET status = 'REAGENDADO', rescheduled_for = p_date, updated_at = now() WHERE id = p_order_id;

  INSERT INTO public.order_status_history(order_id, previous_status, new_status, changed_by_email, changed_by_name, changed_by_role, message)
  VALUES (p_order_id, o.status, 'REAGENDADO', me.email, me.name, my_role,
          '📅 Reagendado para el ' ||
          (ARRAY['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[extract(isodow FROM p_date)::int] || ' ' || to_char(p_date, 'DD/MM') ||
          coalesce(' · ' || nullif(trim(p_note), ''), ''));

  RETURN jsonb_build_object('rescheduled_for', p_date, 'needs_release', p_date > nd, 'next_business_day', nd);
END; $$;
