-- Desasignar un reagendado repone el stock descontado; admin elimina pedidos de un vendedor en lote.
CREATE OR REPLACE FUNCTION public.release_rescheduled_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o public.orders; me public.profiles; restored integer := 0;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF NOT public.can_edit_order_items(o) THEN RAISE EXCEPTION 'Sólo el proveedor o el admin pueden desasignar'; END IF;
  IF upper(coalesce(o.status, '')) <> 'REAGENDADO' THEN RAISE EXCEPTION 'El pedido no está REAGENDADO'; END IF;
  IF coalesce(o.assigned_delivery, '') = '' THEN RAISE EXCEPTION 'El pedido ya no tiene delivery'; END IF;
  SELECT * INTO me FROM public.profiles WHERE user_id = auth.uid();

  restored := public.revert_order_stock_internal(p_order_id, 'Reagendado ' || coalesce(to_char(o.rescheduled_for, 'DD/MM'), '') || ' · desasignado');

  UPDATE public.orders
  SET assigned_delivery = NULL, delivery_owner = NULL, assigned_team_member = NULL, assigned_at = NULL,
      status2 = NULL, updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_status_history(order_id, previous_status, new_status, changed_by_email, changed_by_name, changed_by_role, message, event_type)
  VALUES (p_order_id, o.status, o.status, me.email, me.name, 'PROVEEDOR',
          '↩️ Desasignado de ' || o.assigned_delivery || '. Vuelve a Despacho' ||
          coalesce(' el ' || to_char(o.rescheduled_for, 'DD/MM'), '') || ' para despacharse de nuevo.' ||
          CASE WHEN restored > 0 THEN ' Stock repuesto.' ELSE '' END,
          'release');
  RETURN jsonb_build_object('ok', true, 'rescheduled_for', o.rescheduled_for, 'stock_restored', restored);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_delete_seller_orders(p_seller_email text, p_order_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o public.orders; seller text := lower(trim(coalesce(p_seller_email, ''))); deleted int := 0; skipped jsonb := '[]'::jsonb; why text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN RAISE EXCEPTION 'Sólo el administrador puede eliminar pedidos en lote'; END IF;
  IF seller = '' THEN RAISE EXCEPTION 'Elegí el vendedor'; END IF;
  IF coalesce(array_length(p_order_ids, 1), 0) = 0 OR array_length(p_order_ids, 1) > 2000 THEN RAISE EXCEPTION 'Seleccioná entre 1 y 2000 pedidos'; END IF;

  FOR o IN SELECT * FROM public.orders WHERE id = ANY(p_order_ids) FOR UPDATE LOOP
    why := NULL;
    IF lower(coalesce(o.created_by, '')) <> seller THEN why := 'es de otro vendedor';
    ELSIF upper(coalesce(o.status, '')) IN ('ENTREGADO', 'ENCOMIENDA ENTREGADA') THEN why := 'ya fue entregado';
    ELSIF coalesce(o.commission_paid, false) THEN why := 'comisión ya pagada';
    ELSIF coalesce(o.delivery_settled, false) OR upper(coalesce(o.status2, '')) = 'RENDIDO' THEN why := 'ya fue rendido';
    ELSIF EXISTS (SELECT 1 FROM public.delivery_closure_orders c WHERE c.order_id = o.id) THEN why := 'está en un cierre';
    END IF;
    IF why IS NOT NULL THEN
      skipped := skipped || jsonb_build_object('order_number', o.order_number, 'why', why);
      CONTINUE;
    END IF;
    PERFORM public.revert_order_stock_internal(o.id, 'Pedido eliminado por admin');
    DELETE FROM public.orders WHERE id = o.id;
    deleted := deleted + 1;
  END LOOP;
  RETURN jsonb_build_object('deleted', deleted, 'skipped', skipped);
END; $$;
REVOKE ALL ON FUNCTION public.admin_delete_seller_orders(text, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_seller_orders(text, uuid[]) TO authenticated;
