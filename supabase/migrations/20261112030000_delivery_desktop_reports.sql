-- El delivery puede reportar desde una PC / notebook sin ubicación: la app avisa
-- que es una computadora y eso vale como «ubicación al día» por 15 minutos.
CREATE TABLE IF NOT EXISTS public.delivery_desktop_reports (
  delivery_email text PRIMARY KEY,
  user_agent text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.delivery_desktop_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_desktop_reports_admin_read ON public.delivery_desktop_reports;
CREATE POLICY delivery_desktop_reports_admin_read ON public.delivery_desktop_reports FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'));
REVOKE INSERT, UPDATE, DELETE ON public.delivery_desktop_reports FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.report_delivery_desktop(p_user_agent text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'DELIVERY') THEN RETURN false; END IF;
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  IF me IS NULL THEN RETURN false; END IF;
  INSERT INTO public.delivery_desktop_reports (delivery_email, user_agent, updated_at)
  VALUES (me, left(p_user_agent, 300), now())
  ON CONFLICT (delivery_email) DO UPDATE SET user_agent = excluded.user_agent, updated_at = now();
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.report_delivery_desktop(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.report_delivery_desktop(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_location_fresh(p_email text, p_minutes integer DEFAULT 15)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_locations
    WHERE lower(delivery_email) = lower(coalesce(p_email, ''))
      AND updated_at > now() - make_interval(mins => p_minutes)
  ) OR EXISTS (
    SELECT 1 FROM public.delivery_desktop_reports
    WHERE delivery_email = lower(coalesce(p_email, ''))
      AND updated_at > now() - make_interval(mins => p_minutes)
  );
$function$;
