-- El despachante ve los productos de los proveedores que despacha (también privados u ocultos),
-- y el producto de un pedido se encuentra por nombre exacto si su SKU cambió.
DROP POLICY IF EXISTS ver_productos_segun_privacidad ON public.products;
CREATE POLICY ver_productos_segun_privacidad ON public.products FOR SELECT USING (
  (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'))
  OR lower(provider_email) = lower(auth.jwt() ->> 'email')
  OR (public.has_role(auth.uid(), 'DESPACHANTE')
      AND (cardinality(public.my_dispatch_providers()) = 0 OR lower(coalesce(provider_email, '')) = ANY (public.my_dispatch_providers())))
  OR (NOT is_hidden AND (
        COALESCE(is_private_stock, is_private, false) = false
        OR lower(auth.jwt() ->> 'email') = ANY (string_to_array(lower(replace(COALESCE(private_to_emails, ''), ' ', '')), ','))
  ))
);

CREATE OR REPLACE FUNCTION public.order_item_product(item jsonb)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT p.id FROM public.products p
  WHERE p.id::text = coalesce(item->>'product_id', item->>'id', '')
     OR (coalesce(trim(item->>'sku'), '') <> '' AND lower(trim(p.sku)) = lower(trim(item->>'sku')))
     OR (coalesce(trim(item->>'title'), '') <> '' AND lower(trim(p.title)) = lower(trim(item->>'title')))
  ORDER BY (p.id::text = coalesce(item->>'product_id', item->>'id', '')) DESC,
           (lower(trim(coalesce(p.sku, ''))) = lower(trim(coalesce(item->>'sku', '')))) DESC,
           (lower(coalesce(p.provider_email, '')) = lower(coalesce(item->>'provider_email', ''))) DESC,
           (lower(trim(coalesce(p.title, ''))) = lower(trim(coalesce(item->>'title', '')))) DESC,
           p.created_at
  LIMIT 1;
$function$;
