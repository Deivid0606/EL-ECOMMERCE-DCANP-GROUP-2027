-- 🕒 Asistencia del delivery: entrada / salida con cronómetro o «no asistiré hoy».
CREATE TABLE IF NOT EXISTS public.delivery_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_email text NOT NULL,
  day date NOT NULL,
  status text NOT NULL CHECK (status IN ('TRABAJANDO', 'FINALIZADO', 'NO_ASISTE')),
  started_at timestamptz,
  ended_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_attendance_day_idx ON public.delivery_attendance (day, lower(delivery_email));
ALTER TABLE public.delivery_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_attendance_read ON public.delivery_attendance;
CREATE POLICY delivery_attendance_read ON public.delivery_attendance FOR SELECT TO authenticated USING (
  lower(delivery_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  OR public.has_role(auth.uid(), 'ADMIN')
  OR public.has_role(auth.uid(), 'PROVEEDOR')
);
REVOKE INSERT, UPDATE, DELETE ON public.delivery_attendance FROM anon, authenticated;

-- Deliverys favoritos de cada admin / proveedor (Asistencia › Configuración).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS favorite_deliveries text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.attendance_action(p_action text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text; today date := public.py_day(now()); open_row public.delivery_attendance;
BEGIN
  IF NOT public.has_role(auth.uid(), 'DELIVERY') THEN RAISE EXCEPTION 'Sólo un delivery marca asistencia'; END IF;
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  IF me IS NULL THEN RAISE EXCEPTION 'Usuario no identificado'; END IF;
  SELECT * INTO open_row FROM public.delivery_attendance
  WHERE lower(delivery_email) = me AND status = 'TRABAJANDO' AND ended_at IS NULL
  ORDER BY started_at DESC LIMIT 1 FOR UPDATE;

  IF p_action = 'start' THEN
    IF FOUND THEN RAISE EXCEPTION 'Ya marcaste tu entrada: el cronómetro está corriendo'; END IF;
    DELETE FROM public.delivery_attendance WHERE lower(delivery_email) = me AND day = today AND status = 'NO_ASISTE';
    INSERT INTO public.delivery_attendance(delivery_email, day, status, started_at) VALUES (me, today, 'TRABAJANDO', now());
  ELSIF p_action = 'stop' THEN
    IF NOT FOUND THEN RAISE EXCEPTION 'No tenés una jornada iniciada'; END IF;
    UPDATE public.delivery_attendance SET status = 'FINALIZADO', ended_at = now() WHERE id = open_row.id;
  ELSIF p_action = 'absent' THEN
    IF FOUND THEN RAISE EXCEPTION 'Tenés la jornada iniciada: primero marcá la salida'; END IF;
    IF EXISTS (SELECT 1 FROM public.delivery_attendance WHERE lower(delivery_email) = me AND day = today AND status <> 'NO_ASISTE') THEN
      RAISE EXCEPTION 'Hoy ya marcaste asistencia';
    END IF;
    DELETE FROM public.delivery_attendance WHERE lower(delivery_email) = me AND day = today AND status = 'NO_ASISTE';
    INSERT INTO public.delivery_attendance(delivery_email, day, status, note) VALUES (me, today, 'NO_ASISTE', nullif(trim(p_note), ''));
  ELSIF p_action = 'undo_absent' THEN
    DELETE FROM public.delivery_attendance WHERE lower(delivery_email) = me AND day = today AND status = 'NO_ASISTE';
  ELSE
    RAISE EXCEPTION 'Acción no válida';
  END IF;
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.attendance_action(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.attendance_action(text, text) TO authenticated;
