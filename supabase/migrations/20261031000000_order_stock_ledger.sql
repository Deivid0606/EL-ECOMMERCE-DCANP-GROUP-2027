-- Stock por pedido, calculado en la base de datos (una sola fuente de verdad).
--
-- Regla al descontar cada producto del pedido:
--   * Si el delivery asignado tiene stock propio del producto, se descuenta SÓLO
--     de su stock (delivery_stock). Si no le alcanza, el resto sale del global.
--   * Si no tiene stock propio, se descuenta del global: stock (visible) y
--     real_stock.
-- Cuándo se descuenta:
--   * Automático al pasar a ENTREGADO o ENCOMIENDA ENTREGADA.
--   * Manual con el botón "Bajar stock" en Pedidos con guías (GUIA GENERADA).
-- Cuándo se repone:
--   * Al pasar a DEVUELTO A DEPÓSITO se devuelve exactamente lo descontado, al
--     mismo lugar (delivery o global).
-- order_stock_ledger registra cada descuento: evita descontar dos veces y
-- permite reponer con precisión.

CREATE TABLE IF NOT EXISTS public.order_stock_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  delivery_email text,
  qty_delivery integer NOT NULL DEFAULT 0,
  qty_global integer NOT NULL DEFAULT 0,
  qty_stock integer NOT NULL DEFAULT 0,
  qty_real_stock integer NOT NULL DEFAULT 0,
  source text NOT NULL,
  applied_by text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_reason text
);
CREATE INDEX IF NOT EXISTS order_stock_ledger_order_idx ON public.order_stock_ledger(order_id) WHERE reverted_at IS NULL;
ALTER TABLE public.order_stock_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_stock_ledger_read ON public.order_stock_ledger;
CREATE POLICY order_stock_ledger_read ON public.order_stock_ledger FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.order_stock_ledger FROM anon, authenticated;

-- Producto de un ítem: por id si viene, sino por SKU (desempata por proveedor y título).
CREATE OR REPLACE FUNCTION public.order_item_product(item jsonb)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id FROM public.products p
  WHERE p.id::text = coalesce(item->>'product_id', item->>'id', '')
     OR (coalesce(trim(item->>'sku'), '') <> '' AND lower(trim(p.sku)) = lower(trim(item->>'sku')))
  ORDER BY (p.id::text = coalesce(item->>'product_id', item->>'id', '')) DESC,
           (lower(coalesce(p.provider_email, '')) = lower(coalesce(item->>'provider_email', ''))) DESC,
           (lower(trim(coalesce(p.title, ''))) = lower(trim(coalesce(item->>'title', '')))) DESC,
           p.created_at
  LIMIT 1;
$$;

-- Descuenta el stock de un pedido. Idempotente: si ya tiene descuento vigente no hace nada.
CREATE OR REPLACE FUNCTION public.apply_order_stock_internal(p_order_id uuid, p_source text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

  IF EXISTS (SELECT 1 FROM public.order_stock_ledger WHERE order_id = p_order_id AND reverted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  -- Pedidos descontados por la versión anterior de la app (desde el navegador).
  IF coalesce((SELECT sum(quantity_change) FROM public.delivery_stock_movements WHERE order_id = p_order_id), 0) < 0 THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'legacy', true);
  END IF;

  -- El historial del pedido se registra abajo; se evita el registro genérico duplicado.
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

    -- 1) Stock propio del delivery.
    from_delivery := 0;
    IF delivery IS NOT NULL THEN
      SELECT quantity INTO ds_qty FROM public.delivery_stock
      WHERE lower(delivery_email) = delivery AND product_id = pid FOR UPDATE;
      IF coalesce(ds_qty, 0) > 0 THEN
        from_delivery := least(qty, ds_qty);
        UPDATE public.delivery_stock SET quantity = quantity - from_delivery, updated_at = now()
        WHERE lower(delivery_email) = delivery AND product_id = pid;
      END IF;
    END IF;

    -- 2) El resto, del global (stock visible y real).
    rest := qty - from_delivery;
    take_stock := 0;
    take_real := 0;
    IF rest > 0 THEN
      SELECT coalesce(stock, 0), coalesce(real_stock, 0) INTO cur_stock, cur_real FROM public.products WHERE id = pid FOR UPDATE;
      take_stock := least(rest, greatest(cur_stock, 0));
      take_real := least(rest, greatest(cur_real, 0));
      UPDATE public.products SET stock = coalesce(stock, 0) - take_stock, real_stock = coalesce(real_stock, 0) - take_real, updated_at = now()
      WHERE id = pid;
    END IF;

    INSERT INTO public.order_stock_ledger(order_id, product_id, delivery_email, qty_delivery, qty_global, qty_stock, qty_real_stock, source, applied_by)
    VALUES (p_order_id, pid, CASE WHEN from_delivery > 0 THEN delivery END, from_delivery, rest, take_stock, take_real, p_source, p_actor);

    -- Historial visible en Productos. También evita que una pestaña con la
    -- versión anterior de la app descuente de nuevo este pedido.
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
END; $$;

