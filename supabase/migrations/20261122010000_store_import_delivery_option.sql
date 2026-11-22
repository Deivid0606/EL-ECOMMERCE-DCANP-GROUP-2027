-- 🚚 Mi Tienda: el total del pedido puede incluir la opción de entrega (ej. ⚡ express +Gs 9.000).
-- La carga automática valida el precio del producto con (total − entrega) y carga el TOTAL completo.
-- El costo de entrega se valida contra las opciones configuradas en la página (no se puede inventar).
CREATE OR REPLACE FUNCTION public.store_delivery_option_gs(p_config jsonb, p_payload jsonb)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE
  v_opt jsonb := p_payload->'delivery_option';
  v_price numeric;
BEGIN
  IF v_opt IS NULL OR jsonb_typeof(v_opt) <> 'object' THEN RETURN 0; END IF;
  v_price := coalesce(nullif(v_opt->>'price_gs', '')::numeric, 0);
  IF v_price = 0 THEN RETURN 0; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_config->'deliveryOptions') = 'array' THEN p_config->'deliveryOptions' ELSE '[]'::jsonb END
    ) o(v) WHERE coalesce(nullif(o.v->>'priceGs', '')::numeric, 0) = v_price
  ) THEN
    RAISE EXCEPTION 'Opción de entrega no coincide con la página';
  END IF;
  RETURN v_price;
END $function$;

DO $migration$
DECLARE
  f record;
  def text;
  src text;
  n int;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.store_auto_import_order_trigger()', 'NEW'),
    ('public.store_auto_import_existing_order(uuid)', 'v_source')) AS t(sig, rec)
  LOOP
    def := pg_get_functiondef(f.sig::regprocedure);
    IF position('store_delivery_option_gs' IN def) > 0 THEN CONTINUE; END IF;
    src := '(v_sale-public.store_delivery_option_gs(v_page.config,' || f.rec || '.raw_payload))';
    n := 0;
    IF position('v_sale<>coalesce((v_offer->>''priceGs'')' IN def) > 0 THEN n := n + 1; END IF;
    IF position('v_sale<>coalesce((v_snapshot->>''price'')' IN def) > 0 THEN n := n + 1; END IF;
    IF n <> 2 THEN RAISE EXCEPTION 'No se encontró la validación de precio en %', f.sig; END IF;
    def := replace(def, 'v_sale<>coalesce((v_offer->>''priceGs'')', src || '<>coalesce((v_offer->>''priceGs'')');
    def := replace(def, 'v_sale<>coalesce((v_snapshot->>''price'')', src || '<>coalesce((v_snapshot->>''price'')');
    EXECUTE def;
  END LOOP;
END $migration$;
