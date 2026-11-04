-- Full dispatch editor: one atomic transaction with the existing price/stock guards.
CREATE OR REPLACE FUNCTION public.edit_dispatch_order(
  p_order_id uuid,
  p_details jsonb,
  p_items jsonb,
  p_delivery_gs numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o public.orders;
  answer jsonb;
  key text;
  allowed_keys text[] := ARRAY[
    'customer_name','phone','city','departamento','street','district',
    'email','obs','guide_number','shipping_type'
  ];
  actor record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Iniciá sesión para editar pedidos'; END IF;
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object' THEN
    RAISE EXCEPTION 'Datos del pedido inválidos';
  END IF;
  FOR key IN SELECT jsonb_object_keys(p_details) LOOP
    IF NOT (key = ANY(allowed_keys)) THEN
      RAISE EXCEPTION 'Campo no editable: %', key;
    END IF;
  END LOOP;
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF NOT public.can_edit_order_items(o) THEN
    RAISE EXCEPTION 'No tenés permiso para editar este pedido';
  END IF;
  IF public.order_locked_reason(o) IS NOT NULL THEN
    RAISE EXCEPTION 'Pedido bloqueado: %', public.order_locked_reason(o);
  END IF;
  IF public.order_has_stock_applied(o.id) THEN
    RAISE EXCEPTION 'No se puede editar un pedido con stock descontado';
  END IF;
  IF trim(coalesce(p_details->>'customer_name','')) = ''
    OR trim(coalesce(p_details->>'phone','')) = ''
    OR trim(coalesce(p_details->>'city','')) = '' THEN
    RAISE EXCEPTION 'Nombre, teléfono y ciudad son obligatorios';
  END IF;
  IF coalesce(p_details->>'shipping_type','DELIVERY') NOT IN ('DELIVERY','ENCOMIENDA') THEN
    RAISE EXCEPTION 'Modalidad de envío inválida';
  END IF;

  -- Reusa la lógica existente: normalización, precios, proveedor, comisión,
  -- bloqueo por cierre/stock y registro de cambios.
  answer := public.edit_order_items(p_order_id, p_items, p_delivery_gs);

  UPDATE public.orders SET
    customer_name = trim(p_details->>'customer_name'),
    phone = trim(p_details->>'phone'),
    city = trim(p_details->>'city'),
    departamento = nullif(trim(coalesce(p_details->>'departamento','')), ''),
    street = nullif(trim(coalesce(p_details->>'street','')), ''),
    district = nullif(trim(coalesce(p_details->>'district','')), ''),
    email = nullif(trim(coalesce(p_details->>'email','')), ''),
    obs = nullif(trim(coalesce(p_details->>'obs','')), ''),
    guide_number = nullif(trim(coalesce(p_details->>'guide_number','')), ''),
    shipping_type = p_details->>'shipping_type',
    updated_at = now()
  WHERE id = p_order_id;

  SELECT lower(email) AS email, upper(coalesce(role::text,'')) AS role
    INTO actor FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.order_status_history(
    order_id,previous_status,new_status,changed_by_email,changed_by_role,event_type,message
  ) VALUES (
    p_order_id,o.status,o.status,actor.email,actor.role,'edit',
    left('✏️ Despacho: datos del cliente, dirección, envío y guía actualizados',1000)
  );

  RETURN answer || jsonb_build_object('details_updated', true);
END;
$$;
REVOKE ALL ON FUNCTION public.edit_dispatch_order(uuid,jsonb,jsonb,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_dispatch_order(uuid,jsonb,jsonb,numeric) TO authenticated;
