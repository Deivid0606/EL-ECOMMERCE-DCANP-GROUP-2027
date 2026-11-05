-- Backfill old pending sales when a seller enables global automatic import.
-- Retain all coverage, product, price, stock and idempotency checks in
-- store_auto_import_order_trigger, also used for live checkout inserts.
CREATE OR REPLACE FUNCTION public.store_auto_import_existing_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $body$
DECLARE
  v_source public.landing_page_orders%ROWTYPE;
  v_page public.landing_pages%ROWTYPE;
  v_seller_email text;
  v_seller_uid uuid;
  v_role text;
  v_product public.products%ROWTYPE;
  v_city public.client_prices%ROWTYPE;
  v_mapping_sku text;
  v_snapshot jsonb;
  v_offer jsonb;
  v_count integer;
  v_qty integer;
  v_sale numeric;
  v_cost numeric;
  v_delivery numeric;
  v_number text;
  v_destination text;
BEGIN
  SELECT * INTO v_source FROM public.landing_page_orders
    WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR coalesce(v_source.system_status,'pending') NOT IN ('pending','opened') THEN
    RETURN;
  END IF;
  SELECT * INTO v_page FROM public.landing_pages WHERE id=v_source.landing_page_id;
  IF NOT FOUND OR v_page.status <> 'published' THEN
    RETURN;
  END IF;
  BEGIN
    -- Verify the page's real owner (not any seller value sent by the buyer).
    v_seller_email := lower(trim(v_page.owner_email));
    IF v_seller_email = '' OR v_seller_email <> lower(trim(coalesce(v_source.seller_email,''))) THEN
      RAISE EXCEPTION 'El propietario de la página no coincide con el pedido';
    END IF;
    SELECT p.user_id,lower(p.role) INTO v_seller_uid,v_role
      FROM public.profiles p
      JOIN public.user_roles r ON r.user_id=p.user_id AND r.approved IS TRUE
      WHERE lower(trim(p.email))=v_seller_email
      LIMIT 1;
    IF v_seller_uid IS NULL OR v_role NOT IN ('admin','administrador','vendedor','seller') THEN
      RAISE EXCEPTION 'Cuenta desactivada o sin permiso para importar';
    END IF;
    -- ONE switch per approved seller, independent of page creation/editing.
    IF NOT EXISTS (
      SELECT 1 FROM public.store_seller_auto_import_settings s
      WHERE s.user_id=v_seller_uid AND s.enabled IS TRUE
    ) THEN
      RETURN;
    END IF;
    -- Existing import map is the idempotency key for both automatic and manual paths.
    SELECT m.destination_order_id INTO v_destination
      FROM public.store_order_imports m WHERE m.source_order_id=v_source.id;
    IF v_destination IS NOT NULL THEN RETURN; END IF;
    IF nullif(trim(coalesce(v_source.customer_name,'')),'') IS NULL
      OR nullif(trim(coalesce(v_source.phone,'')),'') IS NULL
      OR nullif(trim(coalesce(v_source.city,'')),'') IS NULL
      OR (public.store_match_key(v_source.city)<>'asuncion' AND nullif(trim(coalesce(v_source.department,'')),'') IS NULL) THEN
      RAISE EXCEPTION 'Faltan nombre, teléfono o ciudad/departamento';
    END IF;
    v_qty := v_source.quantity;
    v_sale := v_source.total_gs;
    IF v_qty IS NULL OR v_qty<1 OR v_sale IS NULL OR v_sale<=0 THEN
      RAISE EXCEPTION 'Cantidad o total inválidos';
    END IF;
    -- A buyer cannot invent a product or price through a modified network request.
    SELECT p.value INTO v_snapshot FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(v_page.config->'productSnapshots')='array'
           THEN v_page.config->'productSnapshots' ELSE '[]'::jsonb END
    ) AS p(value) WHERE p.value->>'id'=v_source.product_id LIMIT 1;
    IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Producto no pertenece a esta página'; END IF;
    IF nullif(v_source.raw_payload->>'quantity_offer_id','') IS NOT NULL THEN
      SELECT offer.value INTO v_offer FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_page.config->'quantityOffers')='array'
             THEN v_page.config->'quantityOffers' ELSE '[]'::jsonb END
      ) AS offer(value) WHERE offer.value->>'id'=v_source.raw_payload->>'quantity_offer_id' LIMIT 1;
      IF v_offer IS NULL OR v_sale<>coalesce((v_offer->>'priceGs')::numeric,-1)
        OR v_qty<>coalesce((v_offer->>'quantity')::integer,-1) THEN
        RAISE EXCEPTION 'Oferta o cantidad no coincide con la página';
      END IF;
    ELSE
      IF v_sale<>coalesce((v_snapshot->>'price')::numeric,-1)*v_qty THEN
        RAISE EXCEPTION 'Total no coincide con el precio de la página';
      END IF;
    END IF;
    -- Match current prices and existing coverage; never infer uncovered cities.
    SELECT count(*) INTO v_count FROM public.client_prices c
      WHERE public.store_match_key(c.city)=public.store_match_key(v_source.city)
      AND (public.store_match_key(v_source.city)='asuncion'
        OR (CASE WHEN public.store_match_key(c.departamento)='asuncion' THEN 'capital'
                 ELSE public.store_match_key(c.departamento) END)
          = (CASE WHEN public.store_match_key(v_source.department)='asuncion' THEN 'capital'
                 ELSE public.store_match_key(v_source.department) END))
      AND NOT (lower(trim(c.departamento))='varios'
               AND lower(trim(c.city))='interior pago anticipado');
    IF v_count<>1 THEN RAISE EXCEPTION 'Ciudad no cubierta o ambigua'; END IF;
    SELECT * INTO v_city FROM public.client_prices c
      WHERE public.store_match_key(c.city)=public.store_match_key(v_source.city)
      AND (public.store_match_key(v_source.city)='asuncion'
        OR (CASE WHEN public.store_match_key(c.departamento)='asuncion' THEN 'capital'
                 ELSE public.store_match_key(c.departamento) END)
          = (CASE WHEN public.store_match_key(v_source.department)='asuncion' THEN 'capital'
                 ELSE public.store_match_key(v_source.department) END))
      AND NOT (lower(trim(c.departamento))='varios'
               AND lower(trim(c.city))='interior pago anticipado')
      LIMIT 1;

    -- Seller-specific SKU mapping is authoritative; reject missing/inaccessible SKU.
    SELECT nullif(trim(m.sku),'') INTO v_mapping_sku
      FROM public.product_title_mappings m
      WHERE lower(trim(m.owner_email))=v_seller_email
        AND m.title_key=regexp_replace(public.store_match_key(v_source.product_title),'[^a-z0-9]','','g')
      LIMIT 1;
    SELECT count(*) INTO v_count FROM public.products p
      WHERE ((v_mapping_sku IS NOT NULL AND lower(trim(p.sku))=lower(v_mapping_sku))
        OR (v_mapping_sku IS NULL AND public.store_match_key(p.title)=public.store_match_key(v_source.product_title)))
      AND nullif(trim(p.sku),'') IS NOT NULL
      AND (v_role IN ('admin','administrador')
        OR (coalesce(p.is_private_stock,p.is_private,false)=false AND EXISTS(
          SELECT 1 FROM public.user_favorites uf
          WHERE uf.product_id=p.id AND lower(uf.user_email)=v_seller_email))
        OR (coalesce(p.is_private_stock,p.is_private,false)=true
          AND v_seller_email=ANY(string_to_array(lower(replace(coalesce(p.private_to_emails,''),' ','')),','))));
    IF v_count<>1 THEN RAISE EXCEPTION 'Producto o SKU sin asociación válida o sin acceso'; END IF;
    SELECT * INTO v_product FROM public.products p
      WHERE ((v_mapping_sku IS NOT NULL AND lower(trim(p.sku))=lower(v_mapping_sku))
        OR (v_mapping_sku IS NULL AND public.store_match_key(p.title)=public.store_match_key(v_source.product_title)))
      AND nullif(trim(p.sku),'') IS NOT NULL
      AND (v_role IN ('admin','administrador')
        OR (coalesce(p.is_private_stock,p.is_private,false)=false AND EXISTS(
          SELECT 1 FROM public.user_favorites uf
          WHERE uf.product_id=p.id AND lower(uf.user_email)=v_seller_email))
        OR (coalesce(p.is_private_stock,p.is_private,false)=true
          AND v_seller_email=ANY(string_to_array(lower(replace(coalesce(p.private_to_emails,''),' ','')),','))))
      LIMIT 1;
    v_cost := coalesce(v_product.provider_price_gs,0)*v_qty;
    v_delivery := coalesce(v_city.price_gs,0);
    v_number := 'A' || floor(extract(epoch from clock_timestamp())*1000000)::bigint::text
                  || floor(random()*1000000)::bigint::text;
    INSERT INTO public.orders(
      order_number,created_by,customer_name,phone,city,departamento,
      street,district,email,obs,items_json,total_gs,delivery_gs,
      commission_gs,provider_emails_list
    ) VALUES (
      v_number,v_seller_email,v_source.customer_name,v_source.phone,v_city.city,v_city.departamento,
      coalesce(v_source.address,''),'','',
      concat_ws(' | ','PEDIDO MI TIENDA: ' || v_source.id::text,
        nullif('Página: ' || coalesce(v_source.page_name,''),'Página: '),
        nullif('Slug: ' || coalesce(v_source.page_slug,''),'Slug: '),
        nullif('Referencia: ' || coalesce(v_source.reference,''),'Referencia: ')),
      jsonb_build_array(jsonb_build_object(
        'sku',v_product.sku,'title',v_product.title,'sale_gs',v_sale,
        'qty',v_qty,'provider_price_gs',coalesce(v_product.provider_price_gs,0),
        'provider_email',coalesce(v_product.provider_email,''))),
      v_sale,v_delivery,v_sale-v_cost-v_delivery,coalesce(v_product.provider_email,'')
    ) RETURNING id::text INTO v_destination;
    INSERT INTO public.store_order_imports(source_order_id,destination_order_id,imported_by)
      VALUES(v_source.id,v_destination,v_seller_uid);
    UPDATE public.landing_page_orders
      SET system_status='loaded',sent_to_system_at=now(),loaded_order_id=v_destination,
        raw_payload=coalesce(raw_payload,'{}'::jsonb)-'auto_import_error'
      WHERE id=v_source.id;
    BEGIN
      INSERT INTO public.news(order_id,actor_email,role_scope,message)
        VALUES(v_number,v_seller_email,upper(v_role),
          'Nuevo pedido '||v_number||' - '||v_source.customer_name||' - '||v_city.city||' - Gs '||v_sale::text);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  EXCEPTION WHEN OTHERS THEN
    -- Never lose a real submitted sale when its automatic import needs review.
    -- The inner block rolls back the destination order if anything fails.
    UPDATE public.landing_page_orders
      SET raw_payload=jsonb_set(coalesce(raw_payload,'{}'::jsonb),
        '{auto_import_error}',to_jsonb(left(SQLERRM,500)),true)
      WHERE id=v_source.id;
  END;
  RETURN;
