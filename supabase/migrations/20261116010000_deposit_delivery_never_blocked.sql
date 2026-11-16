-- Entregas de pedidos con guía (depósito): nunca se traban por stock mal cargado; queda en negativo y se anota.
CREATE OR REPLACE FUNCTION public.apply_order_stock_internal(p_order_id uuid, p_source text, p_actor text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.orders;
  item jsonb;
  pid uuid;
  qty integer;
  delivery text;
  ds_qty integer;
  from_delivery integer;
  rest integer;
  cur_stock integer;
  cur_real integer;
  take_stock integer;
  take_real integer;
  ptitle text;
  src text;
  short boolean := false;
  lines jsonb := '[]'::jsonb;
  missing jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido no encontrado'); END IF;
  IF upper(trim(coalesce(o.status, ''))) NOT IN ('ENTREGADO','ENCOMIENDA ENTREGADA') THEN
    RAISE EXCEPTION 'El stock solo se descuenta cuando el pedido está ENTREGADO o ENCOMIENDA ENTREGADA';
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_stock_ledger WHERE order_id = p_order_id AND reverted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  IF coalesce((SELECT sum(quantity_change) FROM public.delivery_stock_movements WHERE order_id = p_order_id), 0) < 0 THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'legacy', true);
  END IF;

  PERFORM set_config('app.skip_stock_log', '1', true);

  delivery := nullif(lower(trim(coalesce(o.assigned_delivery, o.delivery_email, ''))), '');
  -- Pedidos con guía de antes de este cambio (sin origen guardado) también salen del depósito.
  src := upper(coalesce(o.stock_source, CASE WHEN upper(coalesce(o.status2, '')) = 'GUIA GENERADA' THEN 'DEPOSITO' END, ''));
  IF src = 'DELIVERY' AND delivery IS NULL THEN
    RAISE EXCEPTION 'Despachado por repartidor: el pedido no tiene delivery asignado';
  END IF;

  FOR item IN
    SELECT e FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(o.items_json) = 'array' AND jsonb_array_length(o.items_json) > 0 THEN o.items_json
           ELSE jsonb_build_array(jsonb_build_object('product_id', o.product_id, 'sku', o.sku, 'qty', coalesce(o.pack_qty, 1)))
      END) e
  LOOP
    pid := public.order_item_product(item);
    qty := greatest(1, coalesce(nullif(item->>'qty', '')::numeric, nullif(item->>'quantity', '')::numeric, 1)::integer);
    IF pid IS NULL THEN
      missing := missing || jsonb_build_array(coalesce(item->>'sku', item->>'title', '?'));
      CONTINUE;
    END IF;
    SELECT coalesce(nullif(trim(title), ''), sku, pid::text) INTO ptitle FROM public.products WHERE id = pid;

    from_delivery := 0;
    ds_qty := NULL;
    short := false;
    IF src = 'DELIVERY' THEN
      SELECT quantity INTO ds_qty FROM public.delivery_stock
      WHERE lower(delivery_email) = delivery AND product_id = pid FOR UPDATE;
      IF coalesce(ds_qty, 0) < qty THEN
        RAISE EXCEPTION 'Sin stock del repartidor: tiene % de «%» y el pedido necesita %', coalesce(ds_qty, 0), ptitle, qty;
      END IF;
      from_delivery := qty;
      UPDATE public.delivery_stock SET quantity = quantity - qty, updated_at = now()
      WHERE lower(delivery_email) = delivery AND product_id = pid;
    ELSIF src = '' AND delivery IS NOT NULL THEN
      -- Pedidos viejos sin origen: como antes (primero el stock del delivery si tiene).
      SELECT quantity INTO ds_qty FROM public.delivery_stock
      WHERE lower(delivery_email) = delivery AND product_id = pid FOR UPDATE;
      IF coalesce(ds_qty, 0) > 0 THEN
        IF ds_qty < qty THEN
          RAISE EXCEPTION 'Stock insuficiente del delivery para «%»: tiene %, se requieren %', ptitle, ds_qty, qty;
        END IF;
        from_delivery := qty;
        UPDATE public.delivery_stock SET quantity = quantity - qty, updated_at = now()
        WHERE lower(delivery_email) = delivery AND product_id = pid;
      END IF;
    END IF;

    rest := qty - from_delivery;
    take_stock := 0;
    take_real := 0;
    IF rest > 0 THEN
      SELECT coalesce(stock, 0), coalesce(real_stock, 0) INTO cur_stock, cur_real FROM public.products WHERE id = pid FOR UPDATE;
      -- El paquete ya salió del depósito: la entrega nunca se traba por un conteo mal cargado.
      -- Si no alcanza, el stock queda en negativo y se anota para que el proveedor lo corrija.
      short := coalesce(cur_stock,0) < rest OR coalesce(cur_real,0) < rest;
      take_stock := rest;
      take_real := rest;
      UPDATE public.products SET stock = coalesce(stock, 0) - take_stock, real_stock = coalesce(real_stock, 0) - take_real, updated_at = now()
      WHERE id = pid;
    END IF;

    INSERT INTO public.order_stock_ledger(order_id, product_id, delivery_email, qty_delivery, qty_global, qty_stock, qty_real_stock, source, applied_by)
    VALUES (p_order_id, pid, CASE WHEN from_delivery > 0 THEN delivery END, from_delivery, rest, take_stock, take_real, p_source, p_actor);

    INSERT INTO public.delivery_stock_movements(delivery_email, product_id, quantity_change, reason, order_id)
    VALUES (coalesce(delivery, 'GLOBAL'), pid, -qty,
            '📦 ' || p_source || ' · ' || CASE WHEN from_delivery = qty THEN 'stock del delivery'
                                              WHEN from_delivery > 0 THEN from_delivery || ' del delivery + ' || rest || ' global'
                                              ELSE 'stock global' END
            || CASE WHEN short THEN ' · ⚠️ el depósito no tenía stock cargado (quedó en negativo)' ELSE '' END,
            p_order_id);

    lines := lines || jsonb_build_object('product_id', pid, 'qty', qty, 'delivery', from_delivery, 'global', rest);
  END LOOP;

  PERFORM set_config('app.skip_stock_log', '0', true);
  RETURN jsonb_build_object('ok', jsonb_array_length(lines) > 0, 'lines', lines, 'missing', missing);
END; $function$;
