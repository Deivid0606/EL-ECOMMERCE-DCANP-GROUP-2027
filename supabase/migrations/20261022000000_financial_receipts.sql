-- Ejecutar ANTES de subir los archivos React. No ejecutar dos migraciones financieras diferentes.
ALTER TABLE public.commission_requests ADD COLUMN IF NOT EXISTS receipt_path text;
ALTER TABLE public.commission_requests ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.commission_requests ADD COLUMN IF NOT EXISTS paid_by text;

CREATE TABLE IF NOT EXISTS public.closure_bank_destinations (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  bank_name text NOT NULL,
  bank_account text NOT NULL,
  bank_holder text NOT NULL,
  bank_ci text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.closure_bank_destinations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_destination_read ON public.closure_bank_destinations;
CREATE POLICY bank_destination_read ON public.closure_bank_destinations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS bank_destination_insert ON public.closure_bank_destinations;
CREATE POLICY bank_destination_insert ON public.closure_bank_destinations FOR INSERT TO authenticated WITH CHECK (
 auth.uid() = owner_user_id AND (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'PROVEEDOR'))
);
DROP POLICY IF EXISTS bank_destination_update ON public.closure_bank_destinations;
CREATE POLICY bank_destination_update ON public.closure_bank_destinations FOR UPDATE TO authenticated USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);

CREATE TABLE IF NOT EXISTS public.delivery_closure_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 delivery_user_id uuid NOT NULL REFERENCES auth.users(id),
 delivery_email text NOT NULL,
 destination_user_id uuid NOT NULL REFERENCES auth.users(id),
 destination_email text NOT NULL,
 amount_gs numeric NOT NULL CHECK (amount_gs >= 0),
 receipt_path text,
 status text NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE','APROBADO','RECHAZADO')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by text,
 rejection_reason text
);
CREATE TABLE IF NOT EXISTS public.delivery_closure_orders (
 closure_id uuid NOT NULL REFERENCES public.delivery_closure_submissions(id) ON DELETE CASCADE,
 order_id uuid NOT NULL REFERENCES public.orders(id),
 amount_gs numeric NOT NULL,
 PRIMARY KEY(closure_id,order_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_closure_per_order ON public.delivery_closure_orders(order_id)
WHERE order_id IS NOT NULL; -- Conserva trazabilidad incluso si se rechaza: corregir el cierre en lugar de crear otro
ALTER TABLE public.delivery_closure_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_closure_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clos_submissions_read ON public.delivery_closure_submissions;
CREATE POLICY clos_submissions_read ON public.delivery_closure_submissions FOR SELECT TO authenticated USING (
 delivery_user_id = auth.uid() OR destination_user_id = auth.uid() OR public.has_role(auth.uid(),'ADMIN')
);
DROP POLICY IF EXISTS clos_orders_read ON public.delivery_closure_orders;
CREATE POLICY clos_orders_read ON public.delivery_closure_orders FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.delivery_closure_submissions s WHERE s.id = closure_id AND
 (s.delivery_user_id = auth.uid() OR s.destination_user_id = auth.uid() OR public.has_role(auth.uid(),'ADMIN')))
);

INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('financial-receipts','financial-receipts',false,8388608,ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Rutas de archivos: commission/<request_id>/<uuid>.<ext> y closure/<closure_id>/<uuid>.<ext>
DROP POLICY IF EXISTS financial_receipt_insert ON storage.objects;
CREATE POLICY financial_receipt_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
 bucket_id = 'financial-receipts' AND (
 (split_part(name,'/',1)='commission' AND EXISTS(
   SELECT 1 FROM public.commission_requests c WHERE c.id::text = split_part(name,'/',2)
   AND (public.has_role(auth.uid(),'ADMIN') OR (public.has_role(auth.uid(),'PROVEEDOR') AND lower(c.provider_email) = lower((SELECT email FROM public.profiles WHERE user_id=auth.uid()))))
 )) OR (split_part(name,'/',1)='closure' AND EXISTS(
   SELECT 1 FROM public.delivery_closure_submissions s WHERE s.id::text=split_part(name,'/',2) AND s.delivery_user_id=auth.uid()
 ))))
);
DROP POLICY IF EXISTS financial_receipt_select ON storage.objects;
CREATE POLICY financial_receipt_select ON storage.objects FOR SELECT TO authenticated USING (
 bucket_id = 'financial-receipts' AND (
 (split_part(name,'/',1)='commission' AND EXISTS(
  SELECT 1 FROM public.commission_requests c WHERE c.id::text=split_part(name,'/',2) AND
  (public.has_role(auth.uid(),'ADMIN') OR lower(c.vendor_email)=lower((SELECT email FROM public.profiles WHERE user_id=auth.uid())) OR
  (public.has_role(auth.uid(),'PROVEEDOR') AND lower(c.provider_email)=lower((SELECT email FROM public.profiles WHERE user_id=auth.uid()))))
 )) OR (split_part(name,'/',1)='closure' AND EXISTS(
  SELECT 1 FROM public.delivery_closure_submissions s WHERE s.id::text=split_part(name,'/',2) AND
  (s.delivery_user_id=auth.uid() OR s.destination_user_id=auth.uid() OR public.has_role(auth.uid(),'ADMIN'))
 )))
);

