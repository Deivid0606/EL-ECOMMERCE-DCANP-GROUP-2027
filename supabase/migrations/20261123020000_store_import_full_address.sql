-- 🏠 Mi Tienda: al cargar el pedido se completa la dirección con todo lo que escribió el cliente.
-- La referencia (sin la opción de entrega) va a «Barrio/Referencia» del pedido, que se muestra
-- junto a la calle en la guía, en Despacho y en el WhatsApp al cliente.
CREATE OR REPLACE FUNCTION public.store_customer_reference(p_reference text, p_payload jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE
  v text := coalesce(nullif(trim(p_payload->>'customer_reference'), ''), '');
  r text := trim(coalesce(p_reference, ''));
BEGIN
  IF v = '' THEN
    -- Pedidos anteriores: «🚚 <entrega> (+Gs X) · <referencia>».
    IF r LIKE '🚚%' THEN
      v := CASE WHEN position(' · ' IN r) > 0 THEN trim(substr(r, position(' · ' IN r) + 3)) ELSE '' END;
    ELSE
      v := r;
    END IF;
  END IF;
  RETURN CASE WHEN v = '' THEN '' ELSE 'Ref: ' || v END;
END $function$;

DO $m$
DECLARE
  f record;
  def text;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.store_auto_import_order_trigger()', 'coalesce(NEW.address,''''),'''','''',', 'coalesce(NEW.address,''''),public.store_customer_reference(NEW.reference,NEW.raw_payload),'''','),
    ('public.store_auto_import_existing_order(uuid)', 'coalesce(v_source.address,''''),'''','''',', 'coalesce(v_source.address,''''),public.store_customer_reference(v_source.reference,v_source.raw_payload),'''','),
    ('public.import_store_orders(uuid[])', 'coalesce(v_source.address,''''), '''', '''',', 'coalesce(v_source.address,''''), public.store_customer_reference(v_source.reference,v_source.raw_payload), '''','))
    AS t(sig, old, new)
  LOOP
    def := pg_get_functiondef(f.sig::regprocedure);
    IF position('store_customer_reference' IN def) > 0 THEN CONTINUE; END IF;
    IF position(f.old IN def) = 0 THEN RAISE EXCEPTION 'No se encontró la dirección en %', f.sig; END IF;
    EXECUTE replace(def, f.old, f.new);
  END LOOP;
END $m$;
