-- 🛵 «DESPACHADO POR REPARTIDOR»: el pedido sale del stock que tiene el repartidor.
-- «GUIA GENERADA»: el pedido sale del depósito (stock del proveedor).
-- Cada pedido recuerda de dónde sale (stock_source), aunque después pase a RENDIDO.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stock_source text;
DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT orders_stock_source_check CHECK (stock_source IN ('DEPOSITO', 'DELIVERY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estado 2 → de dónde sale el stock (y hora de despacho).
CREATE OR REPLACE FUNCTION public.orders_guide_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s text := upper(coalesce(NEW.status2, ''));
BEGIN
  -- Generar una guía / despachar no descuenta stock. Se descuenta al entregar.
  IF s IN ('GUIA GENERADA', 'DESPACHADO POR REPARTIDOR') AND upper(coalesce(OLD.status2, '')) IS DISTINCT FROM s THEN
    NEW.guide_generated_at := now();
  ELSIF coalesce(NEW.status2, '--') IN ('--', '') THEN
    NEW.guide_generated_at := NULL;
  END IF;
  IF s = 'GUIA GENERADA' THEN
    NEW.stock_source := 'DEPOSITO';
  ELSIF s = 'DESPACHADO POR REPARTIDOR' THEN
    NEW.stock_source := 'DELIVERY';
  ELSIF s IN ('', '--') THEN
    NEW.stock_source := NULL;
  END IF;
  RETURN NEW;
END $function$;

-- Encomienda: tampoco se despacha por repartidor sin el comprobante aprobado.
CREATE OR REPLACE FUNCTION public.orders_encomienda_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  NEW.shipping_type := upper(coalesce(nullif(trim(NEW.shipping_type), ''), 'DELIVERY'));
  IF TG_OP = 'INSERT' THEN
    -- "INTERIOR PAGO ANTICIPADO" siempre es encomienda con comprobante.
    IF coalesce(NEW.city, '') ~* 'pago\s*anticipado' THEN
      NEW.shipping_type := 'ENCOMIENDA';
    END IF;
    IF NEW.shipping_type = 'ENCOMIENDA' THEN
      IF coalesce(NEW.payment_proof_path, '') = '' THEN
        RAISE EXCEPTION 'Pedido por encomienda / interior pago anticipado: falta el comprobante de pago';
      END IF;
      NEW.payment_status := 'PENDIENTE';
      NEW.payment_reviewed_by := NULL; NEW.payment_reviewed_at := NULL; NEW.payment_review_note := NULL;
    ELSE
      NEW.payment_status := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('dcanp.payment_review', true) IS DISTINCT FROM '1' THEN
    NEW.payment_status := OLD.payment_status;
    NEW.payment_reviewed_by := OLD.payment_reviewed_by;
    NEW.payment_reviewed_at := OLD.payment_reviewed_at;
    NEW.payment_review_note := OLD.payment_review_note;
    NEW.shipping_type := OLD.shipping_type;
    IF NEW.payment_proof_path IS DISTINCT FROM OLD.payment_proof_path AND OLD.shipping_type = 'ENCOMIENDA' THEN
      NEW.payment_status := 'PENDIENTE';
    END IF;
  END IF;

  IF NEW.shipping_type = 'ENCOMIENDA'
     AND coalesce(NEW.payment_status, '') <> 'APROBADO'
     AND NEW.status2 IS DISTINCT FROM OLD.status2
     AND (upper(coalesce(NEW.status2, '')) LIKE 'GUIA%' OR upper(coalesce(NEW.status2, '')) = 'DESPACHADO POR REPARTIDOR') THEN
    RAISE EXCEPTION 'Encomienda: primero hay que aprobar el comprobante de pago';
  END IF;
  RETURN NEW;
END $function$;

-- Al entregar: DEPOSITO → sólo stock del proveedor; DELIVERY → sólo stock del repartidor
-- (si no le alcanza, no se puede entregar). Sin origen: como antes.
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
      IF coalesce(cur_stock,0) < rest OR coalesce(cur_real,0) < rest THEN
        RAISE EXCEPTION 'Stock insuficiente en el depósito para «%» (necesita %, disponible stock % / real %)', ptitle, rest, coalesce(cur_stock,0), coalesce(cur_real,0);
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
END; $function$;

-- ↩️ Quitar RENDIDO vuelve al Estado 2 que corresponde (guía o despachado por repartidor).
CREATE OR REPLACE FUNCTION public.unmark_rendido(p_order_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text := public.current_profile_email(); v_role text; v_ok uuid[]; v_skipped int;
BEGIN
  SELECT upper(ur.role::text) INTO v_role FROM public.user_roles ur
  WHERE ur.user_id = auth.uid() AND coalesce(ur.approved, false) AND upper(ur.role::text) IN ('ADMIN', 'PROVEEDOR')
  ORDER BY CASE upper(ur.role::text) WHEN 'ADMIN' THEN 1 ELSE 2 END LIMIT 1;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Solo admin o proveedor pueden quitar RENDIDO'; END IF;

  SELECT coalesce(array_agg(o.id), '{}') INTO v_ok FROM public.orders o
  WHERE o.id = ANY (p_order_ids)
    AND (coalesce(o.delivery_settled, false) OR upper(coalesce(o.status2, '')) = 'RENDIDO')
    AND o.delivery_paid_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.delivery_closure_orders d WHERE d.order_id = o.id)
    AND (v_role = 'ADMIN' OR lower(trim(coalesce(o.provider_email, ''))) = v_email);
  v_skipped := cardinality(p_order_ids) - cardinality(v_ok);
  IF cardinality(v_ok) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'skipped', v_skipped);
  END IF;

  INSERT INTO public.order_status_history (order_id, previous_status, new_status, changed_by_email, changed_by_role, message, event_type)
  SELECT o.id, coalesce(o.status, 'PENDIENTE'), coalesce(o.status, 'PENDIENTE'), v_email, v_role, '↩️ Quitó RENDIDO', 'edit'
  FROM public.orders o WHERE o.id = ANY (v_ok);

  -- Se conserva la fecha original de la guía (el guard la pondría en hoy).
  CREATE TEMP TABLE IF NOT EXISTS _unrendido (id uuid, g timestamptz) ON COMMIT DROP;
  DELETE FROM _unrendido;
  INSERT INTO _unrendido SELECT o.id, o.guide_generated_at FROM public.orders o WHERE o.id = ANY (v_ok);
  UPDATE public.orders o SET delivery_settled = false,
    status2 = CASE WHEN u.g IS NULL THEN '--' WHEN o.stock_source = 'DELIVERY' THEN 'DESPACHADO POR REPARTIDOR' ELSE 'GUIA GENERADA' END,
    updated_at = now()
  FROM _unrendido u WHERE o.id = u.id AND upper(coalesce(o.status2, '')) = 'RENDIDO';
  UPDATE public.orders o SET delivery_settled = false, updated_at = now()
  FROM _unrendido u WHERE o.id = u.id AND coalesce(o.delivery_settled, false);
  UPDATE public.orders o SET guide_generated_at = u.g FROM _unrendido u WHERE o.id = u.id;

  RETURN jsonb_build_object('updated', cardinality(v_ok), 'skipped', v_skipped);
END; $$;
REVOKE ALL ON FUNCTION public.unmark_rendido(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.unmark_rendido(uuid[]) TO authenticated;

