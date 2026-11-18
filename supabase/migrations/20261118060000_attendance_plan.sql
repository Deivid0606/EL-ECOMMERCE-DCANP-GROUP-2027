-- 🕒 Asistencia: al marcar entrada el delivery dice cómo viene y a qué hora llega aprox.
--   EN_CAMINO: «Ya estoy en camino»  ·  PENDIENTES: «Sigo con mis pendientes y después paso»
ALTER TABLE public.delivery_attendance ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE public.delivery_attendance ADD COLUMN IF NOT EXISTS eta_at timestamptz;
ALTER TABLE public.delivery_attendance ADD COLUMN IF NOT EXISTS plan_updated_at timestamptz;
DO $$ BEGIN
  ALTER TABLE public.delivery_attendance ADD CONSTRAINT delivery_attendance_plan_check CHECK (plan IN ('EN_CAMINO', 'PENDIENTES'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.attendance_set_plan(p_plan text, p_eta text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text; today date := public.py_day(now()); r public.delivery_attendance; v_eta timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'DELIVERY') THEN RAISE EXCEPTION 'Sólo un delivery marca asistencia'; END IF;
  IF p_plan NOT IN ('EN_CAMINO', 'PENDIENTES') THEN RAISE EXCEPTION 'Opción no válida'; END IF;
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  SELECT * INTO r FROM public.delivery_attendance
  WHERE lower(delivery_email) = me AND day = today AND status = 'TRABAJANDO' AND ended_at IS NULL
  ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Primero marcá tu entrada'; END IF;
  IF coalesce(p_eta, '') ~ '^\d{1,2}:\d{2}$' THEN
    v_eta := (today::text || ' ' || p_eta || ':00-03')::timestamptz;
  END IF;
  UPDATE public.delivery_attendance SET plan = p_plan, eta_at = v_eta, plan_updated_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.attendance_set_plan(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.attendance_set_plan(text, text) TO authenticated;
