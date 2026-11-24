-- 📅 «Mi ruta» por fecha: los pedidos del delivery en un rango de días (o todas las fechas).
-- Día de cada pedido: el de la entrega / cierre si ya terminó, si no el de la asignación.
CREATE OR REPLACE FUNCTION public.my_route_history(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  me text := public.current_profile_email();
  res jsonb;
BEGIN
  IF me IS NULL OR me = '' THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'day' DESC, x->>'assigned_at'), '[]'::jsonb) INTO res FROM (
    SELECT jsonb_build_object(
      'id', o.id, 'order_number', o.order_number, 'customer_name', o.customer_name, 'phone', o.phone,
      'city', o.city, 'departamento', o.departamento, 'street', o.street, 'district', o.district, 'obs', o.obs,
      'items_json', o.items_json, 'total_gs', o.total_gs, 'delivery_fee_gs', o.delivery_fee_gs,
      'status', o.status, 'status2', o.status2, 'assigned_delivery', o.assigned_delivery, 'assigned_at', o.assigned_at,
      'delivered_at', o.delivered_at, 'updated_at', o.updated_at, 'rescheduled_for', o.rescheduled_for,
      'contacted', o.contacted, 'shipping_type', o.shipping_type, 'payment_status', o.payment_status,
      'provider_email', o.provider_email, 'provider_emails_list', o.provider_emails_list,
      'day', d.day,
      'dest', (SELECT jsonb_build_object('lat', t.dest_lat, 'lng', t.dest_lng) FROM public.order_tracking_links t
               WHERE t.order_id = o.id AND t.dest_lat IS NOT NULL ORDER BY t.created_at DESC LIMIT 1)
    ) AS x
    FROM public.orders o
    CROSS JOIN LATERAL (
      SELECT ((CASE WHEN upper(coalesce(o.status, 'PENDIENTE')) IN ('PENDIENTE', 'EN RUTA', 'NO CONTESTA', 'REAGENDADO')
                    THEN o.assigned_at ELSE coalesce(o.delivered_at, o.updated_at, o.assigned_at) END)
              AT TIME ZONE 'America/Asuncion')::date AS day
    ) d
    WHERE lower(trim(coalesce(o.assigned_delivery, ''))) = me
      AND o.assigned_at IS NOT NULL
      AND d.day BETWEEN coalesce(p_from, '2020-01-01'::date) AND coalesce(p_to, (now() AT TIME ZONE 'America/Asuncion')::date)
    ORDER BY d.day DESC
    LIMIT 2000
  ) s;
  RETURN res;
END $function$;
REVOKE ALL ON FUNCTION public.my_route_history(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_route_history(date, date) TO authenticated;
