-- Global setting: one opt-in per seller applies to all current and future pages.
-- No existing seller is activated automatically.
CREATE TABLE IF NOT EXISTS public.store_seller_auto_import_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.store_seller_auto_import_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_seller_auto_import_settings FROM PUBLIC, anon, authenticated;
-- Controlled RPCs only: no direct table access or cross-account updates.
CREATE OR REPLACE FUNCTION public.store_get_auto_import_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT coalesce((SELECT enabled FROM public.store_seller_auto_import_settings
                   WHERE user_id=(SELECT auth.uid())),false)
$fn$;
CREATE OR REPLACE FUNCTION public.store_set_auto_import_enabled(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
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
  RETURN p_enabled;
END
$fn$;
REVOKE ALL ON FUNCTION public.store_get_auto_import_enabled() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.store_set_auto_import_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_get_auto_import_enabled() TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_set_auto_import_enabled(boolean) TO authenticated;

-- Mi Tienda automatic checkout import, opted in separately on each published page.
-- Fires on the server even with no dashboard session. Never trusts buyer-provided
-- seller_email, SKU, page config, or product price as an authorization source.
CREATE OR REPLACE FUNCTION public.store_auto_import_order_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $body$
DECLARE
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
  SELECT * INTO v_page FROM public.landing_pages WHERE id=NEW.landing_page_id;
  IF NOT FOUND OR v_page.status <> 'published' THEN
    RETURN NEW;
  END IF;
  BEGIN
    -- Verify the page's real owner (not any seller value sent by the buyer).
    v_seller_email := lower(trim(v_page.owner_email));
    IF v_seller_email = '' OR v_seller_email <> lower(trim(coalesce(NEW.seller_email,''))) THEN
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
      RETURN NEW;
    END IF;
    -- Existing import map is the idempotency key for both automatic and manual paths.
    SELECT m.destination_order_id INTO v_destination
      FROM public.store_order_imports m WHERE m.source_order_id=NEW.id;
    IF v_destination IS NOT NULL THEN RETURN NEW; END IF;
    IF nullif(trim(coalesce(NEW.customer_name,'')),'') IS NULL
      OR nullif(trim(coalesce(NEW.phone,'')),'') IS NULL
      OR nullif(trim(coalesce(NEW.city,'')),'') IS NULL
      OR (public.store_match_key(NEW.city)<>'asuncion' AND nullif(trim(coalesce(NEW.department,'')),'') IS NULL) THEN
      RAISE EXCEPTION 'Faltan nombre, teléfono o ciudad/departamento';
    END IF;
    v_qty := NEW.quantity;
    v_sale := NEW.total_gs;
    IF v_qty IS NULL OR v_qty<1 OR v_sale IS NULL OR v_sale<=0 THEN
      RAISE EXCEPTION 'Cantidad o total inválidos';
    END IF;
    -- A buyer cannot invent a product or price through a modified network request.
    SELECT p.value INTO v_snapshot FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(v_page.config->'productSnapshots')='array'
           THEN v_page.config->'productSnapshots' ELSE '[]'::jsonb END
    ) AS p(value) WHERE p.value->>'id'=NEW.product_id LIMIT 1;
    IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Producto no pertenece a esta página'; END IF;
    IF nullif(NEW.raw_payload->>'quantity_offer_id','') IS NOT NULL THEN
      SELECT offer.value INTO v_offer FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_page.config->'quantityOffers')='array'
             THEN v_page.config->'quantityOffers' ELSE '[]'::jsonb END
      ) AS offer(value) WHERE offer.value->>'id'=NEW.raw_payload->>'quantity_offer_id' LIMIT 1;
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
      WHERE public.store_match_key(c.city)=public.store_match_key(NEW.city)
      AND (public.store_match_key(NEW.city)='asuncion'
        OR (CASE WHEN public.store_match_key(c.departamento)='asuncion' THEN 'capital'
                 ELSE public.store_match_key(c.departamento) END)
          = (CASE WHEN public.store_match_key(NEW.department)='asuncion' THEN 'capital'
                 ELSE public.store_match_key(NEW.department) END))
      AND NOT (lower(trim(c.departamento))='varios'
               AND lower(trim(c.city))='interior pago anticipado');
    IF v_count<>1 THEN RAISE EXCEPTION 'Ciudad no cubierta o ambigua'; END IF;
    SELECT * INTO v_city FROM public.client_prices c
      WHERE public.store_match_key(c.city)=public.store_match_key(NEW.city)
      AND (public.store_match_key(NEW.city)='asuncion'
        OR (CASE WHEN public.store_match_key(c.departamento)='asuncion' THEN 'capital'
                 ELSE public.store_match_key(c.departamento) END)
          = (CASE WHEN public.store_match_key(NEW.department)='asuncion' THEN 'capital'
                 ELSE public.store_match_key(NEW.department) END))
      AND NOT (lower(trim(c.departamento))='varios'
               AND lower(trim(c.city))='interior pago anticipado')
      LIMIT 1;

    -- Seller-specific SKU mapping is authoritative; reject missing/inaccessible SKU.
    SELECT nullif(trim(m.sku),'') INTO v_mapping_sku
      FROM public.product_title_mappings m
      WHERE lower(trim(m.owner_email))=v_seller_email
        AND m.title_key=regexp_replace(public.store_match_key(NEW.product_title),'[^a-z0-9]','','g')
      LIMIT 1;
    SELECT count(*) INTO v_count FROM public.products p
      WHERE ((v_mapping_sku IS NOT NULL AND lower(trim(p.sku))=lower(v_mapping_sku))
        OR (v_mapping_sku IS NULL AND public.store_match_key(p.title)=public.store_match_key(NEW.product_title)))
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
        OR (v_mapping_sku IS NULL AND public.store_match_key(p.title)=public.store_match_key(NEW.product_title)))
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
      v_number,v_seller_email,NEW.customer_name,NEW.phone,v_city.city,v_city.departamento,
      coalesce(NEW.address,''),'','',
      concat_ws(' | ','PEDIDO MI TIENDA: ' || NEW.id::text,
        nullif('Página: ' || coalesce(NEW.page_name,''),'Página: '),
        nullif('Slug: ' || coalesce(NEW.page_slug,''),'Slug: '),
        nullif('Referencia: ' || coalesce(NEW.reference,''),'Referencia: ')),
      jsonb_build_array(jsonb_build_object(
        'sku',v_product.sku,'title',v_product.title,'sale_gs',v_sale,
        'qty',v_qty,'provider_price_gs',coalesce(v_product.provider_price_gs,0),
        'provider_email',coalesce(v_product.provider_email,''))),
      v_sale,v_delivery,v_sale-v_cost-v_delivery,coalesce(v_product.provider_email,'')
    ) RETURNING id::text INTO v_destination;
    INSERT INTO public.store_order_imports(source_order_id,destination_order_id,imported_by)
      VALUES(NEW.id,v_destination,v_seller_uid);
    UPDATE public.landing_page_orders
      SET system_status='loaded',sent_to_system_at=now(),loaded_order_id=v_destination,
        raw_payload=coalesce(raw_payload,'{}'::jsonb)-'auto_import_error'
      WHERE id=NEW.id;
    BEGIN
      INSERT INTO public.news(order_id,actor_email,role_scope,message)
        VALUES(v_number,v_seller_email,upper(v_role),
          'Nuevo pedido '||v_number||' - '||NEW.customer_name||' - '||v_city.city||' - Gs '||v_sale::text);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  EXCEPTION WHEN OTHERS THEN
    -- Never lose a real submitted sale when its automatic import needs review.
    -- The inner block rolls back the destination order if anything fails.
    UPDATE public.landing_page_orders
      SET raw_payload=jsonb_set(coalesce(raw_payload,'{}'::jsonb),
        '{auto_import_error}',to_jsonb(left(SQLERRM,500)),true)
      WHERE id=NEW.id;
  END;
  RETURN NEW;
END
$body$;
REVOKE ALL ON FUNCTION public.store_auto_import_order_trigger() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_store_auto_import_order ON public.landing_page_orders;
CREATE TRIGGER trg_store_auto_import_order AFTER INSERT ON public.landing_page_orders
FOR EACH ROW EXECUTE FUNCTION public.store_auto_import_order_trigger();
