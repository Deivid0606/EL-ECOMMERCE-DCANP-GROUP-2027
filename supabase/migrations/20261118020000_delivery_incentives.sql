-- 🏆 Incentivos individuales para deliverys: meta de entregas en un período y premio.
CREATE TABLE IF NOT EXISTS public.delivery_incentives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_email text NOT NULL,
  reward text NOT NULL,
  target integer NOT NULL CHECK (target > 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  paid_by text,
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS delivery_incentives_delivery_idx ON public.delivery_incentives (lower(delivery_email), ends_on);
ALTER TABLE public.delivery_incentives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_incentives_read ON public.delivery_incentives;
CREATE POLICY delivery_incentives_read ON public.delivery_incentives FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'ADMIN')
  OR lower(coalesce(created_by, '')) = (SELECT public.current_profile_email())
  OR lower(delivery_email) = (SELECT public.current_profile_email())
);
DROP POLICY IF EXISTS delivery_incentives_write ON public.delivery_incentives;
CREATE POLICY delivery_incentives_write ON public.delivery_incentives FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'ADMIN')
    OR (public.has_role(auth.uid(), 'PROVEEDOR') AND lower(coalesce(created_by, '')) = (SELECT public.current_profile_email()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'ADMIN')
    OR (public.has_role(auth.uid(), 'PROVEEDOR') AND lower(coalesce(created_by, '')) = (SELECT public.current_profile_email()))
  );

-- Entregas de cada incentivo: pedidos del delivery que hoy están entregados y cuya
-- entrega se marcó dentro del período (hora de Paraguay).
CREATE OR REPLACE FUNCTION public.incentives_progress(p_ids uuid[])
RETURNS TABLE (id uuid, delivered integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT i.id, (
    SELECT count(DISTINCT o.id)::integer FROM public.orders o
    WHERE lower(o.assigned_delivery) = lower(i.delivery_email)
      AND o.status IN ('ENTREGADO', 'ENCOMIENDA ENTREGADA')
      AND EXISTS (
        SELECT 1 FROM public.order_status_history h
        WHERE h.order_id = o.id AND h.new_status IN ('ENTREGADO', 'ENCOMIENDA ENTREGADA')
          AND public.py_day(h.created_at) BETWEEN i.starts_on AND i.ends_on)
  )
  FROM public.delivery_incentives i
  WHERE i.id = ANY (p_ids)
    AND (public.has_role(auth.uid(), 'ADMIN')
      OR lower(coalesce(i.created_by, '')) = public.current_profile_email()
      OR lower(i.delivery_email) = public.current_profile_email());
$function$;
REVOKE ALL ON FUNCTION public.incentives_progress(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.incentives_progress(uuid[]) TO authenticated;
