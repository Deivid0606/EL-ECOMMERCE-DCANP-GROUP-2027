-- Plata de cada pedido para el mapa en vivo (misma regla que el detalle financiero de Cierres).
CREATE OR REPLACE FUNCTION public.order_money_breakdown(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o public.orders; fee numeric := 0; price numeric := 0; cost numeric := 0;
  norm_city text; tariff text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Tarifa del delivery: la guardada en el pedido o la tarifa por ciudad del titular / asignado.
  fee := coalesce(o.delivery_fee_gs, 0);
  IF fee <= 0 THEN
    norm_city := lower(trim(translate(coalesce(o.city, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')));
    tariff := lower(trim(coalesce(nullif(o.delivery_owner, ''), o.assigned_delivery, '')));
    SELECT coalesce(f.fee_gs, 0) INTO fee FROM public.delivery_fees f
    WHERE lower(trim(f.delivery_email)) = tariff
      AND lower(trim(translate(coalesce(f.city, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))) = norm_city
    LIMIT 1;
    fee := coalesce(fee, 0);
  END IF;

  -- Precio del proveedor y costo real según los productos del pedido.
  IF jsonb_typeof(o.items_json) = 'array' THEN
    SELECT coalesce(sum(coalesce(nullif(it->>'provider_price_gs', '')::numeric, 0)
                        * coalesce(nullif(coalesce(it->>'qty', it->>'quantity'), '')::numeric, 1)), 0),
           coalesce(sum(coalesce((SELECT p.real_cost_gs FROM public.products p WHERE trim(p.sku) = trim(it->>'sku') LIMIT 1), 0)
                        * coalesce(nullif(it->>'qty', '')::numeric, 0)), 0)
      INTO price, cost
    FROM jsonb_array_elements(o.items_json) it;
  END IF;
  IF coalesce(price, 0) <= 0 THEN
    price := greatest(0, coalesce(o.total_gs, 0) - coalesce(o.commission_gs, 0) - coalesce(o.delivery_gs, 0));
  END IF;

  RETURN jsonb_build_object(
    'total', coalesce(o.total_gs, 0),
    'fee', fee,
    'commission', coalesce(o.commission_gs, 0),
    'delivery_charged', coalesce(o.delivery_gs, 0),
    'provider_price', price,
    'real_cost', coalesce(cost, 0));
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('total', coalesce(o.total_gs, 0), 'fee', 0, 'commission', 0, 'delivery_charged', 0, 'provider_price', 0, 'real_cost', 0);
END; $$;
REVOKE ALL ON FUNCTION public.order_money_breakdown(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.live_map_data()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text; is_admin boolean; d date := public.py_day(now()); result jsonb;
BEGIN
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  is_admin := public.has_role(auth.uid(), 'ADMIN');
  IF NOT is_admin AND NOT public.has_role(auth.uid(), 'PROVEEDOR') THEN RAISE EXCEPTION 'Sin permiso'; END IF;

  WITH visible_orders AS (
    SELECT o.* FROM public.orders o
    WHERE o.assigned_delivery IS NOT NULL AND public.py_day(o.assigned_at) = d
      AND (is_admin OR lower(coalesce(o.provider_email, '')) = me OR lower(coalesce(o.delivery_owner, '')) = me
           OR me = ANY(regexp_split_to_array(lower(coalesce(o.provider_emails_list, '')), '[,;[:space:]]+')))
  ),
  drivers AS (
    SELECT DISTINCT lower(assigned_delivery) AS email FROM visible_orders
    WHERE NOT EXISTS (SELECT 1 FROM public.delivery_day_closures c WHERE c.delivery_email = lower(visible_orders.assigned_delivery) AND c.day = d)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'email', dr.email,
    'name', coalesce((SELECT nullif(regexp_replace(trim(p.name), '\s+', ' ', 'g'), '') FROM public.profiles p WHERE lower(p.email) = dr.email LIMIT 1), dr.email),
    'location', (SELECT jsonb_build_object('lat', dl.lat, 'lng', dl.lng, 'updated_at', dl.updated_at) FROM public.delivery_locations dl
                 WHERE lower(dl.delivery_email) = dr.email AND public.py_day(dl.updated_at) = d ORDER BY dl.updated_at DESC LIMIT 1),
    'trail', (SELECT coalesce(jsonb_agg(jsonb_build_array(lat, lng) ORDER BY at), '[]'::jsonb) FROM (
                SELECT lat, lng, at FROM public.delivery_location_points pt
                WHERE lower(pt.delivery_email) = dr.email AND public.py_day(pt.at) = d ORDER BY at DESC LIMIT 400) t),
    'orders', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'id', o.id, 'order_number', o.order_number, 'seq', o.day_seq, 'status', o.status,
                  'customer', o.customer_name, 'city', o.city, 'total_gs', o.total_gs,
                  'updated_at', o.updated_at, 'delivered_at', o.delivered_at,
                  'phone', o.phone,
                  'money', public.order_money_breakdown(o.id),
                  'dest', (SELECT jsonb_build_object('lat', l.dest_lat, 'lng', l.dest_lng) FROM public.order_tracking_links l
                           WHERE l.order_id = o.id AND l.dest_lat IS NOT NULL ORDER BY l.created_at DESC LIMIT 1)
                ) ORDER BY o.day_seq NULLS LAST), '[]'::jsonb)
               FROM visible_orders o WHERE lower(o.assigned_delivery) = dr.email)
  ) ORDER BY dr.email), '[]'::jsonb)
  INTO result FROM drivers dr;

  RETURN jsonb_build_object('day', d, 'drivers', result, 'at', now());
END; $$;
REVOKE ALL ON FUNCTION public.live_map_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_map_data() TO authenticated;

-- ¿Puede este usuario manejar el seguimiento de este pedido? (misma regla que create_tracking_link)
CREATE OR REPLACE FUNCTION public.can_manage_order_tracking(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text; o public.orders;
BEGIN
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  IF me IS NULL THEN RETURN false; END IF;
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN public.has_role(auth.uid(), 'ADMIN')
    OR lower(coalesce(o.assigned_delivery, '')) = me
    OR lower(coalesce(o.delivery_owner, '')) = me
    OR (public.has_role(auth.uid(), 'PROVEEDOR') AND (
         lower(coalesce(o.provider_email, '')) = me
         OR me = ANY(regexp_split_to_array(lower(coalesce(o.provider_emails_list, '')), '[,;[:space:]]+'))));
END; $$;
REVOKE ALL ON FUNCTION public.can_manage_order_tracking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_order_tracking(uuid) TO authenticated;

-- Ubicación del cliente cargada en el seguimiento del pedido.
CREATE OR REPLACE FUNCTION public.get_order_destination(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  IF NOT public.can_manage_order_tracking(p_order_id) THEN RETURN NULL; END IF;
  SELECT dest_lat, dest_lng INTO r FROM public.order_tracking_links
  WHERE order_id = p_order_id AND dest_lat IS NOT NULL ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('lat', r.dest_lat, 'lng', r.dest_lng);
END; $$;
REVOKE ALL ON FUNCTION public.get_order_destination(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_destination(uuid) TO authenticated;

-- Cambiar (lat/lng) o borrar (NULL) la ubicación del cliente en todos los links del pedido.
CREATE OR REPLACE FUNCTION public.set_order_destination(p_order_id uuid, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF NOT public.can_manage_order_tracking(p_order_id) THEN
    RAISE EXCEPTION 'No tenés permiso para cambiar la ubicación de este pedido';
  END IF;
  IF (p_lat IS NULL) <> (p_lng IS NULL) THEN RAISE EXCEPTION 'Ubicación incompleta'; END IF;
  IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Ubicación inválida';
  END IF;
  UPDATE public.order_tracking_links SET dest_lat = p_lat, dest_lng = p_lng WHERE order_id = p_order_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.set_order_destination(uuid, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_destination(uuid, double precision, double precision) TO authenticated;
