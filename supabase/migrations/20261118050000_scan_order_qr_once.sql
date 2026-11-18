-- 📷 El QR de cada pedido se escanea una sola vez: queda registrado quién y cuándo.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS qr_scanned_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS qr_scanned_by text;

-- Escanear: delivery → se asigna el pedido; admin / proveedor / despachante → lo asigna a p_delivery.
CREATE OR REPLACE FUNCTION public.scan_order_qr(p_code text, p_delivery text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  me text := public.current_profile_email();
  v_role text;
  code text := regexp_replace(trim(coalesce(p_code, '')), '\s+', '', 'g');
  o public.orders;
  target text;
  who text;
  dname text;
BEGIN
  SELECT upper(ur.role::text) INTO v_role FROM public.user_roles ur
  WHERE ur.user_id = auth.uid() AND coalesce(ur.approved, false)
    AND upper(ur.role::text) IN ('ADMIN', 'PROVEEDOR', 'DESPACHANTE', 'DELIVERY')
  ORDER BY CASE upper(ur.role::text) WHEN 'ADMIN' THEN 1 WHEN 'PROVEEDOR' THEN 2 WHEN 'DESPACHANTE' THEN 3 ELSE 4 END LIMIT 1;
  IF v_role IS NULL THEN RAISE EXCEPTION 'No tenés permiso para escanear pedidos'; END IF;
  IF code = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found', 'code', code); END IF;

  IF code ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO o FROM public.orders WHERE id = code::uuid FOR UPDATE;
  END IF;
  IF o.id IS NULL THEN SELECT * INTO o FROM public.orders WHERE order_number = code FOR UPDATE; END IF;
  IF o.id IS NULL THEN SELECT * INTO o FROM public.orders WHERE upper(order_number) = upper(code) LIMIT 1 FOR UPDATE; END IF;
  IF o.id IS NULL THEN SELECT * INTO o FROM public.orders WHERE source_ref = code LIMIT 1 FOR UPDATE; END IF;
  IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found', 'code', code); END IF;

  IF v_role = 'PROVEEDOR' AND lower(trim(coalesce(o.provider_email, ''))) <> me
     AND position(me IN lower(coalesce(o.provider_emails_list, ''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_yours', 'order_number', o.order_number);
  END IF;

  -- Ya escaneado: no se vuelve a registrar.
  IF o.qr_scanned_at IS NOT NULL THEN
    SELECT coalesce(nullif(trim(name), ''), o.qr_scanned_by) INTO who FROM public.profiles WHERE lower(email) = lower(o.qr_scanned_by) LIMIT 1;
    SELECT coalesce(nullif(trim(name), ''), o.assigned_delivery) INTO dname FROM public.profiles WHERE lower(email) = lower(o.assigned_delivery) LIMIT 1;
    RETURN jsonb_build_object('ok', false, 'reason', 'already', 'order_number', o.order_number,
      'scanned_at', o.qr_scanned_at, 'scanned_by', coalesce(who, o.qr_scanned_by),
      'delivery', coalesce(dname, o.assigned_delivery));
  END IF;

  -- Pedido ya cerrado (entregado, cancelado, devuelto…): no se toca.
  IF upper(coalesce(o.status, '')) IN ('ENTREGADO', 'ENCOMIENDA ENTREGADA', 'CANCELADO', 'DEVUELTO A DEPÓSITO',
       'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'CANCELÓ POR WHATSAPP', 'NO DESEA') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed', 'order_number', o.order_number, 'status', o.status);
  END IF;

  IF v_role = 'DELIVERY' THEN
    target := me;
    IF o.assigned_delivery IS NOT NULL AND lower(trim(o.assigned_delivery)) <> me THEN
      SELECT coalesce(nullif(trim(name), ''), o.assigned_delivery) INTO dname FROM public.profiles WHERE lower(email) = lower(o.assigned_delivery) LIMIT 1;
      RETURN jsonb_build_object('ok', false, 'reason', 'other_delivery', 'order_number', o.order_number, 'delivery', coalesce(dname, o.assigned_delivery));
    END IF;
  ELSE
    target := lower(trim(coalesce(p_delivery, '')));
    IF target = '' THEN RAISE EXCEPTION 'Elegí el delivery'; END IF;
  END IF;

  UPDATE public.orders SET
    assigned_delivery = target,
    assigned_at = CASE WHEN lower(trim(coalesce(assigned_delivery, ''))) = target THEN coalesce(assigned_at, now()) ELSE now() END,
    status = 'EN RUTA',
    qr_scanned_at = now(),
    qr_scanned_by = me
  WHERE id = o.id;

  SELECT coalesce(nullif(trim(name), ''), target) INTO dname FROM public.profiles WHERE lower(email) = target LIMIT 1;
  RETURN jsonb_build_object('ok', true, 'order_number', o.order_number, 'customer_name', o.customer_name,
    'city', o.city, 'total_gs', o.total_gs, 'delivery', coalesce(dname, target));
END $function$;
REVOKE ALL ON FUNCTION public.scan_order_qr(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.scan_order_qr(text, text) TO authenticated;
