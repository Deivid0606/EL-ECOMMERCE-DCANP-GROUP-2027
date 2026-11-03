-- CANCELÓ POR WHATSAPP pide comentario y captura del chat (como NO CONTESTA / CANCELADO); NO DESEA se quita.
CREATE OR REPLACE FUNCTION public.bulk_update_order_status(p_order_ids uuid[], p_status text, p_message text DEFAULT NULL::text, p_attachment_url text DEFAULT NULL::text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_email text;
  v_role text;
  v_count integer := 0;
begin
  if p_order_ids is null or cardinality(p_order_ids) = 0 then
    raise exception 'No se seleccionaron pedidos';
  end if;

  if p_status not in (
    'PENDIENTE', 'EN RUTA', 'ENTREGADO', 'ENCOMIENDA ENTREGADA', 'CANCELADO', 'DEVUELTO A DEPÓSITO',
    'REAGENDADO', 'NO CONTESTA', 'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'CANCELÓ POR WHATSAPP'
  ) then
    raise exception 'Estado no válido: %', p_status;
  end if;

  v_email := public.current_profile_email();

  select upper(ur.role::text)
  into v_role
  from public.user_roles ur
  where ur.user_id = auth.uid()
    and coalesce(ur.approved, false) = true
    and upper(ur.role::text) in ('ADMIN','PROVEEDOR','DELIVERY')
  order by case upper(ur.role::text) when 'ADMIN' then 1 when 'PROVEEDOR' then 2 else 3 end
  limit 1;

  if v_role is null then
    raise exception 'No tenés permiso para cambiar estados';
  end if;

  if v_role = 'DELIVERY' and p_status = 'DEVUELTO A DEPÓSITO' then
    raise exception 'Los repartidores no pueden cambiar a DEVUELTO A DEPÓSITO';
  end if;

  if v_role = 'DELIVERY' and not public.delivery_location_fresh(v_email, 15) then
    raise exception 'UBICACION_REQUERIDA: Activá tu ubicación para reportar tus pedidos';
  end if;

  if v_role = 'DELIVERY'
     and p_status in ('NO CONTESTA','CANCELADO','CANCELÓ POR WHATSAPP')
     and (coalesce(trim(p_message), '') = '' or coalesce(trim(p_attachment_url), '') = '') then
    raise exception 'Para % el delivery debe adjuntar comentario y captura', p_status;
  end if;

  insert into public.order_status_history (order_id, previous_status, new_status, changed_by_email, changed_by_role, message, attachment_url)
  select o.id, coalesce(o.status, 'PENDIENTE'), p_status, v_email, v_role,
         nullif(trim(coalesce(p_message, '')), ''), nullif(trim(coalesce(p_attachment_url, '')), '')
  from public.orders o
  where o.id = any(p_order_ids)
    and (
      v_role = 'ADMIN'
      or (v_role = 'PROVEEDOR' and lower(coalesce(o.provider_email, '')) = v_email)
      or (v_role = 'DELIVERY' and (lower(coalesce(o.delivery_owner, '')) = v_email or lower(coalesce(o.assigned_delivery, '')) = v_email))
    );

  update public.orders o
  set status = p_status, updated_at = now()
  where o.id = any(p_order_ids)
    and (
      v_role = 'ADMIN'
      or (v_role = 'PROVEEDOR' and lower(coalesce(o.provider_email, '')) = v_email)
      or (v_role = 'DELIVERY' and (lower(coalesce(o.delivery_owner, '')) = v_email or lower(coalesce(o.assigned_delivery, '')) = v_email))
    );

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'No se pudo modificar ningún pedido seleccionado';
  end if;
  return v_count;
end;
$$;


-- NO DESEA ya no se usa: no se puede poner en pedidos nuevos (los viejos quedan igual).
CREATE OR REPLACE FUNCTION public.orders_no_desea_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF upper(coalesce(NEW.status, '')) = 'NO DESEA' AND upper(coalesce(OLD.status, '')) IS DISTINCT FROM 'NO DESEA' THEN
    RAISE EXCEPTION 'El estado NO DESEA ya no se usa: elegí CANCELADO o CANCELÓ POR WHATSAPP';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS orders_no_desea_guard ON public.orders;
CREATE TRIGGER orders_no_desea_guard BEFORE UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_no_desea_guard();
