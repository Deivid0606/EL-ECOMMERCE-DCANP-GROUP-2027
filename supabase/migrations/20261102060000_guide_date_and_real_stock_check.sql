-- Guía: guarda la fecha (para «Stock del día») y exige stock real. La guía no descuenta
-- stock; se descuenta al quedar ENTREGADO / ENCOMIENDA ENTREGADA (order_stock_status_trigger).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS guide_generated_at timestamptz;
UPDATE public.orders SET guide_generated_at = updated_at WHERE status2 = 'GUIA GENERADA' AND guide_generated_at IS NULL;
CREATE INDEX IF NOT EXISTS orders_guide_generated_at_idx ON public.orders (guide_generated_at) WHERE guide_generated_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.orders_guide_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it jsonb; p public.products; q integer; faltan text[] := ARRAY[]::text[];
BEGIN
  IF upper(coalesce(NEW.status2, '')) = 'GUIA GENERADA' AND upper(coalesce(OLD.status2, '')) IS DISTINCT FROM 'GUIA GENERADA' THEN
    IF jsonb_typeof(NEW.items_json) = 'array' THEN
      FOR it IN SELECT * FROM jsonb_array_elements(NEW.items_json) LOOP
        SELECT * INTO p FROM public.products WHERE id = public.order_item_product(it);
        IF NOT FOUND THEN CONTINUE; END IF;
        q := greatest(coalesce(nullif(it->>'qty', '')::numeric, 1)::integer, 1);
        IF coalesce(p.real_stock, 0) < q THEN
          faltan := array_append(faltan, format('%s (stock real %s)', p.title, coalesce(p.real_stock, 0)));
        END IF;
      END LOOP;
    END IF;
    IF cardinality(faltan) > 0 THEN
      RAISE EXCEPTION 'Sin stock real para generar la guía de %: %', NEW.order_number, array_to_string(faltan, '; ');
    END IF;
    NEW.guide_generated_at := now();
  ELSIF coalesce(NEW.status2, '--') IN ('--', '') THEN
    NEW.guide_generated_at := NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS orders_guide_guard ON public.orders;
CREATE TRIGGER orders_guide_guard BEFORE UPDATE OF status2 ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_guide_guard();
