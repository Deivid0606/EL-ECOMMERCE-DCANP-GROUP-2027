-- "INTERIOR PAGO ANTICIPADO" siempre es encomienda: comprobante obligatorio al cargar.
-- (Misma función que 20261102020000 con la regla de ciudad agregada.)
CREATE OR REPLACE FUNCTION public.orders_encomienda_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.shipping_type := upper(coalesce(nullif(trim(NEW.shipping_type), ''), 'DELIVERY'));
  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.city, '') ~* 'pago\s*anticipado' THEN
      NEW.shipping_type := 'ENCOMIENDA';
    END IF;
    IF NEW.shipping_type = 'ENCOMIENDA' THEN
      IF coalesce(NEW.payment_proof_path, '') = '' THEN
        RAISE EXCEPTION 'Pedido por encomienda / interior pago anticipado: falta el comprobante de pago';
      END IF;
      NEW.payment_status := 'PENDIENTE';
      NEW.payment_reviewed_by := NULL; NEW.payment_reviewed_at := NULL; NEW.payment_review_note := NULL;
    ELSE
      NEW.payment_status := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('dcanp.payment_review', true) IS DISTINCT FROM '1' THEN
    NEW.payment_status := OLD.payment_status;
    NEW.payment_reviewed_by := OLD.payment_reviewed_by;
    NEW.payment_reviewed_at := OLD.payment_reviewed_at;
    NEW.payment_review_note := OLD.payment_review_note;
    NEW.shipping_type := OLD.shipping_type;
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
