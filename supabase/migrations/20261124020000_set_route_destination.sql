-- 📍 El delivery (o admin / proveedor) carga o cambia la ubicación del cliente desde «Mi ruta».
-- Si el pedido todavía no tiene link de seguimiento se crea uno con esa ubicación.
CREATE OR REPLACE FUNCTION public.set_route_destination(p_order_id uuid, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  n integer;
  o public.orders;
BEGIN
  IF NOT public.can_manage_order_tracking(p_order_id) THEN
    RAISE EXCEPTION 'No tenés permiso para cambiar la ubicación de este pedido';
  END IF;
  IF (p_lat IS NULL) <> (p_lng IS NULL) THEN RAISE EXCEPTION 'Ubicación incompleta'; END IF;
  IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN -28.5 AND -18.5 OR p_lng NOT BETWEEN -63.5 AND -53.5) THEN
    RAISE EXCEPTION 'La ubicación tiene que estar en Paraguay';
  END IF;
  UPDATE public.order_tracking_links SET dest_lat = p_lat, dest_lng = p_lng WHERE order_id = p_order_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 AND p_lat IS NOT NULL THEN
    SELECT * INTO o FROM public.orders WHERE id = p_order_id;
    INSERT INTO public.order_tracking_links (order_id, delivery_email, dest_lat, dest_lng, created_by)
    VALUES (p_order_id, lower(coalesce(nullif(trim(o.assigned_delivery), ''), public.current_profile_email())), p_lat, p_lng, public.current_profile_email());
    n := 1;
  END IF;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.set_route_destination(uuid, double precision, double precision) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_route_destination(uuid, double precision, double precision) TO authenticated;
