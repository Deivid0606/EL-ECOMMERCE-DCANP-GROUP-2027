-- Editar productos de un pedido y fusionar pedidos del mismo cliente
-- (Cierres y Despacho). Total, comisión y delivery se recalculan en el servidor
-- con los precios de proveedor del catálogo.

-- ¿Quién puede editar / fusionar este pedido?
CREATE OR REPLACE FUNCTION public.can_edit_order_items(o public.orders)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text;
BEGIN
  IF public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'DESPACHANTE') THEN RETURN true; END IF;
  IF NOT public.has_role(auth.uid(), 'PROVEEDOR') THEN RETURN false; END IF;
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  RETURN me IS NOT NULL AND (
    lower(coalesce(o.provider_email, '')) = me
    OR me = ANY(regexp_split_to_array(lower(coalesce(o.provider_emails_list, '')), '[,;[:space:]]+'))
  );
END; $$;
REVOKE ALL ON FUNCTION public.can_edit_order_items(public.orders) FROM PUBLIC, anon;

-- Motivo por el que un pedido ya no se puede modificar (NULL = se puede).
CREATE OR REPLACE FUNCTION public.order_locked_reason(o public.orders)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public.tracking_finished_status(o.status) THEN RETURN format('el pedido %s ya está %s', o.order_number, o.status); END IF;
  IF coalesce(o.commission_paid, false) OR coalesce(o.commission_credited, false) THEN RETURN format('la comisión del pedido %s ya fue acreditada o pagada', o.order_number); END IF;
  IF coalesce(o.delivery_settled, false) THEN RETURN format('el pedido %s ya fue rendido', o.order_number); END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_closure_orders WHERE order_id = o.id) THEN RETURN format('el pedido %s ya está en un cierre de delivery', o.order_number); END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.order_locked_reason(public.orders) FROM PUBLIC, anon, authenticated;

-- ¿El pedido ya bajó stock?
CREATE OR REPLACE FUNCTION public.order_has_stock_applied(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.order_stock_ledger WHERE order_id = p_order_id AND reverted_at IS NULL)
      OR coalesce((SELECT sum(quantity_change) FROM public.delivery_stock_movements WHERE order_id = p_order_id), 0) < 0;
$$;
REVOKE ALL ON FUNCTION public.order_has_stock_applied(uuid) FROM PUBLIC, anon, authenticated;

