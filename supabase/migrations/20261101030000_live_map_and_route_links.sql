-- Mapa en vivo, link de ruta global del delivery y botón "Estoy en camino".

-- ============================================
-- ¿Cuándo comparte ubicación la app del delivery?
-- Con links de seguimiento activos a su nombre o con pedidos EN RUTA del día
-- (mientras no haya finalizado el día). Así el mapa en vivo lo ve moverse.
-- ============================================
CREATE OR REPLACE FUNCTION public.my_active_tracking_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH me AS (SELECT lower(email) AS email FROM public.profiles WHERE user_id = auth.uid())
  SELECT (
    (SELECT count(*) FROM public.order_tracking_links l
     JOIN public.orders o ON o.id = l.order_id, me
     WHERE lower(coalesce(l.tracker_email, l.delivery_email)) = me.email
       AND l.expires_at > now()
       AND lower(coalesce(o.assigned_delivery, '')) = lower(l.delivery_email)
       AND NOT public.tracking_finished_status(o.status))
    +
    (SELECT count(*) FROM public.orders o, me
     WHERE lower(o.assigned_delivery) = me.email
       AND upper(o.status) = 'EN RUTA'
       AND public.py_day(o.assigned_at) = public.py_day(now())
       AND NOT EXISTS (SELECT 1 FROM public.delivery_day_closures c WHERE c.delivery_email = me.email AND c.day = public.py_day(now())))
  )::int;
$$;

-- ============================================
-- Fila de entregas del día del delivery (sin datos de otros clientes)
-- ============================================
CREATE OR REPLACE FUNCTION public.delivery_day_stops(p_delivery text, p_day date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'seq', o.day_seq,
    'status', o.status,
    'state', CASE
      WHEN upper(o.status) IN ('ENTREGADO', 'ENCOMIENDA ENTREGADA') THEN 'delivered'
      WHEN upper(o.status) = 'EN RUTA' THEN 'route'
      WHEN public.tracking_finished_status(o.status) THEN 'failed'
      ELSE 'pending' END,
    'city', o.city,
    'dest', (SELECT jsonb_build_object('lat', l.dest_lat, 'lng', l.dest_lng) FROM public.order_tracking_links l
             WHERE l.order_id = o.id AND l.dest_lat IS NOT NULL ORDER BY l.created_at DESC LIMIT 1)
  ) ORDER BY o.day_seq NULLS LAST), '[]'::jsonb)
  FROM public.orders o
  WHERE lower(o.assigned_delivery) = lower(p_delivery) AND public.py_day(o.assigned_at) = p_day;
$$;
REVOKE ALL ON FUNCTION public.delivery_day_stops(text, date) FROM PUBLIC, anon, authenticated;

-- ============================================
-- Link de ruta global (todas las entregas del día del delivery)
-- ============================================
CREATE TABLE IF NOT EXISTS public.delivery_route_links (
  token text PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  delivery_email text NOT NULL,
  day date NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX IF NOT EXISTS delivery_route_links_idx ON public.delivery_route_links (lower(delivery_email), day);
ALTER TABLE public.delivery_route_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_route_links FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_route_link(p_delivery_email text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text; target text; d date := public.py_day(now()); tok text;
BEGIN
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  IF me IS NULL THEN RAISE EXCEPTION 'Usuario no identificado'; END IF;
  target := lower(trim(coalesce(nullif(p_delivery_email, ''), me)));
  IF NOT (
    target = me
    OR public.has_role(auth.uid(), 'ADMIN')
    OR (public.has_role(auth.uid(), 'PROVEEDOR') AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE lower(o.assigned_delivery) = target AND public.py_day(o.assigned_at) = d
        AND (lower(coalesce(o.provider_email, '')) = me OR lower(coalesce(o.delivery_owner, '')) = me
             OR me = ANY(regexp_split_to_array(lower(coalesce(o.provider_emails_list, '')), '[,;[:space:]]+')))))
  ) THEN
    RAISE EXCEPTION 'No tenés permiso para generar la ruta de este delivery';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE lower(assigned_delivery) = target AND public.py_day(assigned_at) = d) THEN
    RAISE EXCEPTION 'El delivery no tiene pedidos asignados hoy';
  END IF;

  SELECT token INTO tok FROM public.delivery_route_links
  WHERE lower(delivery_email) = target AND day = d AND expires_at > now() ORDER BY created_at DESC LIMIT 1;
  IF tok IS NULL THEN
    INSERT INTO public.delivery_route_links(delivery_email, day, created_by) VALUES (target, d, me) RETURNING token INTO tok;
  END IF;
  RETURN tok;
