-- Directorio limitado de vendedores que realmente tienen comisiones rendidas no pagadas.
-- No expone perfiles de deliveries ni de otros roles al proveedor.
CREATE OR REPLACE FUNCTION public.commission_payable_sellers()
RETURNS TABLE(email text, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_email text;
  can_admin boolean;
  can_provider boolean;
BEGIN
  IF caller_id IS NULL THEN RETURN; END IF;
  SELECT lower(trim(p.email)) INTO caller_email
    FROM public.profiles p WHERE p.user_id = caller_id LIMIT 1;
  SELECT coalesce(bool_or(r.role = 'ADMIN'::public.app_role AND r.approved),false),
         coalesce(bool_or(r.role = 'PROVEEDOR'::public.app_role AND r.approved),false)
    INTO can_admin, can_provider
    FROM public.user_roles r WHERE r.user_id = caller_id;
  IF NOT (coalesce(can_admin,false) OR coalesce(can_provider,false))
     OR coalesce(caller_email,'') = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT lower(trim(p.email))::text,
         coalesce(nullif(trim(p.name),''),p.email)::text
    FROM public.user_roles seller_role
    JOIN public.profiles p ON p.user_id = seller_role.user_id
    JOIN public.orders o ON lower(trim(o.created_by)) = lower(trim(p.email))
   WHERE seller_role.role = 'VENDEDOR'::public.app_role
     AND seller_role.approved = true
     AND p.deleted_at IS NULL
     AND o.status IN ('ENTREGADO','ENCOMIENDA ENTREGADA')
     AND upper(trim(coalesce(o.status2,''))) = 'RENDIDO'
     AND coalesce(o.commission_paid,false) = false
     AND coalesce(o.commission_gs,0) > 0
     AND (
       can_admin
       OR lower(trim(coalesce(o.provider_email,''))) = caller_email
       OR caller_email = ANY(
          regexp_split_to_array(lower(trim(coalesce(o.provider_emails_list,''))), '[,;[:space:]]+')
       )
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(o.items_json) = 'array'
             THEN o.items_json ELSE '[]'::jsonb END
         ) AS product_item(item)
         JOIN public.products product ON trim(product_item.item->>'sku') = trim(product.sku)
         WHERE lower(trim(coalesce(product.provider_email,''))) = caller_email
       )
     )
   ORDER BY 2;
END;
$$;
REVOKE ALL ON FUNCTION public.commission_payable_sellers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commission_payable_sellers() TO authenticated;
COMMENT ON FUNCTION public.commission_payable_sellers IS 'Lista solo vendedores activos con comisiones rendidas no pagadas, restringida a admin/proveedor autorizado.';
