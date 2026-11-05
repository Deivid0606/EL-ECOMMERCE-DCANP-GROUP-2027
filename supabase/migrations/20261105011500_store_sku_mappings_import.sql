-- Reuse existing import protections, fees, status, and per-order subtransactions.
-- Prefer seller-owned SKU mapping, falling back to exact product title only when unmapped.
CREATE OR REPLACE FUNCTION public.import_store_orders(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(nullif(auth.jwt()->>'email',''));
  v_role text;
  v_id uuid;
  v_source public.landing_page_orders%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_city public.client_prices%ROWTYPE;
  v_product_count integer;
  v_mapping_sku text;
  v_city_count integer;
  v_qty integer;
  v_sale numeric;
  v_cost numeric;
  v_delivery numeric;
  v_order_number text;
  v_dest_id text;
  v_existing text;
  v_result jsonb := '[]'::jsonb;
  v_one jsonb;
BEGIN
  IF v_uid IS NULL OR v_email IS NULL THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  IF NOT public.app_account_approved() THEN RAISE EXCEPTION 'Cuenta desactivada: no podés importar pedidos'; END IF;
  IF p_ids IS NULL OR cardinality(p_ids)=0 OR cardinality(p_ids)>100 THEN
    RAISE EXCEPTION 'Seleccioná entre 1 y 100 pedidos por lote';
  END IF;
  SELECT lower(role::text) INTO v_role FROM public.profiles
   WHERE lower(email) = v_email LIMIT 1;
  IF v_role IS NULL OR v_role NOT IN ('admin','administrador','vendedor','seller') THEN
    RAISE EXCEPTION 'El perfil no tiene permiso para importar pedidos';
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    BEGIN
      -- Bloquea este origen: los clics simultáneos no generan dos pedidos.
      SELECT * INTO v_source FROM public.landing_page_orders
       WHERE id=v_id AND lower(seller_email)=v_email FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado o no pertenece a tu usuario'; END IF;
      SELECT destination_order_id INTO v_existing FROM public.store_order_imports
       WHERE source_order_id=v_id;
      IF FOUND THEN
        v_one := jsonb_build_object('id',v_id,'status','already_loaded','order_id',v_existing);
      ELSE
        IF lower(coalesce(v_source.system_status,'')) IN ('loaded','created','saved','imported') THEN
          RAISE EXCEPTION 'El origen ya figura cargado; verificá su vínculo antes de repetir';
        END IF;
        IF nullif(trim(v_source.customer_name),'') IS NULL OR
           nullif(trim(v_source.phone),'') IS NULL OR
           nullif(trim(v_source.city),'') IS NULL OR
           (public.store_match_key(v_source.city)<>'asuncion' AND nullif(trim(v_source.department),'') IS NULL) THEN
          RAISE EXCEPTION 'Faltan datos del cliente, ciudad o departamento';
        END IF;
        v_qty := v_source.quantity;
        v_sale := v_source.total_gs;
        IF v_qty IS NULL OR v_qty < 1 OR v_sale IS NULL OR v_sale <= 0 THEN
          RAISE EXCEPTION 'Cantidad o precio inválido';
        END IF;
        -- Exactamente una ciudad + departamento, desde la tabla oficial.
        SELECT count(*) INTO v_city_count FROM public.client_prices c
         WHERE public.store_match_key(c.city)=public.store_match_key(v_source.city)
           AND (public.store_match_key(v_source.city)='asuncion'
             OR ((CASE WHEN public.store_match_key(c.departamento)='asuncion' THEN 'capital'
                        ELSE public.store_match_key(c.departamento) END)
               = (CASE WHEN public.store_match_key(v_source.department)='asuncion' THEN 'capital'
                       ELSE public.store_match_key(v_source.department) END)));
        IF v_city_count <> 1 THEN RAISE EXCEPTION 'Ciudad/departamento sin coincidencia única en cobertura'; END IF;
        SELECT * INTO v_city FROM public.client_prices c
         WHERE public.store_match_key(c.city)=public.store_match_key(v_source.city)
           AND (public.store_match_key(v_source.city)='asuncion'
             OR ((CASE WHEN public.store_match_key(c.departamento)='asuncion' THEN 'capital'
                        ELSE public.store_match_key(c.departamento) END)
               = (CASE WHEN public.store_match_key(v_source.department)='asuncion' THEN 'capital'
                       ELSE public.store_match_key(v_source.department) END)))
         LIMIT 1;

        -- Asociación explícita por vendedor tiene prioridad sobre coincidencia por título.
        -- Las claves se normalizan igual que en el formulario (sin espacios ni signos).
        SELECT nullif(trim(m.sku), '') INTO v_mapping_sku
          FROM public.product_title_mappings m
          WHERE lower(trim(m.owner_email)) = v_email
            AND m.title_key = regexp_replace(public.store_match_key(v_source.product_title), '[^a-z0-9]', '', 'g')
          LIMIT 1;
        -- SKU inexistente o inaccesible se rechaza, nunca se sustituye silenciosamente.
        -- Sin asociación guardada se conserva la coincidencia exacta del título.
        SELECT count(*) INTO v_product_count FROM public.products p
         WHERE (
             (v_mapping_sku IS NOT NULL AND lower(trim(p.sku))=lower(v_mapping_sku))
             OR (v_mapping_sku IS NULL AND public.store_match_key(p.title)=public.store_match_key(v_source.product_title))
           )
           AND nullif(trim(p.sku),'') IS NOT NULL
           AND (v_role IN ('admin','administrador') OR
             (coalesce(p.is_private_stock,p.is_private,false)=false
                AND EXISTS (SELECT 1 FROM public.user_favorites uf
                  WHERE uf.product_id=p.id AND lower(uf.user_email)=v_email)) OR
             (coalesce(p.is_private_stock,p.is_private,false)=true
                AND v_email=ANY(string_to_array(lower(replace(coalesce(p.private_to_emails,''),' ','')),','))));
        IF v_product_count <> 1 THEN RAISE EXCEPTION 'Producto no encontrado, ambiguo o sin acceso'; END IF;
        SELECT * INTO v_product FROM public.products p
         WHERE (
             (v_mapping_sku IS NOT NULL AND lower(trim(p.sku))=lower(v_mapping_sku))
             OR (v_mapping_sku IS NULL AND public.store_match_key(p.title)=public.store_match_key(v_source.product_title))
           )
           AND nullif(trim(p.sku),'') IS NOT NULL
           AND (v_role IN ('admin','administrador') OR
             (coalesce(p.is_private_stock,p.is_private,false)=false
                AND EXISTS (SELECT 1 FROM public.user_favorites uf
                  WHERE uf.product_id=p.id AND lower(uf.user_email)=v_email)) OR
             (coalesce(p.is_private_stock,p.is_private,false)=true
                AND v_email=ANY(string_to_array(lower(replace(coalesce(p.private_to_emails,''),' ','')),','))))
         LIMIT 1;
        v_cost := coalesce(v_product.provider_price_gs,0)*v_qty;
        v_delivery := coalesce(v_city.price_gs,0);
        v_order_number := 'A' || floor(extract(epoch from clock_timestamp())*1000000)::bigint::text ||
                          floor(random()*1000000)::bigint::text;
        INSERT INTO public.orders (
          order_number, created_by, customer_name, phone, city, departamento,
          street, district, email, obs, items_json, total_gs, delivery_gs,
          commission_gs, provider_emails_list
        ) VALUES (
          v_order_number, v_email, v_source.customer_name, v_source.phone,
          v_city.city, v_city.departamento, coalesce(v_source.address,''), '', '',
          concat_ws(' | ', 'PEDIDO MI TIENDA: ' || v_source.id::text,
            nullif('Página: ' || coalesce(v_source.page_name,''),'Página: '),
            nullif('Slug: ' || coalesce(v_source.page_slug,''),'Slug: '),
            nullif('Referencia: ' || coalesce(v_source.reference,''),'Referencia: ')),
          jsonb_build_array(jsonb_build_object(
            'sku',v_product.sku,'title',v_product.title,'sale_gs',v_sale,
            'qty',v_qty,'provider_price_gs',coalesce(v_product.provider_price_gs,0),
            'provider_email',coalesce(v_product.provider_email,''))),
          v_sale, v_delivery, v_sale-v_cost-v_delivery,
          coalesce(v_product.provider_email,'')
        ) RETURNING id::text INTO v_dest_id;
        INSERT INTO public.store_order_imports(source_order_id,destination_order_id,imported_by)
          VALUES (v_id,v_dest_id,v_uid);
        UPDATE public.landing_page_orders SET system_status='loaded',sent_to_system_at=now()
          WHERE id=v_id;
        -- news es un efecto secundario opcional; un fallo no deshace el pedido.
        BEGIN
          INSERT INTO public.news(order_id,actor_email,role_scope,message)
          VALUES (v_order_number,v_email,upper(v_role),
            'Nuevo pedido '||v_order_number||' - '||v_source.customer_name||' - '||v_city.city||' - Gs '||v_sale::text);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        v_one := jsonb_build_object('id',v_id,'status','loaded','order_id',v_dest_id,'order_number',v_order_number);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- El bloque interior es una subtransacción: revierte ese pedido, no todo el lote.
      v_one := jsonb_build_object('id',v_id,'status','error','message',SQLERRM);
    END;
    v_result := v_result || jsonb_build_array(v_one);
  END LOOP;
  RETURN v_result;
END;
$function$

