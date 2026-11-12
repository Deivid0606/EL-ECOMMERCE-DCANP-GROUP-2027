-- Meta CAPI Purchase: enviar más datos del cliente (cifrados con SHA-256)
-- para mejorar la coincidencia de eventos: nombre, apellido, ciudad,
-- departamento, país y external_id (teléfono cifrado).

create or replace function public.meta_norm_text(p text)
returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(
    translate(lower(coalesce(p, '')), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc'),
    '[^a-z0-9 ]', '', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.meta_sha256(p text)
returns text language sql immutable set search_path = public, extensions as $$
  select case when coalesce(p, '') = '' then null
    else encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex') end
$$;

CREATE OR REPLACE FUNCTION public.send_meta_purchase(p_order_id uuid, p_event_source_url text DEFAULT NULL::text, p_fbp text DEFAULT NULL::text, p_fbc text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions'
AS $function$
declare
  v_order public.landing_page_orders%rowtype;
  v_pixel_id text;
  v_access_token text;
  v_phone text;
  v_phone_hash text;
  v_event_id text;
  v_event_time bigint;
  v_user_data jsonb;
  v_custom_data jsonb;
  v_payload jsonb;
  v_url text;
  v_status integer;
  v_content text;
  v_response jsonb;
  v_headers jsonb;
  v_client_ip text;
  v_user_agent text;
  v_name_parts text[];
  v_hash text;
begin
  select * into v_order from public.landing_page_orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pedido inexistente');
  end if;

  if v_order.meta_capi_status = 'sent' then
    return jsonb_build_object('ok', true, 'already_sent', true,
      'event_id', coalesce(v_order.meta_event_id, 'landing-order-' || v_order.id::text));
  end if;

  select s.meta_pixel_id, c.access_token
  into v_pixel_id, v_access_token
  from public.seller_store_settings s
  join private.seller_meta_credentials c on lower(c.owner_email) = lower(s.owner_email)
  where lower(s.owner_email) = lower(v_order.seller_email)
  limit 1;

  if coalesce(trim(v_pixel_id), '') = '' or coalesce(trim(v_access_token), '') = '' then
    update public.landing_page_orders
    set meta_capi_status = 'not_configured',
        meta_capi_last_error = 'El vendedor no tiene Pixel ID + Access Token configurados.'
    where id = p_order_id;
    return jsonb_build_object('ok', false, 'error', 'Meta Pixel + CAPI no configurados para este vendedor');
  end if;

  v_event_id := 'landing-order-' || v_order.id::text;
  v_event_time := extract(epoch from coalesce(v_order.created_at, now()))::bigint;

  v_phone := public.meta_normalize_phone_py(v_order.phone);
  if v_phone <> '' then
    v_phone_hash := encode(extensions.digest(convert_to(lower(v_phone), 'UTF8'), 'sha256'), 'hex');
  end if;

  begin
    v_headers := coalesce(current_setting('request.headers', true), '{}')::jsonb;
  exception when others then
    v_headers := '{}'::jsonb;
  end;

  v_client_ip := coalesce(
    nullif(split_part(v_headers ->> 'x-forwarded-for', ',', 1), ''),
    nullif(v_headers ->> 'cf-connecting-ip', ''), '');
  v_user_agent := coalesce(v_headers ->> 'user-agent', '');

  v_user_data := '{}'::jsonb;

  if v_phone_hash is not null then
    v_user_data := v_user_data || jsonb_build_object(
      'ph', jsonb_build_array(v_phone_hash),
      'external_id', jsonb_build_array(v_phone_hash));
  end if;

  -- Datos extra del cliente (cifrados) para mejorar la coincidencia en Meta.
  v_name_parts := array_remove(string_to_array(public.meta_norm_text(v_order.customer_name), ' '), '');
  if coalesce(array_length(v_name_parts, 1), 0) >= 1 then
    v_user_data := v_user_data || jsonb_build_object('fn', jsonb_build_array(public.meta_sha256(v_name_parts[1])));
  end if;
  if coalesce(array_length(v_name_parts, 1), 0) >= 2 then
    v_user_data := v_user_data || jsonb_build_object('ln', jsonb_build_array(
      public.meta_sha256(v_name_parts[array_length(v_name_parts, 1)])));
  end if;

  v_hash := public.meta_sha256(replace(public.meta_norm_text(v_order.city), ' ', ''));
  if v_hash is not null then
    v_user_data := v_user_data || jsonb_build_object('ct', jsonb_build_array(v_hash));
  end if;

  v_hash := public.meta_sha256(replace(public.meta_norm_text(v_order.department), ' ', ''));
  if v_hash is not null then
    v_user_data := v_user_data || jsonb_build_object('st', jsonb_build_array(v_hash));
  end if;

  v_user_data := v_user_data || jsonb_build_object('country', jsonb_build_array(public.meta_sha256('py')));

  if coalesce(trim(p_fbp), '') <> '' then
    v_user_data := v_user_data || jsonb_build_object('fbp', trim(p_fbp));
  end if;
  if coalesce(trim(p_fbc), '') <> '' then
    v_user_data := v_user_data || jsonb_build_object('fbc', trim(p_fbc));
  end if;
  if v_client_ip <> '' then
    v_user_data := v_user_data || jsonb_build_object('client_ip_address', v_client_ip);
  end if;
  if v_user_agent <> '' then
    v_user_data := v_user_data || jsonb_build_object('client_user_agent', v_user_agent);
  end if;

  v_custom_data := jsonb_build_object(
    'currency', 'PYG',
    'value', coalesce(v_order.total_gs, 0),
    'content_ids', case when v_order.product_id is not null
      then jsonb_build_array(v_order.product_id::text) else '[]'::jsonb end,
    'content_name', coalesce(v_order.product_title, ''),
    'content_type', 'product',
    'num_items', greatest(1, coalesce(v_order.quantity, 1)),
    'order_id', v_order.id::text);

  v_payload := jsonb_build_object('data', jsonb_build_array(jsonb_build_object(
    'event_name', 'Purchase',
    'event_time', v_event_time,
    'event_id', v_event_id,
    'action_source', 'website',
    'event_source_url', coalesce(nullif(trim(p_event_source_url), ''), 'https://www.el-ecommercedcanpgroup.com/'),
    'user_data', v_user_data,
    'custom_data', v_custom_data)));

  update public.landing_page_orders
  set meta_event_id = v_event_id, meta_capi_status = 'sending', meta_capi_last_error = null
  where id = p_order_id;

  v_url := 'https://graph.facebook.com/' || v_pixel_id || '/events?access_token=' || v_access_token;

  begin
    select h.status, h.content into v_status, v_content
    from extensions.http_post(v_url, v_payload::text, 'application/json') as h;
  exception when others then
    update public.landing_page_orders
    set meta_capi_status = 'error', meta_capi_last_error = sqlerrm
    where id = p_order_id;
    return jsonb_build_object('ok', false, 'event_id', v_event_id, 'error', sqlerrm);
  end;

  begin
    v_response := coalesce(v_content, '{}')::jsonb;
  exception when others then
    v_response := jsonb_build_object('raw', coalesce(v_content, ''));
  end;

  if v_status between 200 and 299 and not (v_response ? 'error') then
    update public.landing_page_orders
    set meta_event_id = v_event_id, meta_capi_status = 'sent', meta_capi_sent_at = now(),
        meta_capi_last_error = null, meta_capi_response = v_response
    where id = p_order_id;
    return jsonb_build_object('ok', true, 'event_id', v_event_id, 'http_status', v_status, 'meta', v_response);
  end if;

  update public.landing_page_orders
  set meta_event_id = v_event_id, meta_capi_status = 'error',
      meta_capi_last_error = coalesce(v_response #>> '{error,message}',
        'Meta respondió HTTP ' || coalesce(v_status::text, 'desconocido')),
      meta_capi_response = v_response
  where id = p_order_id;

  return jsonb_build_object('ok', false, 'event_id', v_event_id, 'http_status', v_status,
    'error', coalesce(v_response #>> '{error,message}', 'Meta rechazó el evento'), 'meta', v_response);
end;
$function$;
