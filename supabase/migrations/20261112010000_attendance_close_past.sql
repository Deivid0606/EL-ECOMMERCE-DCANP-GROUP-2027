-- 🕒 Asistencia: cerrar una jornada de un día anterior que quedó abierta (se olvidó la salida).
CREATE OR REPLACE FUNCTION public.attendance_close_past(p_end_time text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text; today date := public.py_day(now()); r public.delivery_attendance; v_end timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'DELIVERY') THEN RAISE EXCEPTION 'Sólo un delivery marca asistencia'; END IF;
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  SELECT * INTO r FROM public.delivery_attendance
  WHERE lower(delivery_email) = me AND status = 'TRABAJANDO' AND ended_at IS NULL AND day < today
  ORDER BY started_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No tenés jornadas de días anteriores abiertas'; END IF;
  IF coalesce(p_end_time, '') !~ '^\d{1,2}:\d{2}$' THEN RAISE EXCEPTION 'Elegí la hora en que terminaste'; END IF;
  v_end := (r.day::text || ' ' || p_end_time || ':00-03')::timestamptz;
  IF v_end <= r.started_at THEN
    RAISE EXCEPTION 'La hora de salida tiene que ser después de la entrada (%)', to_char(r.started_at AT TIME ZONE 'America/Asuncion', 'HH24:MI');
  END IF;
  UPDATE public.delivery_attendance SET status = 'FINALIZADO', ended_at = v_end,
    note = trim(coalesce(note || ' · ', '') || 'Salida cargada después')
  WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'day', r.day);
END; $$;
REVOKE ALL ON FUNCTION public.attendance_close_past(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.attendance_close_past(text) TO authenticated;

-- Entrada / salida / no asisto: si quedó abierta una jornada de otro día, primero hay que cerrarla.
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

  IF FOUND AND open_row.day < today AND p_action IN ('start', 'stop', 'absent') THEN
    RAISE EXCEPTION 'Quedó abierta tu jornada del %: primero cargá a qué hora terminaste ese día', to_char(open_row.day, 'DD/MM');
  END IF;
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
