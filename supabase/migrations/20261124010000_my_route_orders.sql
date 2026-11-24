-- 🗺️ «Mi ruta» del delivery: sus pedidos para hoy (abiertos + cerrados hoy) con la
-- ubicación del cliente si ya se cargó en el seguimiento.
CREATE OR REPLACE FUNCTION public.my_route_orders()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  me text := public.current_profile_email();
  today date := (now() AT TIME ZONE 'America/Asuncion')::date;
  res jsonb;
BEGIN
  IF me IS NULL OR me = '' THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'assigned_at'), '[]'::jsonb) INTO res FROM (
    SELECT jsonb_build_object(
      'id', o.id, 'order_number', o.order_number, 'customer_name', o.customer_name, 'phone', o.phone,
      'city', o.city, 'departamento', o.departamento, 'street', o.street, 'district', o.district, 'obs', o.obs,
      'items_json', o.items_json, 'total_gs', o.total_gs, 'delivery_fee_gs', o.delivery_fee_gs,
      'status', o.status, 'status2', o.status2, 'assigned_delivery', o.assigned_delivery, 'assigned_at', o.assigned_at,
      'delivered_at', o.delivered_at, 'updated_at', o.updated_at, 'rescheduled_for', o.rescheduled_for,
      'contacted', o.contacted, 'shipping_type', o.shipping_type, 'payment_status', o.payment_status,
      'provider_email', o.provider_email, 'provider_emails_list', o.provider_emails_list,
      'dest', (SELECT jsonb_build_object('lat', t.dest_lat, 'lng', t.dest_lng) FROM public.order_tracking_links t
               WHERE t.order_id = o.id AND t.dest_lat IS NOT NULL ORDER BY t.created_at DESC LIMIT 1)
    ) AS x
    FROM public.orders o
    WHERE lower(trim(coalesce(o.assigned_delivery, ''))) = me
      AND (
        (upper(coalesce(o.status, 'PENDIENTE')) IN ('PENDIENTE', 'EN RUTA', 'NO CONTESTA')
          AND o.assigned_at > now() - interval '30 days')
        OR (upper(o.status) = 'REAGENDADO' AND coalesce(o.rescheduled_for::date, today) <= today
          AND o.assigned_at > now() - interval '30 days')
        OR (upper(coalesce(o.status, '')) NOT IN ('PENDIENTE', 'EN RUTA', 'NO CONTESTA', 'REAGENDADO')
          AND (coalesce(o.delivered_at, o.updated_at) AT TIME ZONE 'America/Asuncion')::date = today)
      )
    LIMIT 300
  ) s;
  RETURN res;
END $function$;
REVOKE ALL ON FUNCTION public.my_route_orders() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_route_orders() TO authenticated;

-- 📍 Ubicación aproximada para el mapa de «Mi ruta»: primero la calle (Nominatim, vía
-- geocode_place_py), si no se encuentra el centro de la ciudad. Se guarda en caché.
CREATE TABLE IF NOT EXISTS public.geo_cache (
  q text PRIMARY KEY,
  lat double precision,
  lng double precision,
  level text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.geo_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.geo_cache FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.route_geocode(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $function$
DECLARE
  o public.orders;
  street_q text;
  city_q text;
  c public.geo_cache;
  g jsonb;
  res record;
  row0 jsonb;
BEGIN
  IF NOT public.can_manage_order_tracking(p_order_id) THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF o.id IS NULL OR nullif(trim(coalesce(o.city, '')), '') IS NULL THEN RETURN NULL; END IF;
  city_q := lower(trim(o.city)) || ', ' || lower(trim(coalesce(nullif(o.departamento, ''), 'paraguay')));
  street_q := CASE WHEN length(trim(coalesce(o.street, ''))) >= 6 THEN lower(trim(o.street)) || ', ' || lower(trim(o.city)) END;

  -- 1) La calle (en caché o buscándola).
  IF street_q IS NOT NULL THEN
    SELECT * INTO c FROM public.geo_cache WHERE q = 's:' || street_q;
    IF c.q IS NULL THEN
      BEGIN
        g := public.geocode_place_py(o.street || ', ' || o.city);
      EXCEPTION WHEN OTHERS THEN g := NULL;
      END;
      INSERT INTO public.geo_cache (q, lat, lng, level)
      VALUES ('s:' || street_q, (g->>'lat')::double precision, (g->>'lng')::double precision, CASE WHEN g IS NULL THEN 'none' ELSE 'street' END)
      ON CONFLICT (q) DO NOTHING
      RETURNING * INTO c;
    END IF;
    IF c.lat IS NOT NULL THEN RETURN jsonb_build_object('lat', c.lat, 'lng', c.lng, 'level', 'street'); END IF;
  END IF;

  -- 2) El centro de la ciudad.
  c := NULL;
  SELECT * INTO c FROM public.geo_cache WHERE q = 'c:' || city_q;
  IF c.q IS NULL THEN
    BEGIN
      SELECT * INTO res FROM http((
        'GET',
        'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=py&q=' || replace(urlencode(o.city || ', ' || coalesce(nullif(o.departamento, ''), '') || ', Paraguay'), '+', '%20'),
        ARRAY[http_header('User-Agent', 'DCANP-Group/1.0 (mapa de entregas)'), http_header('Accept-Language', 'es')],
        NULL, NULL)::http_request);
      row0 := CASE WHEN res.status = 200 THEN (res.content::jsonb) -> 0 END;
    EXCEPTION WHEN OTHERS THEN row0 := NULL;
    END;
    INSERT INTO public.geo_cache (q, lat, lng, level)
    VALUES ('c:' || city_q, (row0->>'lat')::double precision, (row0->>'lon')::double precision, CASE WHEN row0 IS NULL THEN 'none' ELSE 'city' END)
    ON CONFLICT (q) DO NOTHING
    RETURNING * INTO c;
  END IF;
  IF c.lat IS NOT NULL AND c.lat BETWEEN -28.5 AND -18.5 AND c.lng BETWEEN -63.5 AND -53.5 THEN
    RETURN jsonb_build_object('lat', c.lat, 'lng', c.lng, 'level', 'city');
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.route_geocode(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.route_geocode(uuid) TO authenticated;
