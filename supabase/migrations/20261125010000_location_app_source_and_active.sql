-- 📱 Ubicación: se guarda si viene de la app de Android o del navegador (el Mapa lo muestra),
-- y la jornada cuenta también los pedidos abiertos de días anteriores (no sólo los asignados hoy).
ALTER TABLE public.delivery_locations ADD COLUMN IF NOT EXISTS source text;

DROP FUNCTION IF EXISTS public.report_delivery_location(double precision, double precision, double precision);
CREATE OR REPLACE FUNCTION public.report_delivery_location(p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL, p_source text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE me text; active_n integer; src text := CASE WHEN lower(coalesce(p_source, '')) IN ('app', 'web') THEN lower(p_source) END;
BEGIN
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  IF me IS NULL THEN RAISE EXCEPTION 'Usuario no identificado'; END IF;
  IF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Ubicación inválida'; END IF;

  UPDATE public.delivery_locations SET lat = p_lat, lng = p_lng, updated_at = now(), source = coalesce(src, source) WHERE lower(delivery_email) = me;
  IF NOT FOUND THEN
    INSERT INTO public.delivery_locations(delivery_email, lat, lng, updated_at, source) VALUES (me, p_lat, p_lng, now(), src);
  END IF;

  active_n := public.my_active_tracking_count();
  IF active_n > 0 THEN
    INSERT INTO public.delivery_location_points(delivery_email, lat, lng, accuracy) VALUES (me, p_lat, p_lng, p_accuracy);
  END IF;
  RETURN active_n;
END; $function$;
REVOKE ALL ON FUNCTION public.report_delivery_location(double precision, double precision, double precision, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_delivery_location(double precision, double precision, double precision, text) TO authenticated;

-- Jornada activa: pedidos sin terminar asignados en los últimos 30 días (los reagendados sólo
-- cuando ya les toca), hasta que el delivery toca «Finalicé mi día».
CREATE OR REPLACE FUNCTION public.my_active_tracking_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  WITH me AS (SELECT lower(email) AS email FROM public.profiles WHERE user_id = auth.uid())
  SELECT (
    (SELECT count(*) FROM public.order_tracking_links l
     JOIN public.orders o ON o.id = l.order_id, me
     WHERE lower(coalesce(l.tracker_email, l.delivery_email)) = me.email
       AND l.expires_at > now()
       AND lower(coalesce(o.assigned_delivery, '')) = lower(l.delivery_email)
       AND NOT public.tracking_finished_status(o.status)
       AND lower(coalesce(o.assigned_delivery, '')) <> me.email)
    +
    (SELECT count(*) FROM public.orders o, me
     WHERE lower(o.assigned_delivery) = me.email
       AND NOT public.tracking_finished_status(o.status)
       AND o.assigned_at > now() - interval '30 days'
       AND (upper(coalesce(o.status, '')) <> 'REAGENDADO' OR coalesce(o.rescheduled_for::date, public.py_day(now())) <= public.py_day(now()))
       AND NOT EXISTS (SELECT 1 FROM public.delivery_day_closures c WHERE c.delivery_email = me.email AND c.day = public.py_day(now())))
  )::int;
$function$;

-- Mapa en vivo: la ubicación dice si viene de la app.
DO $m$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.live_map_data'::regproc);
  IF position('''source'', dl.source' IN def) > 0 THEN RETURN; END IF;
  IF position('''updated_at'', dl.updated_at)' IN def) = 0 THEN RAISE EXCEPTION 'patrón no encontrado'; END IF;
  EXECUTE replace(def, '''updated_at'', dl.updated_at)', '''updated_at'', dl.updated_at, ''source'', dl.source)');
END $m$;