-- Repone exactamente lo descontado (al delivery o al global).
CREATE OR REPLACE FUNCTION public.revert_order_stock_internal(p_order_id uuid, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l public.order_stock_ledger; n integer := 0;
BEGIN
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  PERFORM set_config('app.skip_stock_log', '1', true);
  FOR l IN SELECT * FROM public.order_stock_ledger WHERE order_id = p_order_id AND reverted_at IS NULL FOR UPDATE LOOP
    IF l.qty_delivery > 0 AND l.delivery_email IS NOT NULL THEN
      INSERT INTO public.delivery_stock(delivery_email, product_id, quantity)
      VALUES (l.delivery_email, l.product_id, l.qty_delivery)
      ON CONFLICT (delivery_email, product_id) DO UPDATE SET quantity = public.delivery_stock.quantity + EXCLUDED.quantity, updated_at = now();
    END IF;
    IF l.qty_stock > 0 OR l.qty_real_stock > 0 THEN
      UPDATE public.products SET stock = coalesce(stock, 0) + l.qty_stock, real_stock = coalesce(real_stock, 0) + l.qty_real_stock, updated_at = now()
      WHERE id = l.product_id;
    END IF;
    UPDATE public.order_stock_ledger SET reverted_at = now(), reverted_reason = p_reason WHERE id = l.id;
    INSERT INTO public.delivery_stock_movements(delivery_email, product_id, quantity_change, reason, order_id)
    VALUES (coalesce(l.delivery_email, 'GLOBAL'), l.product_id, l.qty_delivery + l.qty_global,
            '↩️ ' || p_reason || ' · stock repuesto', p_order_id);
    n := n + 1;
  END LOOP;
  PERFORM set_config('app.skip_stock_log', '0', true);
  RETURN n;
END; $$;

REVOKE ALL ON FUNCTION public.order_item_product(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_order_stock_internal(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_order_stock_internal(uuid, text) FROM PUBLIC, anon, authenticated;

-- Botón "Bajar stock" (Pedidos con guías). Sólo admin, despachante o el proveedor del pedido.
CREATE OR REPLACE FUNCTION public.apply_order_stock(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text; allowed boolean;
BEGIN
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text IN ('ADMIN', 'DESPACHANTE'))
      OR EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND me IS NOT NULL AND lower(coalesce(provider_email, '')) LIKE '%' || me || '%')
    INTO allowed;
  IF NOT coalesce(allowed, false) THEN RAISE EXCEPTION 'No tenés permiso para descontar stock de este pedido'; END IF;
  RETURN public.apply_order_stock_internal(p_order_id, 'GUIA GENERADA', me);
END; $$;
REVOKE ALL ON FUNCTION public.apply_order_stock(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_order_stock(uuid) TO authenticated;

-- Automático por cambio de Estado 1.
CREATE OR REPLACE FUNCTION public.order_stock_status_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE new_s text := upper(trim(coalesce(NEW.status, ''))); old_s text := upper(trim(coalesce(OLD.status, '')));
BEGIN
  IF new_s IS NOT DISTINCT FROM old_s THEN RETURN NEW; END IF;
  BEGIN
    IF new_s IN ('ENTREGADO', 'ENCOMIENDA ENTREGADA') THEN
      PERFORM public.apply_order_stock_internal(NEW.id, new_s, (SELECT lower(email) FROM public.profiles WHERE user_id = auth.uid()));
    ELSIF new_s = 'DEVUELTO A DEPÓSITO' THEN
      PERFORM public.revert_order_stock_internal(NEW.id, new_s);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'order_stock_status_trigger %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS order_stock_status ON public.orders;
CREATE TRIGGER order_stock_status AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.order_stock_status_trigger();

-- El registro genérico de delivery_stock se omite cuando lo escribe esta lógica.
CREATE OR REPLACE FUNCTION public.log_delivery_stock_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('app.skip_stock_log', true) = '1' THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN
        INSERT INTO delivery_stock_movements (delivery_email, product_id, quantity_change, reason, order_id)
        VALUES (NEW.delivery_email, NEW.product_id, NEW.quantity, '➕ Asignación inicial de stock', NULL);
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.quantity IS DISTINCT FROM NEW.quantity THEN
            INSERT INTO delivery_stock_movements (delivery_email, product_id, quantity_change, reason, order_id)
            VALUES (
                NEW.delivery_email,
                NEW.product_id,
                NEW.quantity - OLD.quantity,
                CASE
                    WHEN NEW.quantity > OLD.quantity THEN '➕ Incremento de stock asignado'
                    ELSE '➖ Reducción de stock'
                END,
                NULL
            );
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO delivery_stock_movements (delivery_email, product_id, quantity_change, reason, order_id)
        VALUES (OLD.delivery_email, OLD.product_id, -OLD.quantity, '➖ Stock eliminado', NULL);
    END IF;
    RETURN NULL;
END;
$$;

-- Disparador anterior (usaba delivery_email/sku, casi siempre vacíos). Lo reemplaza order_stock_status.
DROP TRIGGER IF EXISTS decrease_stock_on_delivery ON public.orders;