-- Ítems normalizados con datos del catálogo (precio y email del proveedor).
CREATE OR REPLACE FUNCTION public.normalize_order_items(p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it jsonb; p public.products; out jsonb := '[]'::jsonb; q integer; sale numeric;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'El pedido necesita al menos un producto'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    q := coalesce(nullif(it->>'qty', '')::numeric, 0)::integer;
    sale := round(coalesce(nullif(it->>'sale_gs', '')::numeric, 0));
    IF q <= 0 THEN RAISE EXCEPTION 'La cantidad de "%" tiene que ser mayor a 0', coalesce(it->>'title', it->>'sku'); END IF;
    IF sale < 0 THEN RAISE EXCEPTION 'El precio de "%" no puede ser negativo', coalesce(it->>'title', it->>'sku'); END IF;
    SELECT * INTO p FROM public.products WHERE id = public.order_item_product(it);
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe el producto con SKU "%"', coalesce(it->>'sku', '?'); END IF;
    out := out || jsonb_build_array(jsonb_build_object(
      'sku', p.sku, 'title', p.title, 'qty', q, 'sale_gs', sale,
      'provider_price_gs', coalesce(p.provider_price_gs, 0), 'provider_email', coalesce(p.provider_email, '')));
  END LOOP;
  RETURN out;
END; $$;
REVOKE ALL ON FUNCTION public.normalize_order_items(jsonb) FROM PUBLIC, anon, authenticated;

-- Totales del pedido: venta, costo de proveedor y lista de proveedores.
CREATE OR REPLACE FUNCTION public.order_items_totals(p_items jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'sale', coalesce(sum((it->>'sale_gs')::numeric), 0),
    'provider', coalesce(sum((it->>'provider_price_gs')::numeric * (it->>'qty')::numeric), 0),
    'providers', coalesce(string_agg(DISTINCT nullif(it->>'provider_email', ''), ','), ''))
  FROM jsonb_array_elements(p_items) it;
$$;

-- ✏️ Editar productos, cantidades y precios (sale_gs = total de la línea).
CREATE OR REPLACE FUNCTION public.edit_order_items(p_order_id uuid, p_items jsonb, p_delivery_gs numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o public.orders; me record; items jsonb; t jsonb; delivery numeric; reason text; before_txt text; after_txt text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF NOT public.can_edit_order_items(o) THEN RAISE EXCEPTION 'No tenés permiso para editar este pedido'; END IF;
  reason := public.order_locked_reason(o);
  IF reason IS NOT NULL THEN RAISE EXCEPTION 'No se puede editar: %', reason; END IF;
  IF public.order_has_stock_applied(o.id) THEN
    RAISE EXCEPTION 'No se puede editar: el pedido % ya bajó stock. Pasalo a DEVUELTO A DEPÓSITO o pedí al admin que lo corrija.', o.order_number;
  END IF;

  items := public.normalize_order_items(p_items);
  t := public.order_items_totals(items);
  delivery := coalesce(p_delivery_gs, o.delivery_gs, 0);
  IF delivery < 0 THEN RAISE EXCEPTION 'El delivery no puede ser negativo'; END IF;

  SELECT string_agg((x->>'qty') || '× ' || (x->>'title') || ' (Gs ' || (x->>'sale_gs') || ')', ', ') INTO before_txt FROM jsonb_array_elements(coalesce(o.items_json, '[]'::jsonb)) x;
  SELECT string_agg((x->>'qty') || '× ' || (x->>'title') || ' (Gs ' || (x->>'sale_gs') || ')', ', ') INTO after_txt FROM jsonb_array_elements(items) x;

  UPDATE public.orders SET
    items_json = items,
    total_gs = (t->>'sale')::numeric,
    delivery_gs = delivery,
    commission_gs = (t->>'sale')::numeric - (t->>'provider')::numeric - delivery,
    provider_emails_list = t->>'providers',
    updated_at = now()
  WHERE id = o.id;

  SELECT lower(email) AS email, upper(coalesce(role::text, '')) AS role INTO me FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.order_status_history(order_id, previous_status, new_status, changed_by_email, changed_by_role, message)
  VALUES (o.id, o.status, o.status, me.email, me.role,
          left('✏️ Pedido editado. Antes: ' || coalesce(before_txt, '—') || ' → Ahora: ' || coalesce(after_txt, '—') ||
               ' · Total Gs ' || (t->>'sale') || ' · Comisión Gs ' || ((t->>'sale')::numeric - (t->>'provider')::numeric - delivery), 1000));

  RETURN jsonb_build_object('ok', true, 'total', (t->>'sale')::numeric,
                            'commission', (t->>'sale')::numeric - (t->>'provider')::numeric - delivery, 'delivery', delivery);
END; $$;
REVOKE ALL ON FUNCTION public.edit_order_items(uuid, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_order_items(uuid, jsonb, numeric) TO authenticated;

-- 🔗 Fusionar pedidos del mismo vendedor (y normalmente el mismo cliente) en
-- uno solo: todos los productos, UN delivery y la comisión correspondiente.
-- Queda el pedido más antiguo; los otros se eliminan (su historial pasa al que queda).
CREATE OR REPLACE FUNCTION public.merge_orders(p_order_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ids uuid[]; keep public.orders; o public.orders; me record; reason text;
  items jsonb := '[]'::jsonb; t jsonb; delivery numeric; stock_count int := 0; n int; others text := '';
  sum_commission numeric; sum_delivery numeric; sum_total numeric; commission numeric;
BEGIN
  SELECT array_agg(DISTINCT x) INTO ids FROM unnest(p_order_ids) x;
  n := coalesce(array_length(ids, 1), 0);
  IF n < 2 THEN RAISE EXCEPTION 'Elegí al menos 2 pedidos para fusionar'; END IF;
  IF n > 10 THEN RAISE EXCEPTION 'Se pueden fusionar hasta 10 pedidos a la vez'; END IF;

  -- Bloqueo y validaciones.
  FOR o IN SELECT * FROM public.orders WHERE id = ANY(ids) ORDER BY created_at, order_number FOR UPDATE LOOP
    IF keep.id IS NULL THEN keep := o; END IF;
    IF NOT public.can_edit_order_items(o) THEN RAISE EXCEPTION 'No tenés permiso para fusionar el pedido %', o.order_number; END IF;
    reason := public.order_locked_reason(o);
    IF reason IS NOT NULL THEN RAISE EXCEPTION 'No se puede fusionar: %', reason; END IF;
    IF lower(coalesce(o.created_by, '')) <> lower(coalesce(keep.created_by, '')) THEN
      RAISE EXCEPTION 'No se puede fusionar: los pedidos son de vendedores distintos (% y %)', keep.created_by, o.created_by;
    END IF;
    IF EXISTS (SELECT 1 FROM public.delivery_attempt_payments WHERE order_id = o.id) AND o.id <> keep.id THEN
      RAISE EXCEPTION 'No se puede fusionar: el pedido % ya tiene pagos de intentos al delivery', o.order_number;
    END IF;
    IF EXISTS (SELECT 1 FROM public.delivery_team_receipt_orders WHERE order_id = o.id) AND o.id <> keep.id THEN
      RAISE EXCEPTION 'No se puede fusionar: el pedido % ya está en un recibo de equipo', o.order_number;
    END IF;
    IF public.order_has_stock_applied(o.id) THEN stock_count := stock_count + 1; END IF;
    items := items || coalesce(o.items_json, '[]'::jsonb);
  END LOOP;
  IF (SELECT count(*) FROM public.orders WHERE id = ANY(ids)) <> n THEN RAISE EXCEPTION 'Algún pedido ya no existe'; END IF;
  IF stock_count > 0 AND stock_count < n THEN
    RAISE EXCEPTION 'No se puede fusionar: algunos pedidos ya bajaron stock y otros no. Fusioná antes de bajar el stock.';
  END IF;

  -- Un solo delivery: el del pedido que queda (si no tiene, el mayor de los otros).
  SELECT coalesce(nullif(keep.delivery_gs, 0), max(delivery_gs), 0),
         coalesce(sum(commission_gs), 0), coalesce(sum(delivery_gs), 0), coalesce(sum(total_gs), 0)
    INTO delivery, sum_commission, sum_delivery, sum_total
  FROM public.orders WHERE id = ANY(ids);
  t := public.order_items_totals(items);
  -- Comisión = la suma de las comisiones de cada pedido + los deliverys que ya no se cobran.
  commission := sum_commission + (sum_delivery - delivery);
  SELECT string_agg(order_number, ', ' ORDER BY created_at) INTO others FROM public.orders WHERE id = ANY(ids) AND id <> keep.id;

  -- El historial, el stock ya descontado y los links pasan al pedido que queda.
  UPDATE public.order_status_history SET order_id = keep.id WHERE order_id = ANY(ids) AND order_id <> keep.id;
  UPDATE public.order_stock_ledger SET order_id = keep.id WHERE order_id = ANY(ids) AND order_id <> keep.id;
  UPDATE public.delivery_stock_movements SET order_id = keep.id WHERE order_id = ANY(ids) AND order_id <> keep.id;
  UPDATE public.order_tracking_links SET order_id = keep.id WHERE order_id = ANY(ids) AND order_id <> keep.id;

  UPDATE public.orders SET
    items_json = items,
    total_gs = sum_total,
    delivery_gs = delivery,
    commission_gs = commission,
    provider_emails_list = t->>'providers',
    guide_number = coalesce(nullif(keep.guide_number, ''), (SELECT guide_number FROM public.orders WHERE id = ANY(ids) AND coalesce(guide_number, '') <> '' LIMIT 1)),
    obs = trim(both ' ' FROM coalesce(keep.obs, '') || ' 🔗 Fusionado con ' || others),
    updated_at = now()
  WHERE id = keep.id;

  DELETE FROM public.orders WHERE id = ANY(ids) AND id <> keep.id;

  SELECT lower(email) AS email, upper(coalesce(role::text, '')) AS role INTO me FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.order_status_history(order_id, previous_status, new_status, changed_by_email, changed_by_role, message)
  VALUES (keep.id, keep.status, keep.status, me.email, me.role,
          left('🔗 Pedidos fusionados: ' || keep.order_number || ' + ' || others || '. Un solo delivery (Gs ' || delivery ||
               ', se ahorró Gs ' || (sum_delivery - delivery) || '). Total Gs ' || sum_total || ' · Comisión Gs ' || commission, 1000));

  RETURN jsonb_build_object('ok', true, 'order_id', keep.id, 'order_number', keep.order_number, 'merged', others,
                            'total', sum_total, 'delivery', delivery, 'saved_delivery', sum_delivery - delivery, 'commission', commission);
END; $$;
REVOKE ALL ON FUNCTION public.merge_orders(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_orders(uuid[]) TO authenticated;
