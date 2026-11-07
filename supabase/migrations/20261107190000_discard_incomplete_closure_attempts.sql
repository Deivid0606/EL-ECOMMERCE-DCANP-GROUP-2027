-- Permitir descartar intentos incompletos sin borrar comprobantes ni cierres contables.
-- Solo el administrador o el proveedor destinatario aprobado puede hacerlo.
ALTER TABLE public.delivery_closure_recovery
  DROP CONSTRAINT IF EXISTS delivery_closure_recovery_status_check;
ALTER TABLE public.delivery_closure_recovery
  ADD CONSTRAINT delivery_closure_recovery_status_check
  CHECK (status IN ('PREPARADO', 'ARCHIVO_CARGADO', 'COMPLETADO', 'DESCARTADO'));

DROP POLICY IF EXISTS closure_recovery_provider_read ON public.delivery_closure_recovery;
CREATE POLICY closure_recovery_provider_read ON public.delivery_closure_recovery
  FOR SELECT TO authenticated
  USING (
    destination_user_id = auth.uid()
    AND public.has_role(auth.uid(), 'PROVEEDOR'::public.app_role)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.approved = true)
  );

CREATE OR REPLACE FUNCTION public.discard_incomplete_closure_attempt(p_attempt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_attempt public.delivery_closure_recovery%ROWTYPE;
  v_is_admin boolean;
  v_is_provider boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Iniciá sesión para continuar';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND approved = true
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND approved = true
  ) THEN
    RAISE EXCEPTION 'Cuenta no aprobada';
  END IF;

  v_is_admin := public.has_role(auth.uid(), 'ADMIN'::public.app_role);
  v_is_provider := public.has_role(auth.uid(), 'PROVEEDOR'::public.app_role);

  SELECT * INTO v_attempt
  FROM public.delivery_closure_recovery
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intento no encontrado';
  END IF;
  IF NOT (v_is_admin OR (v_is_provider AND v_attempt.destination_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Solo ADMIN o el PROVEEDOR destinatario puede descartar este intento';
  END IF;
  IF v_attempt.status NOT IN ('PREPARADO', 'ARCHIVO_CARGADO') THEN
    RAISE EXCEPTION 'Solo se pueden descartar intentos incompletos';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.delivery_closure_submissions c
    WHERE c.receipt_path = v_attempt.receipt_path
  ) THEN
    RAISE EXCEPTION 'El comprobante está asociado a un cierre registrado';
  END IF;

  UPDATE public.delivery_closure_recovery
  SET status = 'DESCARTADO',
      last_error = concat_ws(' | ', nullif(last_error, ''),
        'Descartado manualmente por ' || auth.uid()::text || ' el ' || now()::text)
  WHERE id = v_attempt.id;
END;
$$;

REVOKE ALL ON FUNCTION public.discard_incomplete_closure_attempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_incomplete_closure_attempt(uuid) TO authenticated;
COMMENT ON FUNCTION public.discard_incomplete_closure_attempt(uuid) IS
  'Descarta intentos incompletos sin borrar comprobantes ni alterar cierres aprobados; admin o proveedor destinatario.';
