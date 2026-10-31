-- Link de seguimiento en vivo para el cliente (🛵 + detalle + llegada estimada).
--
-- * El delivery, el proveedor o el admin generan el link de un pedido asignado.
-- * Mientras el link está activo, la app del delivery envía su ubicación
--   (report_delivery_location) y se guarda el recorrido.
-- * La página pública (?seguimiento=TOKEN) usa get_order_tracking, que sólo
--   devuelve datos del pedido y deja de mostrar la ubicación al terminar
--   (entregado, cancelado, devuelto) o a las 24 h.

CREATE TABLE IF NOT EXISTS public.order_tracking_links (
  token text PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  delivery_email text NOT NULL,
  dest_lat double precision,
  dest_lng double precision,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX IF NOT EXISTS order_tracking_links_delivery_idx ON public.order_tracking_links (lower(delivery_email), expires_at);
CREATE INDEX IF NOT EXISTS order_tracking_links_order_idx ON public.order_tracking_links (order_id);
ALTER TABLE public.order_tracking_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_tracking_links FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.delivery_location_points (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_email text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy double precision,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_location_points_idx ON public.delivery_location_points (lower(delivery_email), at);
ALTER TABLE public.delivery_location_points ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_location_points FROM anon, authenticated;

-- Estados en los que el seguimiento termina.
CREATE OR REPLACE FUNCTION public.tracking_finished_status(s text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(trim(coalesce(s, ''))) IN (
    'ENTREGADO', 'ENCOMIENDA ENTREGADA', 'CANCELADO', 'CANCELÓ POR WHATSAPP', 'NO DESEA',
    'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'DEVUELTO A DEPÓSITO'
  );
$$;

-- Generar (o reutilizar) el link de un pedido.
CREATE OR REPLACE FUNCTION public.create_tracking_link(p_order_id uuid, p_dest_lat double precision DEFAULT NULL, p_dest_lng double precision DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text; o public.orders; tok text;
BEGIN
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  IF me IS NULL THEN RAISE EXCEPTION 'Usuario no identificado'; END IF;
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF NOT (
    public.has_role(auth.uid(), 'ADMIN')
    OR lower(coalesce(o.assigned_delivery, '')) = me
    OR lower(coalesce(o.delivery_owner, '')) = me
    OR (public.has_role(auth.uid(), 'PROVEEDOR') AND (
         lower(coalesce(o.provider_email, '')) = me
         OR me = ANY(regexp_split_to_array(lower(coalesce(o.provider_emails_list, '')), '[,;[:space:]]+'))))
  ) THEN
    RAISE EXCEPTION 'No tenés permiso para generar el seguimiento de este pedido';
  END IF;
  IF coalesce(trim(o.assigned_delivery), '') = '' THEN RAISE EXCEPTION 'Asigná un delivery al pedido antes de generar el link'; END IF;
  IF public.tracking_finished_status(o.status) THEN RAISE EXCEPTION 'El pedido ya está %', o.status; END IF;
  IF p_dest_lat IS NOT NULL AND (p_dest_lat NOT BETWEEN -90 AND 90 OR p_dest_lng NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Ubicación del cliente inválida';
  END IF;

  SELECT token INTO tok FROM public.order_tracking_links
  WHERE order_id = o.id AND lower(delivery_email) = lower(o.assigned_delivery) AND expires_at > now()
  ORDER BY created_at DESC LIMIT 1;

  IF tok IS NULL THEN
    INSERT INTO public.order_tracking_links(order_id, delivery_email, dest_lat, dest_lng, created_by)
    VALUES (o.id, lower(o.assigned_delivery), p_dest_lat, p_dest_lng, me)
    RETURNING token INTO tok;
  ELSE
    UPDATE public.order_tracking_links
    SET dest_lat = coalesce(p_dest_lat, dest_lat), dest_lng = coalesce(p_dest_lng, dest_lng), expires_at = now() + interval '24 hours'
    WHERE token = tok;
  END IF;
  RETURN tok;
END; $$;
REVOKE ALL ON FUNCTION public.create_tracking_link(uuid, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tracking_link(uuid, double precision, double precision) TO authenticated;

-- ¿El delivery tiene links activos? (la app sólo comparte ubicación en ese caso)
CREATE OR REPLACE FUNCTION public.my_active_tracking_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM public.order_tracking_links l
  JOIN public.orders o ON o.id = l.order_id
  WHERE lower(l.delivery_email) = lower((SELECT email FROM public.profiles WHERE user_id = auth.uid()))
    AND l.expires_at > now()
    AND lower(coalesce(o.assigned_delivery, '')) = lower(l.delivery_email)
    AND NOT public.tracking_finished_status(o.status);
$$;
REVOKE ALL ON FUNCTION public.my_active_tracking_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_active_tracking_count() TO authenticated;

-- Ubicación enviada por la app del delivery.
CREATE OR REPLACE FUNCTION public.report_delivery_location(p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text; active_n integer;
BEGIN
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  IF me IS NULL THEN RAISE EXCEPTION 'Usuario no identificado'; END IF;
  IF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Ubicación inválida'; END IF;

  UPDATE public.delivery_locations SET lat = p_lat, lng = p_lng, updated_at = now() WHERE lower(delivery_email) = me;
  IF NOT FOUND THEN
    INSERT INTO public.delivery_locations(delivery_email, lat, lng, updated_at) VALUES (me, p_lat, p_lng, now());
  END IF;

  active_n := public.my_active_tracking_count();
  IF active_n > 0 THEN
    INSERT INTO public.delivery_location_points(delivery_email, lat, lng, accuracy) VALUES (me, p_lat, p_lng, p_accuracy);
  END IF;
  RETURN active_n;
END; $$;
REVOKE ALL ON FUNCTION public.report_delivery_location(double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_delivery_location(double precision, double precision, double precision) TO authenticated;

-- Página pública del cliente.
CREATE OR REPLACE FUNCTION public.get_order_tracking(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l public.order_tracking_links; o public.orders; finished boolean; loc public.delivery_locations; delivery_name text; items jsonb; trail jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO l FROM public.order_tracking_links WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO o FROM public.orders WHERE id = l.order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  finished := public.tracking_finished_status(o.status)
    OR l.expires_at <= now()
    OR lower(coalesce(o.assigned_delivery, '')) <> lower(l.delivery_email);

  delivery_name := split_part(coalesce((SELECT nullif(regexp_replace(trim(name), '\s+', ' ', 'g'), '') FROM public.profiles WHERE lower(email) = lower(l.delivery_email) LIMIT 1), 'Tu delivery'), ' ', 1);

  SELECT coalesce(jsonb_agg(jsonb_build_object('title', e->>'title', 'qty', coalesce(e->>'qty', e->>'quantity', '1'))), '[]'::jsonb)
  INTO items FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.items_json) = 'array' THEN o.items_json ELSE '[]'::jsonb END) e;

  IF NOT finished THEN
    SELECT * INTO loc FROM public.delivery_locations WHERE lower(delivery_email) = lower(l.delivery_email) ORDER BY updated_at DESC LIMIT 1;
    SELECT coalesce(jsonb_agg(jsonb_build_array(lat, lng) ORDER BY at), '[]'::jsonb) INTO trail FROM (
      SELECT lat, lng, at FROM public.delivery_location_points
      WHERE lower(delivery_email) = lower(l.delivery_email) AND at >= l.created_at
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
    'dest', CASE WHEN l.dest_lat IS NOT NULL THEN jsonb_build_object('lat', l.dest_lat, 'lng', l.dest_lng) END,
    'location', CASE WHEN NOT finished AND loc.lat IS NOT NULL THEN jsonb_build_object('lat', loc.lat, 'lng', loc.lng, 'updated_at', loc.updated_at) END,
    'trail', CASE WHEN finished THEN '[]'::jsonb ELSE trail END
  );
END; $$;
REVOKE ALL ON FUNCTION public.get_order_tracking(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_tracking(text) TO anon, authenticated;

-- Limpieza: el recorrido se guarda 7 días.
CREATE OR REPLACE FUNCTION public.cleanup_location_points() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM public.delivery_location_points WHERE at < now() - interval '7 days';
  DELETE FROM public.order_tracking_links WHERE expires_at < now() - interval '30 days';
$$;
DO $$ BEGIN
  PERFORM cron.unschedule('cleanup-location-points') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-location-points');
  PERFORM cron.schedule('cleanup-location-points', '17 4 * * *', 'SELECT public.cleanup_location_points()');
END $$;

-- Avisar al delivery (push) que abra la app para compartir su ubicación.
-- (Aplicado en producción como migración tracking_link_notify_delivery.)
CREATE OR REPLACE FUNCTION public.tracking_link_notify() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid; o public.orders;
BEGIN
  BEGIN
    SELECT * INTO o FROM public.orders WHERE id = NEW.order_id;
    FOR uid IN SELECT public.push_users(NEW.delivery_email) LOOP
      PERFORM public.push_add(uid, 'track:' || NEW.token,
        '🛵 Compartí tu ubicación con el cliente',
        left('Pedido ' || coalesce(o.order_number::text, '') || ' · ' || coalesce(o.customer_name, '') || ' sigue tu entrega. Abrí la app DCANP y aceptá la ubicación.', 300),
        '/?go=orders');
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tracking_link_notify: %', SQLERRM;
  END;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tracking_link_notify ON public.order_tracking_links;
CREATE TRIGGER tracking_link_notify AFTER INSERT ON public.order_tracking_links FOR EACH ROW EXECUTE FUNCTION public.tracking_link_notify();

-- Busca un lugar / dirección de Paraguay en OpenStreetMap, para links de Google
-- Maps que traen nombre y dirección pero no coordenadas (lugares compartidos
-- desde el iPhone). Las funciones Edge no pueden consultar Nominatim, la base sí.
-- (Aplicado en producción como migraciones geocode_place_py / geocode_place_py_v2.)
CREATE OR REPLACE FUNCTION public.geocode_place_py(p_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  clean text;
  parts text[];
  attempt text;
  attempts text[] := '{}';
  candidate text;
  res record;
  row0 jsonb;
  lat double precision;
  lng double precision;
  n integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  clean := regexp_replace(coalesce(p_text, ''), '\m[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\M', ' ', 'gi');
  clean := trim(both ' ,' from regexp_replace(clean, '\s+', ' ', 'g'));
  IF length(clean) < 4 THEN RETURN NULL; END IF;
  parts := array(SELECT trim(x) FROM unnest(string_to_array(clean, ',')) x WHERE trim(x) <> '');

  -- De más completo a menos: texto entero, sin el nombre del lugar, nombre + ciudad.
  FOREACH candidate IN ARRAY ARRAY[clean, array_to_string(parts[2:], ', '), array_to_string(parts[1:2], ', ')] LOOP
    IF length(coalesce(candidate, '')) > 3 AND NOT candidate = ANY(attempts) THEN
      attempts := attempts || candidate;
    END IF;
  END LOOP;

  PERFORM http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
  FOREACH attempt IN ARRAY attempts LOOP
    IF n > 0 THEN PERFORM pg_sleep(1.1); END IF;  -- Nominatim: 1 consulta por segundo.
    n := n + 1;
    SELECT * INTO res FROM http((
      'GET',
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=py&q=' || replace(urlencode(attempt), '+', '%20'),
      ARRAY[http_header('User-Agent', 'DCANP-Group/1.0 (seguimiento de pedidos)'), http_header('Accept-Language', 'es')],
      NULL, NULL)::http_request);
    IF res.status = 200 THEN
      row0 := (res.content::jsonb) -> 0;
      -- Una ciudad o departamento entero no sirve como destino.
      IF row0 IS NOT NULL AND coalesce(row0->>'addresstype', row0->>'type', '') NOT IN ('city', 'town', 'village', 'municipality', 'county', 'state', 'country', 'administrative', 'region') THEN
        lat := (row0->>'lat')::double precision;
        lng := (row0->>'lon')::double precision;
        IF lat BETWEEN -28.5 AND -18.5 AND lng BETWEEN -63.5 AND -53.5 THEN
          RETURN jsonb_build_object('lat', lat, 'lng', lng, 'approx', attempt <> clean, 'name', row0->>'display_name');
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.geocode_place_py(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.geocode_place_py(text) TO authenticated;