END; $$;
REVOKE ALL ON FUNCTION public.create_route_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_route_link(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_route_tracking(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.delivery_route_links; finished boolean; loc public.delivery_locations; trail jsonb; stops jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO r FROM public.delivery_route_links WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  finished := r.expires_at <= now() OR EXISTS (SELECT 1 FROM public.delivery_day_closures c WHERE c.delivery_email = lower(r.delivery_email) AND c.day = r.day);
  stops := public.delivery_day_stops(r.delivery_email, r.day);
  IF NOT finished THEN
    SELECT * INTO loc FROM public.delivery_locations WHERE lower(delivery_email) = lower(r.delivery_email) ORDER BY updated_at DESC LIMIT 1;
    SELECT coalesce(jsonb_agg(jsonb_build_array(lat, lng) ORDER BY at), '[]'::jsonb) INTO trail FROM (
      SELECT lat, lng, at FROM public.delivery_location_points
      WHERE lower(delivery_email) = lower(r.delivery_email) AND public.py_day(at) = r.day
      ORDER BY at DESC LIMIT 500) t;
  END IF;
  RETURN jsonb_build_object(
    'found', true,
    'finished', finished,
    'day', r.day,
    'delivery_name', split_part(coalesce((SELECT nullif(regexp_replace(trim(name), '\s+', ' ', 'g'), '') FROM public.profiles WHERE lower(email) = lower(r.delivery_email) LIMIT 1), 'Delivery'), ' ', 1),
    -- Sin ids de pedido: sólo número del día, estado, ciudad y punto.
    'stops', (SELECT coalesce(jsonb_agg(s - 'id'), '[]'::jsonb) FROM jsonb_array_elements(stops) s),
    'location', CASE WHEN NOT finished AND loc.lat IS NOT NULL AND public.py_day(loc.updated_at) = r.day THEN jsonb_build_object('lat', loc.lat, 'lng', loc.lng, 'updated_at', loc.updated_at) END,
    'trail', coalesce(trail, '[]'::jsonb)
  );
END; $$;
REVOKE ALL ON FUNCTION public.get_route_tracking(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_route_tracking(text) TO anon, authenticated;

-- ============================================
-- Link de cada cliente: posición en la fila del día ("faltan 2 antes que vos")
-- ============================================
CREATE OR REPLACE FUNCTION public.order_queue_info(p_order_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH o AS (SELECT * FROM public.orders WHERE id = p_order_id),
  day_orders AS (
    SELECT x.id, x.day_seq, x.status FROM public.orders x, o
    WHERE lower(x.assigned_delivery) = lower(o.assigned_delivery)
      AND public.py_day(x.assigned_at) = public.py_day(o.assigned_at)
  )
  SELECT jsonb_build_object(
    'seq', (SELECT day_seq FROM o),
    'total', (SELECT count(*) FROM day_orders),
    'done', (SELECT count(*) FROM day_orders WHERE public.tracking_finished_status(status)),
    'ahead', (SELECT count(*) FROM day_orders d, o WHERE NOT public.tracking_finished_status(d.status) AND d.id <> o.id AND coalesce(d.day_seq, 0) < coalesce(o.day_seq, 0))
  );
$$;
REVOKE ALL ON FUNCTION public.order_queue_info(uuid) FROM PUBLIC, anon, authenticated;

-- get_order_tracking + fila del día
CREATE OR REPLACE FUNCTION public.get_order_tracking(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l public.order_tracking_links; o public.orders; finished boolean; loc public.delivery_locations; delivery_name text; items jsonb; trail jsonb; tracker text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO l FROM public.order_tracking_links WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO o FROM public.orders WHERE id = l.order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  tracker := lower(coalesce(l.tracker_email, l.delivery_email));

  finished := public.tracking_finished_status(o.status)
    OR l.expires_at <= now()
    OR lower(coalesce(o.assigned_delivery, '')) <> lower(l.delivery_email);

  delivery_name := split_part(coalesce((SELECT nullif(regexp_replace(trim(name), '\s+', ' ', 'g'), '') FROM public.profiles WHERE lower(email) = tracker LIMIT 1), 'Tu delivery'), ' ', 1);

  SELECT coalesce(jsonb_agg(jsonb_build_object('title', e->>'title', 'qty', coalesce(e->>'qty', e->>'quantity', '1'))), '[]'::jsonb)
  INTO items FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.items_json) = 'array' THEN o.items_json ELSE '[]'::jsonb END) e;

  IF NOT finished THEN
    SELECT * INTO loc FROM public.delivery_locations WHERE lower(delivery_email) = tracker ORDER BY updated_at DESC LIMIT 1;
    SELECT coalesce(jsonb_agg(jsonb_build_array(lat, lng) ORDER BY at), '[]'::jsonb) INTO trail FROM (
      SELECT lat, lng, at FROM public.delivery_location_points
      WHERE lower(delivery_email) = tracker AND at >= l.created_at
      ORDER BY at DESC LIMIT 400
    ) t;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'finished', finished,
    'expired', l.expires_at <= now(),
    'status', o.status,
    'order_number', o.order_number,
    'customer', split_part(coalesce(o.customer_name, ''), ' ', 1),
    'city', o.city,
    'address', trim(concat_ws(' - ', nullif(o.street, ''), nullif(o.district, ''))),
    'total_gs', o.total_gs,
    'items', items,
    'delivery_name', delivery_name,
    'delivered_at', o.delivered_at,
    'queue', CASE WHEN finished THEN NULL ELSE public.order_queue_info(o.id) END,
    'dest', CASE WHEN l.dest_lat IS NOT NULL THEN jsonb_build_object('lat', l.dest_lat, 'lng', l.dest_lng) END,
    'location', CASE WHEN NOT finished AND loc.lat IS NOT NULL AND loc.updated_at >= l.created_at - interval '15 minutes' THEN jsonb_build_object('lat', loc.lat, 'lng', loc.lng, 'updated_at', loc.updated_at) END,
    'trail', CASE WHEN finished THEN '[]'::jsonb ELSE trail END
  );
END; $$;

-- ============================================
-- Modo repartidor dentro del link: "Estoy en camino"
-- ============================================
CREATE OR REPLACE FUNCTION public.tracking_driver_info(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'is_tracker', lower(coalesce(l.tracker_email, l.delivery_email)) = lower(p.email),
    'status', o.status,
    'order_number', o.order_number
  )
  FROM public.order_tracking_links l
  JOIN public.orders o ON o.id = l.order_id
  JOIN public.profiles p ON p.user_id = auth.uid()
  WHERE l.token = p_token;
$$;
REVOKE ALL ON FUNCTION public.tracking_driver_info(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_driver_info(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.tracking_start_route(p_token text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l public.order_tracking_links; o public.orders; me record;
BEGIN
  SELECT email, role INTO me FROM public.profiles WHERE user_id = auth.uid();
  SELECT * INTO l FROM public.order_tracking_links WHERE token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link no encontrado'; END IF;
  IF lower(coalesce(l.tracker_email, l.delivery_email)) <> lower(coalesce(me.email, '')) THEN
    RAISE EXCEPTION 'Sólo quien lleva el pedido puede marcarlo en camino';
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = l.order_id FOR UPDATE;
  IF public.tracking_finished_status(o.status) THEN RAISE EXCEPTION 'El pedido ya está %', o.status; END IF;
  IF upper(coalesce(o.status, '')) = 'EN RUTA' THEN RETURN o.status; END IF;

  -- Primero el historial (aviso "X reportó EN RUTA"), después el estado.
  INSERT INTO public.order_status_history(order_id, previous_status, new_status, changed_by_email, changed_by_role, message)
  VALUES (o.id, o.status, 'EN RUTA', lower(me.email), upper(coalesce(me.role, 'DELIVERY')), '🛵 Estoy en camino (desde el link de seguimiento)');
  UPDATE public.orders SET status = 'EN RUTA', updated_at = now() WHERE id = o.id;
  RETURN 'EN RUTA';
END; $$;
REVOKE ALL ON FUNCTION public.tracking_start_route(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_start_route(text) TO authenticated;

-- ============================================
-- MAPA EN VIVO (admin todo; proveedor los deliveries con pedidos suyos hoy)
-- Se muestran hasta que el delivery finaliza su día.
-- ============================================
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