END
$body$;
REVOKE ALL ON FUNCTION public.store_auto_import_existing_order(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.store_run_pending_auto_import_for_user(
  p_user_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $body$
DECLARE
  v_email text;
  v_processed integer := 0;
  v_order record;
BEGIN
  IF p_user_id IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Parámetros inválidos';
  END IF;
  SELECT lower(trim(p.email)) INTO v_email
    FROM public.profiles p
    JOIN public.user_roles r ON r.user_id=p.user_id AND r.approved IS TRUE
    WHERE p.user_id=p_user_id AND p.approved IS TRUE
      AND lower(p.role) IN ('admin','administrador','vendedor','seller')
    LIMIT 1;
  IF v_email IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.store_seller_auto_import_settings s
    WHERE s.user_id=p_user_id AND s.enabled IS TRUE
  ) THEN
    RETURN 0;
  END IF;

  -- Process each source in its own savepoint inside the import function,
  -- without updating the same order from an AFTER UPDATE trigger.
  FOR v_order IN
    SELECT o.id
    FROM public.landing_page_orders o
    JOIN public.landing_pages p ON p.id=o.landing_page_id
    WHERE lower(trim(o.seller_email))=v_email
      AND lower(trim(p.owner_email))=v_email
      AND p.status='published'
      AND coalesce(o.system_status,'pending') IN ('pending','opened')
      AND NOT EXISTS (
        SELECT 1 FROM public.store_order_imports m WHERE m.source_order_id=o.id
      )
    ORDER BY o.created_at DESC
    LIMIT p_limit
  LOOP
    PERFORM public.store_auto_import_existing_order(v_order.id);
    v_processed := v_processed + 1;
  END LOOP;
  RETURN v_processed;
END
$body$;
REVOKE ALL ON FUNCTION public.store_run_pending_auto_import_for_user(uuid,integer)
  FROM PUBLIC, anon, authenticated;

-- The switch remains restricted to the signed-in, approved seller.
-- When enabled, attempt the backlog immediately, without requiring a dashboard.
CREATE OR REPLACE FUNCTION public.store_set_auto_import_enabled(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $body$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Sesión o valor inválido';
  END IF;
  IF NOT public.app_account_approved() OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles r ON r.user_id=p.user_id AND r.approved IS TRUE
    WHERE p.user_id=v_uid AND lower(p.role) IN ('admin','administrador','vendedor','seller')
  ) THEN
    RAISE EXCEPTION 'Cuenta sin autorización para activar cargas automáticas';
  END IF;
  INSERT INTO public.store_seller_auto_import_settings(user_id,enabled,updated_at)
  VALUES(v_uid,p_enabled,now())
  ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now();
  IF p_enabled THEN
    PERFORM public.store_run_pending_auto_import_for_user(v_uid,100);
  END IF;
  RETURN p_enabled;
END
$body$;
REVOKE ALL ON FUNCTION public.store_set_auto_import_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_set_auto_import_enabled(boolean) TO authenticated;

-- Seller had already switched ON before the backfill behavior existed.
-- Process its existing pending orders once as part of the migration.
DO $body$
DECLARE
  v_user record;
BEGIN
  FOR v_user IN SELECT user_id FROM public.store_seller_auto_import_settings
    WHERE enabled IS TRUE
  LOOP
    PERFORM public.store_run_pending_auto_import_for_user(v_user.user_id,100);
  END LOOP;
END
$body$;
