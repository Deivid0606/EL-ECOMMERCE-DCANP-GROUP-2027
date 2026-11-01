-- 1) No se puede cargar un pedido si algún producto no tiene stock suficiente.
CREATE OR REPLACE FUNCTION public.block_order_without_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it jsonb; p public.products; q integer; faltan text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(NEW.items_json) <> 'array' THEN RETURN NEW; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(NEW.items_json) LOOP
    SELECT * INTO p FROM public.products WHERE id = public.order_item_product(it);
    IF NOT FOUND THEN CONTINUE; END IF;
    q := greatest(coalesce(nullif(it->>'qty', '')::numeric, 1)::integer, 1);
    IF coalesce(p.stock, 0) < q THEN
      faltan := array_append(faltan, format('%s (stock %s, pedido %s)', p.title, coalesce(p.stock, 0), q));
    END IF;
  END LOOP;
  IF cardinality(faltan) > 0 THEN RAISE EXCEPTION 'Sin stock: %', array_to_string(faltan, '; '); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS block_order_without_stock ON public.orders;
CREATE TRIGGER block_order_without_stock BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.block_order_without_stock();

-- 2) Productos ocultos: sólo los ven admin y su proveedor.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;
DROP POLICY IF EXISTS ver_productos_segun_privacidad ON public.products;
CREATE POLICY ver_productos_segun_privacidad ON public.products FOR SELECT USING (
  (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'))
  OR lower(provider_email) = lower(auth.jwt() ->> 'email')
  OR (NOT is_hidden AND (
        COALESCE(is_private_stock, is_private, false) = false
        OR lower(auth.jwt() ->> 'email') = ANY (string_to_array(lower(replace(COALESCE(private_to_emails, ''), ' ', '')), ','))
  ))
);
