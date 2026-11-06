-- Guide generation and assignment never consume inventory.
-- Delivery inventory is consumed only on confirmed delivery, otherwise global inventory.
-- A delivery with stock must provide the whole quantity; never mix its own stock with global.
CREATE OR REPLACE FUNCTION public.apply_order_stock_internal(p_order_id uuid, p_source text, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

    from_delivery := 0;
    IF delivery IS NOT NULL THEN
      SELECT quantity INTO ds_qty FROM public.delivery_stock
      WHERE lower(delivery_email) = delivery AND product_id = pid FOR UPDATE;
      IF coalesce(ds_qty, 0) > 0 THEN
        IF ds_qty < qty THEN
          RAISE EXCEPTION 'Stock insuficiente del delivery para el producto %: tiene %, se requieren %', pid, ds_qty, qty;
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
      IF coalesce(cur_stock,0) < rest OR coalesce(cur_real,0) < rest THEN
        RAISE EXCEPTION 'Stock insuficiente para entregar el producto % (necesita %, disponible stock % / real %)', pid, rest, coalesce(cur_stock,0), coalesce(cur_real,0);
      END IF;
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
                                              ELSE 'stock global' END,
            p_order_id);

    lines := lines || jsonb_build_object('product_id', pid, 'qty', qty, 'delivery', from_delivery, 'global', rest);
  END LOOP;

  PERFORM set_config('app.skip_stock_log', '0', true);
  RETURN jsonb_build_object('ok', jsonb_array_length(lines) > 0, 'lines', lines, 'missing', missing);
END; $function$

CREATE OR REPLACE FUNCTION public.apply_order_stock(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE me text; allowed boolean;
BEGIN
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text IN ('ADMIN', 'DESPACHANTE'))
      OR EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND me IS NOT NULL AND lower(coalesce(provider_email, '')) LIKE '%' || me || '%')
    INTO allowed;
  IF NOT coalesce(allowed, false) THEN RAISE EXCEPTION 'No tenés permiso para descontar stock de este pedido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id=p_order_id AND upper(trim(coalesce(status,''))) IN ('ENTREGADO','ENCOMIENDA ENTREGADA')) THEN
    RAISE EXCEPTION 'No se puede descontar stock al generar guía; solo al entregar el pedido';
  END IF;
  RETURN public.apply_order_stock_internal(p_order_id, 'ENTREGADO', me);
END; $function$

CREATE OR REPLACE FUNCTION public.order_stock_status_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE new_s text := upper(trim(coalesce(NEW.status, ''))); old_s text := upper(trim(coalesce(OLD.status, '')));
BEGIN
  IF new_s IS NOT DISTINCT FROM old_s THEN RETURN NEW; END IF;
  BEGIN
    IF new_s IN ('ENTREGADO', 'ENCOMIENDA ENTREGADA') THEN
      PERFORM public.apply_order_stock_internal(NEW.id, new_s, (SELECT lower(email) FROM public.profiles WHERE user_id = auth.uid()));
    ELSIF old_s IN ('ENTREGADO','ENCOMIENDA ENTREGADA') OR new_s = 'DEVUELTO A DEPÓSITO' THEN
      PERFORM public.revert_order_stock_internal(NEW.id, new_s);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'No se pudo actualizar el stock del pedido %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END; $function$

CREATE OR REPLACE FUNCTION public.orders_guide_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard$
BEGIN
  -- Generar una guía no descuenta ni exige descontar stock. Se valida al entregar.
  IF upper(coalesce(NEW.status2,''))='GUIA GENERADA'
    AND upper(coalesce(OLD.status2,'')) IS DISTINCT FROM 'GUIA GENERADA' THEN
    NEW.guide_generated_at := now();
  ELSIF coalesce(NEW.status2,'--') IN ('--','') THEN
    NEW.guide_generated_at := NULL;
  END IF;
  RETURN NEW;
END $guard$;
CREATE OR REPLACE FUNCTION public.orders_rescheduled_unassign_cleanup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $unassign$
BEGIN
  IF nullif(trim(coalesce(OLD.assigned_delivery,'')),'') IS NOT NULL
     AND nullif(trim(coalesce(NEW.assigned_delivery,'')),'') IS NULL
     AND upper(trim(coalesce(NEW.status,'')))='REAGENDADO' THEN
    IF NEW.rescheduled_for IS NULL THEN
      RAISE EXCEPTION 'El pedido REAGENDADO debe tener una fecha antes de desasignar el delivery';
    END IF;
    -- All ordinary unassign controls share the same behavior.
    NEW.delivery_owner := NULL;
    NEW.assigned_team_member := NULL;
    NEW.assigned_at := NULL;
    NEW.status2 := NULL;
    NEW.guide_generated_at := NULL;
  END IF;
  RETURN NEW;
END $unassign$;
REVOKE ALL ON FUNCTION public.orders_rescheduled_unassign_cleanup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_orders_rescheduled_unassign_cleanup ON public.orders;
CREATE TRIGGER trg_orders_rescheduled_unassign_cleanup
BEFORE UPDATE OF assigned_delivery ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_rescheduled_unassign_cleanup();
