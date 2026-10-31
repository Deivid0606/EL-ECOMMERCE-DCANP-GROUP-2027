-- Pago al delivery por estado (ej. RECHAZADO EN EL LUGAR) y pago único a varios
-- proveedores que comparten cuenta bancaria.

-- ============================================
-- CONFIGURACIÓN: cuánto se paga por estado
-- ============================================
CREATE TABLE IF NOT EXISTS public.delivery_status_pay (
  status text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('fixed', 'percent')),
  value numeric NOT NULL CHECK (value >= 0),
  active boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.delivery_status_pay ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_status_pay_read ON public.delivery_status_pay;
CREATE POLICY delivery_status_pay_read ON public.delivery_status_pay FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS delivery_status_pay_admin ON public.delivery_status_pay;
CREATE POLICY delivery_status_pay_admin ON public.delivery_status_pay FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN')) WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

-- ============================================
-- INTENTOS PAGADOS: un registro por intento (pedido + estado + día)
-- ============================================
CREATE TABLE IF NOT EXISTS public.delivery_attempt_payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  delivery_email text NOT NULL,
  provider_email text,
  status text NOT NULL,
  day date NOT NULL,
  base_fee numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL CHECK (amount >= 0),
  closure_id uuid REFERENCES public.delivery_closure_submissions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, delivery_email, day)
);
CREATE INDEX IF NOT EXISTS delivery_attempt_payments_open_idx ON public.delivery_attempt_payments (lower(delivery_email)) WHERE closure_id IS NULL;
ALTER TABLE public.delivery_attempt_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_attempt_payments_read ON public.delivery_attempt_payments;
CREATE POLICY delivery_attempt_payments_read ON public.delivery_attempt_payments FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'ADMIN')
  OR lower(delivery_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), ''))
  OR lower(coalesce(provider_email, '')) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), ''))
);
REVOKE INSERT, UPDATE, DELETE ON public.delivery_attempt_payments FROM anon, authenticated;

-- Tarifa de la ciudad para el delivery del pedido (la misma que usan los cierres).
CREATE OR REPLACE FUNCTION public.order_city_fee(o public.orders)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(nullif(o.delivery_fee_gs, 0), (
    SELECT d.fee_gs FROM public.delivery_fees d
    WHERE lower(trim(coalesce(d.delivery_email, ''))) = lower(trim(coalesce(o.assigned_delivery, '')))
      AND lower(trim(coalesce(d.city, ''))) = lower(trim(coalesce(o.city, '')))
    ORDER BY d.updated_at DESC, d.id DESC LIMIT 1
  ), 0);
$$;

-- Al pasar a un estado pagado se registra el intento; si el mismo día se corrige
-- a otro estado (y todavía no está en un cierre) se borra.
CREATE OR REPLACE FUNCTION public.delivery_attempt_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cfg public.delivery_status_pay; base numeric; amt numeric; today date := public.py_day(now()); delivery text;
BEGIN
  BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    delivery := lower(trim(coalesce(NEW.assigned_delivery, '')));
    IF delivery = '' THEN RETURN NEW; END IF;

    DELETE FROM public.delivery_attempt_payments
    WHERE order_id = NEW.id AND lower(delivery_email) = delivery AND day = today AND closure_id IS NULL;

    SELECT * INTO cfg FROM public.delivery_status_pay WHERE active AND upper(status) = upper(trim(coalesce(NEW.status, '')));
    IF NOT FOUND THEN RETURN NEW; END IF;

    base := public.order_city_fee(NEW);
    amt := CASE WHEN cfg.mode = 'fixed' THEN cfg.value ELSE round(base * cfg.value / 100) END;
    IF amt <= 0 THEN RETURN NEW; END IF;

    INSERT INTO public.delivery_attempt_payments(order_id, delivery_email, provider_email, status, day, base_fee, amount)
    VALUES (NEW.id, delivery,
            lower(nullif(trim(coalesce(NEW.provider_email, split_part(coalesce(NEW.provider_emails_list, ''), ',', 1))), '')),
            upper(trim(NEW.status)), today, base, amt)
    ON CONFLICT (order_id, delivery_email, day) DO UPDATE
      SET status = EXCLUDED.status, base_fee = EXCLUDED.base_fee, amount = EXCLUDED.amount, created_at = now()
      WHERE public.delivery_attempt_payments.closure_id IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'delivery_attempt_trigger: %', SQLERRM;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS delivery_attempt_payment ON public.orders;