CREATE OR REPLACE FUNCTION public.pay_commission_with_receipt(p_request_id uuid,p_receipt_path text,p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.commission_requests%ROWTYPE; order_id uuid; actor_email text;
BEGIN
 SELECT email INTO actor_email FROM public.profiles WHERE user_id=auth.uid();
 SELECT * INTO c FROM public.commission_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR c.status <> 'PENDIENTE' THEN RAISE EXCEPTION 'Solicitud inexistente o ya procesada'; END IF;
 IF NOT (public.has_role(auth.uid(),'ADMIN') OR
   (public.has_role(auth.uid(),'PROVEEDOR') AND lower(c.provider_email)=lower(actor_email))) THEN RAISE EXCEPTION 'Sin autorización'; END IF;
 IF p_receipt_path NOT LIKE ('commission/' || p_request_id::text || '/%') OR NOT EXISTS
 (SELECT 1 FROM storage.objects WHERE bucket_id='financial-receipts' AND name=p_receipt_path) THEN RAISE EXCEPTION 'Comprobante inválido'; END IF;
 UPDATE public.commission_requests SET status='APROBADO', approved_at=now(),approved_by=actor_email,
 approval_note=p_note,receipt_path=p_receipt_path,paid_at=now(),paid_by=actor_email WHERE id=p_request_id;
 -- Compatibilidad con saldos históricos: APROBADO se conserva como estado final.
 FOR order_id IN SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(c.meta_json->'order_ids','[]'::jsonb)) LOOP
  UPDATE public.orders SET commission_paid=true,paid_at=now() WHERE id=order_id;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.pay_commission_with_receipt(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_commission_with_receipt(uuid,text,text) TO authenticated;

-- Un cierre es creado y rendido solamente por el servidor. El importe se calcula a partir de pedidos elegibles.
CREATE OR REPLACE FUNCTION public.submit_delivery_closure(p_destination_user_id uuid,p_order_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor_email text; dest_email text; n integer; valid_n integer; amount numeric; cid uuid; o public.orders%ROWTYPE;
BEGIN
 IF NOT public.has_role(auth.uid(),'DELIVERY') THEN RAISE EXCEPTION 'Solo delivery'; END IF;
 SELECT email INTO actor_email FROM public.profiles WHERE user_id=auth.uid();
 SELECT p.email INTO dest_email FROM public.profiles p JOIN public.closure_bank_destinations b ON b.owner_user_id=p.user_id WHERE p.user_id=p_destination_user_id;
 IF dest_email IS NULL THEN RAISE EXCEPTION 'Cuenta bancaria del destinatario no configurada'; END IF;
 SELECT count(DISTINCT x) INTO n FROM unnest(p_order_ids) x;
 IF n=0 OR n>300 THEN RAISE EXCEPTION 'Seleccioná entre 1 y 300 pedidos'; END IF;
 SELECT count(*),sum(greatest(0,coalesce(total_gs,0)-coalesce(delivery_fee_gs,0))) INTO valid_n,amount
 FROM public.orders WHERE id=ANY(p_order_ids) AND lower(assigned_delivery)=lower(actor_email)
 AND status IN ('ENTREGADO','ENCOMIENDA ENTREGADA') AND NOT coalesce(delivery_settled,false)
 AND (public.has_role(p_destination_user_id,'ADMIN') OR lower(coalesce(provider_emails_list,'')) LIKE '%' || lower(dest_email) || '%')
 AND NOT EXISTS(SELECT 1 FROM public.delivery_closure_orders d WHERE d.order_id=orders.id);
 IF valid_n<>n THEN RAISE EXCEPTION 'Pedidos no válidos, ya rendidos o de otro destinatario'; END IF;
 INSERT INTO public.delivery_closure_submissions(delivery_user_id,delivery_email,destination_user_id,destination_email,amount_gs)
 VALUES(auth.uid(),actor_email,p_destination_user_id,dest_email,amount) RETURNING id INTO cid;
 INSERT INTO public.delivery_closure_orders(closure_id,order_id,amount_gs)
 SELECT cid,id,greatest(0,coalesce(total_gs,0)-coalesce(delivery_fee_gs,0)) FROM public.orders WHERE id=ANY(p_order_ids);
 RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public.submit_delivery_closure(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_delivery_closure(uuid,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.attach_delivery_closure_receipt(p_closure_id uuid,p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.delivery_closure_submissions WHERE id=p_closure_id AND delivery_user_id=auth.uid() AND status='PENDIENTE') THEN RAISE EXCEPTION 'Sin permisos'; END IF;
 IF p_path NOT LIKE 'closure/'||p_closure_id::text||'/%' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='financial-receipts' AND name=p_path) THEN RAISE EXCEPTION 'Comprobante inválido'; END IF;
 UPDATE public.delivery_closure_submissions SET receipt_path=p_path WHERE id=p_closure_id;
END $$;
REVOKE ALL ON FUNCTION public.attach_delivery_closure_receipt(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_delivery_closure_receipt(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_delivery_closure(p_closure_id uuid,p_approve boolean,p_reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.delivery_closure_submissions%ROWTYPE; reviewer text; expected_n int; changed_n int;
BEGIN
 SELECT * INTO c FROM public.delivery_closure_submissions WHERE id=p_closure_id FOR UPDATE;
 IF NOT FOUND OR c.status<>'PENDIENTE' OR c.receipt_path IS NULL THEN RAISE EXCEPTION 'Cierre no revisable o sin comprobante'; END IF;
 IF NOT (public.has_role(auth.uid(),'ADMIN') OR (c.destination_user_id=auth.uid() AND public.has_role(auth.uid(),'PROVEEDOR'))) THEN RAISE EXCEPTION 'Sin autorización'; END IF;
 SELECT email INTO reviewer FROM public.profiles WHERE user_id=auth.uid();
 IF p_approve THEN
  SELECT count(*) INTO expected_n FROM public.delivery_closure_orders WHERE closure_id=p_closure_id;
  UPDATE public.orders SET delivery_settled=true,status2='RENDIDO',delivery_paid_at=now(),updated_at=now()
  WHERE id IN (SELECT order_id FROM public.delivery_closure_orders WHERE closure_id=p_closure_id) AND NOT coalesce(delivery_settled,false);
  GET DIAGNOSTICS changed_n = ROW_COUNT;
  IF changed_n<>expected_n THEN RAISE EXCEPTION 'Los pedidos fueron modificados; no se puede aprobar'; END IF;
 END IF;
 UPDATE public.delivery_closure_submissions SET status=CASE WHEN p_approve THEN 'APROBADO' ELSE 'RECHAZADO' END,
 reviewed_at=now(),reviewed_by=reviewer,rejection_reason=CASE WHEN p_approve THEN NULL ELSE p_reason END WHERE id=p_closure_id;
END $$;
REVOKE ALL ON FUNCTION public.review_delivery_closure(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_delivery_closure(uuid,boolean,text) TO authenticated;

-- Reenviar un cierre rechazado sin duplicar pedidos.
CREATE OR REPLACE FUNCTION public.reopen_rejected_delivery_closure(p_closure_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.delivery_closure_submissions SET status='PENDIENTE',receipt_path=NULL,reviewed_at=NULL,reviewed_by=NULL,rejection_reason=NULL
 WHERE id=p_closure_id AND delivery_user_id=auth.uid() AND status='RECHAZADO';
 IF NOT FOUND THEN RAISE EXCEPTION 'No se puede reabrir este cierre'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.reopen_rejected_delivery_closure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_rejected_delivery_closure(uuid) TO authenticated;
