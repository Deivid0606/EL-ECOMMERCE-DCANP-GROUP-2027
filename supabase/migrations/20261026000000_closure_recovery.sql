-- No altera ningún cierre, comprobante ni estado de pedido existente.
CREATE TABLE IF NOT EXISTS public.delivery_closure_recovery (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 delivery_user_id uuid NOT NULL REFERENCES auth.users(id),
 destination_user_id uuid NOT NULL REFERENCES auth.users(id),
 order_ids uuid[] NOT NULL,
 receipt_path text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'PREPARADO' CHECK (status IN ('PREPARADO','ARCHIVO_CARGADO','COMPLETADO')),
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.delivery_closure_recovery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS closure_recovery_read ON public.delivery_closure_recovery;
CREATE POLICY closure_recovery_read ON public.delivery_closure_recovery FOR SELECT TO authenticated USING (
 delivery_user_id=auth.uid() OR public.has_role(auth.uid(),'ADMIN')
);
DROP POLICY IF EXISTS closure_recovery_create ON public.delivery_closure_recovery;
CREATE POLICY closure_recovery_create ON public.delivery_closure_recovery FOR INSERT TO authenticated WITH CHECK (
 delivery_user_id=auth.uid() AND public.has_role(auth.uid(),'DELIVERY')
 AND cardinality(order_ids)>0
 AND receipt_path LIKE ('closure-pending/'||auth.uid()::text||'/%')
);
DROP POLICY IF EXISTS closure_recovery_update ON public.delivery_closure_recovery;
CREATE POLICY closure_recovery_update ON public.delivery_closure_recovery FOR UPDATE TO authenticated
USING (delivery_user_id=auth.uid()) WITH CHECK (delivery_user_id=auth.uid());

-- Lista de archivos huérfanos: solo administradores autenticados, sin contenido binario.
CREATE OR REPLACE FUNCTION public.list_unlinked_closure_receipts()
RETURNS TABLE(receipt_path text, uploaded_at timestamptz, delivery_user_id uuid, delivery_email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'ADMIN') THEN
   RAISE EXCEPTION 'Sin autorización';
 END IF;
 RETURN QUERY
 SELECT s.name::text, s.created_at,
        CASE WHEN split_part(s.name,'/',2) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
             THEN split_part(s.name,'/',2)::uuid ELSE NULL::uuid END,
        (SELECT u.email::text FROM auth.users u WHERE u.id::text=split_part(s.name,'/',2))
 FROM storage.objects s
 WHERE s.bucket_id='financial-receipts'
 AND s.name LIKE 'closure-pending/%'
 AND NOT EXISTS(SELECT 1 FROM public.delivery_closure_submissions c WHERE c.receipt_path=s.name)
 ORDER BY s.created_at DESC LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.list_unlinked_closure_receipts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_unlinked_closure_receipts() TO authenticated;

-- Lectura de comprobantes históricos huérfanos solo para ADMIN, sin hacer público el bucket.
DROP POLICY IF EXISTS closure_orphan_admin_read ON storage.objects;
CREATE POLICY closure_orphan_admin_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='financial-receipts' AND name LIKE 'closure-pending/%' AND public.has_role(auth.uid(),'ADMIN'));