CREATE TRIGGER delivery_attempt_payment AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.delivery_attempt_trigger();

-- ============================================
-- CIERRE: incluye los intentos pagados del proveedor
-- ============================================
-- Misma lógica que antes + intentos pendientes del delivery para ese proveedor
-- (se descuentan del neto a transferir). Admite cierres sólo con intentos.
CREATE OR REPLACE FUNCTION public.submit_delivery_closure(p_destination_user_id uuid, p_order_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
 actor_email text; dest_email text; cid uuid; o public.orders%ROWTYPE;
 amount numeric := 0; individual numeric; fee numeric; collected numeric;
 n integer; matched integer := 0; eligible_ids uuid[]; fee_found boolean; raw_fee numeric;
 attempts_total numeric := 0; attempts_n integer := 0;
BEGIN
 IF NOT public.has_role(auth.uid(),'DELIVERY') THEN RAISE EXCEPTION 'Solo delivery'; END IF;
 SELECT email INTO actor_email FROM public.profiles WHERE user_id=auth.uid();
 IF actor_email IS NULL THEN RAISE EXCEPTION 'Perfil del delivery no encontrado'; END IF;
 SELECT p.email INTO dest_email FROM public.profiles p
 JOIN public.closure_bank_destinations b ON b.owner_user_id=p.user_id
 WHERE p.user_id=p_destination_user_id
   AND public.has_role(p.user_id,'PROVEEDOR');
 IF dest_email IS NULL THEN RAISE EXCEPTION 'Seleccioná un proveedor aprobado que tenga cuenta bancaria configurada'; END IF;

 PERFORM 1 FROM public.delivery_attempt_payments a
 WHERE lower(a.delivery_email)=lower(actor_email) AND a.closure_id IS NULL AND lower(coalesce(a.provider_email,''))=lower(dest_email)
 FOR UPDATE;
 SELECT coalesce(sum(a.amount),0), count(*) INTO attempts_total, attempts_n FROM public.delivery_attempt_payments a
 WHERE lower(a.delivery_email)=lower(actor_email) AND a.closure_id IS NULL AND lower(coalesce(a.provider_email,''))=lower(dest_email);

 SELECT count(DISTINCT x) INTO n FROM unnest(coalesce(p_order_ids,'{}'::uuid[])) x;
 IF n>5000 OR n<>coalesce(array_length(p_order_ids,1),0) OR (n=0 AND attempts_n=0) THEN
   RAISE EXCEPTION 'Seleccioná entre 1 y 5000 pedidos diferentes';
 END IF;
 PERFORM 1 FROM public.orders q
 WHERE lower(coalesce(q.assigned_delivery,''))=lower(actor_email)
   AND q.status IN ('ENTREGADO','ENCOMIENDA ENTREGADA')
   AND coalesce(q.delivery_settled,false)=false
   AND (lower(dest_email)=ANY(regexp_split_to_array(lower(coalesce(q.provider_emails_list,'')), '[,;[:space:]]+'))
     OR lower(dest_email)=lower(coalesce(q.provider_email,''))
     OR lower(dest_email)=lower(coalesce(q.supplier_email,'')))
   AND NOT EXISTS(SELECT 1 FROM public.delivery_closure_orders d WHERE d.order_id=q.id)
 ORDER BY q.id FOR UPDATE OF q;
 SELECT coalesce(array_agg(q.id ORDER BY q.id),'{}'::uuid[]) INTO eligible_ids
 FROM public.orders q
 WHERE lower(coalesce(q.assigned_delivery,''))=lower(actor_email)
   AND q.status IN ('ENTREGADO','ENCOMIENDA ENTREGADA')
   AND coalesce(q.delivery_settled,false)=false
   AND (lower(dest_email)=ANY(regexp_split_to_array(lower(coalesce(q.provider_emails_list,'')), '[,;[:space:]]+'))
     OR lower(dest_email)=lower(coalesce(q.provider_email,''))
     OR lower(dest_email)=lower(coalesce(q.supplier_email,'')))
   AND NOT EXISTS(SELECT 1 FROM public.delivery_closure_orders d WHERE d.order_id=q.id);
 IF coalesce(eligible_ids,'{}'::uuid[]) <> (SELECT coalesce(array_agg(x ORDER BY x),'{}'::uuid[]) FROM unnest(coalesce(p_order_ids,'{}'::uuid[])) x) THEN
   RAISE EXCEPTION 'El cierre debe incluir TODOS los pedidos entregados pendientes del proveedor. Actualizá Cierres y volvé a intentarlo.';
 END IF;
 FOR o IN SELECT * FROM public.orders WHERE id=ANY(coalesce(p_order_ids,'{}'::uuid[])) ORDER BY id FOR UPDATE LOOP
   IF lower(coalesce(o.assigned_delivery,''))<>lower(actor_email)
      OR o.status NOT IN ('ENTREGADO','ENCOMIENDA ENTREGADA')
      OR coalesce(o.delivery_settled,false)
      OR NOT (
         lower(dest_email)=ANY(regexp_split_to_array(lower(coalesce(o.provider_emails_list,'')), '[,;[:space:]]+'))
         OR lower(dest_email)=lower(coalesce(o.provider_email,''))
         OR lower(dest_email)=lower(coalesce(o.supplier_email,''))
       )
      OR EXISTS(SELECT 1 FROM public.delivery_closure_orders d WHERE d.order_id=o.id) THEN
     RAISE EXCEPTION 'Pedido % no válido, no pertenece al destinatario o ya figura en cierre',o.id;
   END IF;
   fee_found := false;
   raw_fee := coalesce(o.delivery_fee_gs,0);
   IF raw_fee > 0 THEN
     fee := raw_fee;
     fee_found := true;
   ELSE
     SELECT d.fee_gs INTO fee FROM public.delivery_fees d
     WHERE lower(trim(coalesce(d.delivery_email,'')))=lower(trim(o.assigned_delivery))
       AND lower(trim(coalesce(d.city,'')))=lower(trim(coalesce(o.city,'')))
     ORDER BY d.updated_at DESC, d.id DESC LIMIT 1;
     fee_found := FOUND;
   END IF;
   IF NOT fee_found OR fee IS NULL OR fee<0 THEN
     RAISE EXCEPTION 'Falta tarifa válida del delivery para pedido % (ciudad %)',o.id,coalesce(o.city,'');
   END IF;
   collected := CASE WHEN o.status='ENTREGADO' THEN coalesce(o.total_gs,0) ELSE 0 END;
   IF collected<0 THEN RAISE EXCEPTION 'Monto cobrado negativo para pedido %',o.id; END IF;
   individual := collected-fee;
   amount := amount+individual;
   matched := matched+1;
 END LOOP;
 IF matched<>n THEN RAISE EXCEPTION 'Faltan pedidos o no se pudieron validar todos'; END IF;
 amount := amount - attempts_total;
 IF amount<0 THEN RAISE EXCEPTION 'Lo que corresponde al delivery (tarifas e intentos, Gs %) supera lo cobrado. Se requiere regularización del saldo con administración.', round(-amount); END IF;
 INSERT INTO public.delivery_closure_submissions(delivery_user_id,delivery_email,destination_user_id,destination_email,amount_gs)
 VALUES(auth.uid(),actor_email,p_destination_user_id,dest_email,amount) RETURNING id INTO cid;
 FOR o IN SELECT * FROM public.orders WHERE id=ANY(coalesce(p_order_ids,'{}'::uuid[])) ORDER BY id LOOP
   raw_fee := coalesce(o.delivery_fee_gs,0);
   IF raw_fee>0 THEN fee:=raw_fee;
   ELSE
     SELECT d.fee_gs INTO fee FROM public.delivery_fees d
     WHERE lower(trim(coalesce(d.delivery_email,'')))=lower(trim(o.assigned_delivery))
       AND lower(trim(coalesce(d.city,'')))=lower(trim(coalesce(o.city,'')))
     ORDER BY d.updated_at DESC,d.id DESC LIMIT 1;
   END IF;
   INSERT INTO public.delivery_closure_orders(closure_id,order_id,amount_gs)
   VALUES(cid,o.id,(CASE WHEN o.status='ENTREGADO' THEN coalesce(o.total_gs,0) ELSE 0 END)-fee);
 END LOOP;
 UPDATE public.delivery_attempt_payments SET closure_id = cid
 WHERE lower(delivery_email)=lower(actor_email) AND closure_id IS NULL AND lower(coalesce(provider_email,''))=lower(dest_email);
 RETURN cid;
END $$;

-- ============================================
-- PAGO ÚNICO A VARIOS PROVEEDORES (misma cuenta bancaria)
-- ============================================
ALTER TABLE public.delivery_closure_submissions ADD COLUMN IF NOT EXISTS payment_group uuid;
DROP INDEX IF EXISTS public.delivery_closure_receipt_unique;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_closure_receipt_unique
  ON public.delivery_closure_submissions (receipt_path, destination_user_id) WHERE receipt_path IS NOT NULL;

CREATE OR REPLACE FUNCTION public.submit_delivery_closure_group(p_destination_user_ids uuid[], p_order_ids uuid[], p_receipt_path text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  grp uuid := gen_random_uuid();
  dest uuid;
  dest_email text;
  accounts integer;
  subset uuid[];
  used uuid[] := '{}';
  cid uuid;
  me text;
BEGIN
  IF NOT public.has_role(auth.uid(),'DELIVERY') THEN RAISE EXCEPTION 'Solo un delivery puede finalizar su cierre'; END IF;
  IF coalesce(array_length(p_destination_user_ids, 1), 0) < 2 THEN RAISE EXCEPTION 'Elegí al menos dos proveedores para un pago único'; END IF;
  IF p_receipt_path IS NULL OR p_receipt_path NOT LIKE ('closure-pending/' || auth.uid()::text || '/%')
     OR array_length(string_to_array(p_receipt_path,'/'),1)<>3 THEN
    RAISE EXCEPTION 'Adjuntá tu comprobante antes de finalizar';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='financial-receipts' AND name=p_receipt_path) THEN
    RAISE EXCEPTION 'No se encontró el comprobante en el almacenamiento privado';
  END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_closure_submissions WHERE receipt_path=p_receipt_path) THEN
    RAISE EXCEPTION 'Este comprobante ya fue usado en otro cierre';
  END IF;

  -- Una sola transferencia sólo puede ir a una cuenta.
  SELECT count(DISTINCT lower(trim(b.bank_name)) || '|' || regexp_replace(b.bank_account, '\D', '', 'g'))
  INTO accounts FROM public.closure_bank_destinations b WHERE b.owner_user_id = ANY(p_destination_user_ids);
  IF accounts <> 1 THEN RAISE EXCEPTION 'Los proveedores elegidos no comparten la misma cuenta bancaria: hacé un comprobante por proveedor'; END IF;

  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();

  FOREACH dest IN ARRAY p_destination_user_ids LOOP
    SELECT lower(email) INTO dest_email FROM public.profiles WHERE user_id = dest;
    -- Pedidos del proveedor entre los enviados (cada pedido va a un solo cierre).
    SELECT coalesce(array_agg(o.id ORDER BY o.id), '{}') INTO subset
    FROM public.orders o
    WHERE o.id = ANY(coalesce(p_order_ids, '{}')) AND NOT (o.id = ANY(used))
      AND (dest_email = ANY(regexp_split_to_array(lower(coalesce(o.provider_emails_list,'')), '[,;[:space:]]+'))
        OR dest_email = lower(coalesce(o.provider_email,''))
        OR dest_email = lower(coalesce(o.supplier_email,'')));
    used := used || subset;

    IF coalesce(array_length(subset, 1), 0) = 0 AND NOT EXISTS (
      SELECT 1 FROM public.delivery_attempt_payments a
      WHERE lower(a.delivery_email) = me AND a.closure_id IS NULL AND lower(coalesce(a.provider_email,'')) = dest_email
    ) THEN
      CONTINUE;
    END IF;

    cid := public.submit_delivery_closure(dest, subset);
    UPDATE public.delivery_closure_submissions SET receipt_path = p_receipt_path, payment_group = grp
    WHERE id = cid AND delivery_user_id = auth.uid() AND status = 'PENDIENTE';
  END LOOP;

  IF coalesce(array_length(used, 1), 0) <> coalesce(array_length(p_order_ids, 1), 0) THEN
    RAISE EXCEPTION 'Hay pedidos que no pertenecen a los proveedores elegidos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.delivery_closure_submissions WHERE payment_group = grp) THEN
    RAISE EXCEPTION 'No hay pedidos para rendir en los proveedores elegidos';
  END IF;
  RETURN grp;
END $$;
REVOKE ALL ON FUNCTION public.submit_delivery_closure_group(uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_delivery_closure_group(uuid[], uuid[], text) TO authenticated;
