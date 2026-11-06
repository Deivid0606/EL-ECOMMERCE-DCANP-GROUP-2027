-- Cierres: safe 10-minute correction window for newly marked settlements.
-- Existing settled orders (before deployment) receive no reset window.
CREATE TABLE IF NOT EXISTS public.closure_settlement_corrections (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  settled_at timestamptz NOT NULL,
  previous_status2 text,
  previous_delivery_paid_at timestamptz,
  marked_by uuid,
  reversed_at timestamptz,
  reversed_by uuid
);
ALTER TABLE public.closure_settlement_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.closure_settlement_corrections FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.closure_capture_recent_settlement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  IF NEW.delivery_settled IS TRUE AND OLD.delivery_settled IS DISTINCT FROM TRUE THEN
    INSERT INTO public.closure_settlement_corrections
      (order_id,settled_at,previous_status2,previous_delivery_paid_at,marked_by,reversed_at,reversed_by)
    VALUES (NEW.id,clock_timestamp(),OLD.status2,OLD.delivery_paid_at,auth.uid(),NULL,NULL)
    ON CONFLICT (order_id) DO UPDATE
      SET settled_at=EXCLUDED.settled_at,
          previous_status2=EXCLUDED.previous_status2,
          previous_delivery_paid_at=EXCLUDED.previous_delivery_paid_at,
          marked_by=EXCLUDED.marked_by,
          reversed_at=NULL,reversed_by=NULL;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.closure_capture_recent_settlement() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_closure_capture_recent_settlement ON public.orders;
CREATE TRIGGER trg_closure_capture_recent_settlement
AFTER UPDATE OF delivery_settled ON public.orders
FOR EACH ROW
WHEN (NEW.delivery_settled IS TRUE AND OLD.delivery_settled IS DISTINCT FROM TRUE)
EXECUTE FUNCTION public.closure_capture_recent_settlement();

-- Only admin or the order's actual provider can list reversible settlements.
CREATE OR REPLACE FUNCTION public.closure_recent_resettable_orders()
RETURNS TABLE(order_id uuid, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt()->>'email','')));
  v_admin boolean;
  v_supplier boolean;
BEGIN
  IF v_user IS NULL OR NOT public.app_account_approved() THEN
    RETURN;
  END IF;
  v_admin := public.has_role(v_user,'ADMIN');
  v_supplier := public.has_role(v_user,'PROVEEDOR');
  IF NOT (v_admin OR v_supplier) THEN RETURN; END IF;

  RETURN QUERY
  SELECT o.id, c.settled_at + interval '10 minutes'
    FROM public.closure_settlement_corrections c
    JOIN public.orders o ON o.id=c.order_id
    WHERE o.delivery_settled IS TRUE
      AND c.reversed_at IS NULL
      AND c.settled_at >= timestamptz '2026-11-05 00:00:00-03'
      AND statement_timestamp() < c.settled_at + interval '10 minutes'
      AND (v_admin OR lower(trim(coalesce(o.provider_email,'')))=v_email)
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_closure_orders co
        JOIN public.delivery_closure_submissions s ON s.id=co.closure_id
        WHERE co.order_id=o.id AND s.status='APROBADO'
      );
END
$fn$;
REVOKE ALL ON FUNCTION public.closure_recent_resettable_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.closure_recent_resettable_orders() TO authenticated;

CREATE OR REPLACE FUNCTION public.closure_reset_recent_settlement(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt()->>'email','')));
  v_admin boolean;
  v_supplier boolean;
  v_order public.orders%ROWTYPE;
  v_audit public.closure_settlement_corrections%ROWTYPE;
BEGIN
  IF v_user IS NULL OR p_order_id IS NULL OR NOT public.app_account_approved() THEN
    RAISE EXCEPTION 'Sin autorización';
  END IF;
  v_admin := public.has_role(v_user,'ADMIN');
  v_supplier := public.has_role(v_user,'PROVEEDOR');
  IF NOT (v_admin OR v_supplier) THEN
    RAISE EXCEPTION 'Solo ADMIN o PROVEEDOR pueden restablecer rendiciones';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.delivery_settled IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'El pedido no está marcado como rendido';
  END IF;
  IF NOT v_admin AND lower(trim(coalesce(v_order.provider_email,'')))<>v_email THEN
    RAISE EXCEPTION 'Solo podés restablecer pedidos de tu proveedor';
  END IF;
  SELECT * INTO v_audit FROM public.closure_settlement_corrections
   WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_audit.reversed_at IS NOT NULL
    OR v_audit.settled_at < timestamptz '2026-11-05 00:00:00-03'
    OR statement_timestamp() >= v_audit.settled_at + interval '10 minutes' THEN
    RAISE EXCEPTION 'El plazo de 10 minutos terminó o la rendición es anterior a hoy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.delivery_closure_orders co
    JOIN public.delivery_closure_submissions s ON s.id=co.closure_id
    WHERE co.order_id=p_order_id AND s.status='APROBADO'
  ) THEN
    RAISE EXCEPTION 'Este pedido pertenece a un cierre aprobado; requiere revisión administrativa';
  END IF;

  UPDATE public.orders
     SET delivery_settled=false,
         status2=v_audit.previous_status2,
         delivery_paid_at=v_audit.previous_delivery_paid_at,
         updated_at=now()
   WHERE id=p_order_id AND delivery_settled IS TRUE;
  UPDATE public.closure_settlement_corrections
     SET reversed_at=clock_timestamp(),reversed_by=v_user
   WHERE order_id=p_order_id;

  INSERT INTO public.order_status_history
    (order_id,previous_status,new_status,changed_by_email,changed_by_role,message,event_type)
  VALUES
    (p_order_id,coalesce(v_order.status2,'RENDIDO'),coalesce(v_audit.previous_status2,'SIN RENDIR'),
     v_email,CASE WHEN v_admin THEN 'ADMIN' ELSE 'PROVEEDOR' END,
     'Rendición restablecida a NO RENDIDO dentro del plazo de 10 minutos',
     'RENDICION_RESTABLECIDA');
  RETURN TRUE;
END
$fn$;
REVOKE ALL ON FUNCTION public.closure_reset_recent_settlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.closure_reset_recent_settlement(uuid) TO authenticated;
