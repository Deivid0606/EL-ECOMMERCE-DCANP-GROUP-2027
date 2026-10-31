-- El delivery comparte su ubicación durante toda la jornada: con cualquier pedido
-- del día todavía sin terminar (no sólo EN RUTA), hasta que toca "Finalicé mi día".
CREATE OR REPLACE FUNCTION public.my_active_tracking_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
       AND public.py_day(o.assigned_at) = public.py_day(now())
       AND NOT EXISTS (SELECT 1 FROM public.delivery_day_closures c WHERE c.delivery_email = me.email AND c.day = public.py_day(now())))
  )::int;
$$;
REVOKE ALL ON FUNCTION public.my_active_tracking_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_active_tracking_count() TO authenticated;
