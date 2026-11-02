-- Pedidos por ENCOMIENDA: comprobante de pago obligatorio y aprobación en Despacho.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_type text NOT NULL DEFAULT 'DELIVERY',
  ADD COLUMN IF NOT EXISTS payment_proof_path text,
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS payment_reviewed_by text,
  ADD COLUMN IF NOT EXISTS payment_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_review_note text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS payment_proofs_insert_own ON storage.objects;
CREATE POLICY payment_proofs_insert_own ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'payment-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS payment_proofs_read ON storage.objects;
CREATE POLICY payment_proofs_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payment-proofs' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'ADMIN')
    OR public.has_role(auth.uid(), 'DESPACHANTE')
    OR public.has_role(auth.uid(), 'PROVEEDOR')
  )
);

CREATE OR REPLACE FUNCTION public.orders_encomienda_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.shipping_type := upper(coalesce(nullif(trim(NEW.shipping_type), ''), 'DELIVERY'));
  IF TG_OP = 'INSERT' THEN
    IF NEW.shipping_type = 'ENCOMIENDA' THEN
      IF coalesce(NEW.payment_proof_path, '') = '' THEN
        RAISE EXCEPTION 'Pedido por encomienda: falta el comprobante de pago';
      END IF;
      NEW.payment_status := 'PENDIENTE';
      NEW.payment_reviewed_by := NULL; NEW.payment_reviewed_at := NULL; NEW.payment_review_note := NULL;
    ELSE
      NEW.payment_status := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- La aprobación sólo se cambia desde review_order_payment().
  IF current_setting('dcanp.payment_review', true) IS DISTINCT FROM '1' THEN
    NEW.payment_status := OLD.payment_status;
    NEW.payment_reviewed_by := OLD.payment_reviewed_by;
    NEW.payment_reviewed_at := OLD.payment_reviewed_at;
    NEW.payment_review_note := OLD.payment_review_note;
    NEW.shipping_type := OLD.shipping_type;
    -- Si se reemplaza el comprobante (p.ej. después de un rechazo) vuelve a revisión.
    IF NEW.payment_proof_path IS DISTINCT FROM OLD.payment_proof_path AND OLD.shipping_type = 'ENCOMIENDA' THEN
      NEW.payment_status := 'PENDIENTE';
    END IF;
  END IF;

  IF NEW.shipping_type = 'ENCOMIENDA'
     AND coalesce(NEW.payment_status, '') <> 'APROBADO'
     AND NEW.status2 IS DISTINCT FROM OLD.status2
     AND upper(coalesce(NEW.status2, '')) LIKE 'GUIA%' THEN
    RAISE EXCEPTION 'Encomienda: primero hay que aprobar el comprobante de pago';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS orders_encomienda_guard ON public.orders;
CREATE TRIGGER orders_encomienda_guard BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_encomienda_guard();

CREATE OR REPLACE FUNCTION public.review_order_payment(p_order_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o public.orders; me public.profiles; st text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF NOT public.can_edit_order_items(o) THEN RAISE EXCEPTION 'No podés aprobar pagos de este pedido'; END IF;
  IF o.shipping_type <> 'ENCOMIENDA' THEN RAISE EXCEPTION 'El pedido no es por encomienda'; END IF;
  IF NOT p_approve AND coalesce(trim(p_note), '') = '' THEN RAISE EXCEPTION 'Escribí el motivo del rechazo'; END IF;
  SELECT * INTO me FROM public.profiles WHERE user_id = auth.uid();
  st := CASE WHEN p_approve THEN 'APROBADO' ELSE 'RECHAZADO' END;
  PERFORM set_config('dcanp.payment_review', '1', true);
  UPDATE public.orders SET payment_status = st, payment_reviewed_by = me.email,
    payment_reviewed_at = now(), payment_review_note = nullif(trim(p_note), '')
  WHERE id = p_order_id;
  PERFORM set_config('dcanp.payment_review', '0', true);
  INSERT INTO public.order_status_history (order_id, previous_status, new_status, changed_by_email, changed_by_name, changed_by_role, message, event_type)
  VALUES (p_order_id, o.status, o.status, me.email, me.name, 'DESPACHO',
    CASE WHEN p_approve THEN '✅ Comprobante de encomienda aprobado' ELSE '❌ Comprobante rechazado: ' || trim(p_note) END,
    'payment');
  RETURN jsonb_build_object('payment_status', st);
END; $$;
REVOKE ALL ON FUNCTION public.review_order_payment(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.review_order_payment(uuid, boolean, text) TO authenticated;
