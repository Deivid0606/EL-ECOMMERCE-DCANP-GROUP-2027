-- 🔢 Números de pedido cortos (6 dígitos) para todos los pedidos nuevos, vengan de donde
-- vengan (formulario, Shopify, auto-carga, Mi Tienda, páginas, bot). El número largo que
-- mande cada origen se guarda en source_ref. Los pedidos viejos no cambian.
CREATE SEQUENCE IF NOT EXISTS public.seq_order_short START 100001 MINVALUE 100001 MAXVALUE 999999;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source_ref text;
CREATE INDEX IF NOT EXISTS sheet_row_statuses_order_number_idx ON public.sheet_row_statuses (order_number);

CREATE OR REPLACE FUNCTION public.auto_assign_order_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF coalesce(NEW.order_number, '') !~ '^\d{6}$' THEN
    NEW.source_ref := coalesce(NEW.source_ref, nullif(trim(coalesce(NEW.order_number, '')), ''));
    LOOP
      NEW.order_number := nextval('public.seq_order_short')::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE order_number = NEW.order_number);
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;

-- Pedidos Shopify: la fila de la planilla guardaba el número largo; se pasa al corto.
CREATE OR REPLACE FUNCTION public.sync_short_order_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF NEW.source_ref IS NOT NULL AND NEW.source_ref IS DISTINCT FROM NEW.order_number THEN
    UPDATE public.sheet_row_statuses SET order_number = NEW.order_number WHERE order_number = NEW.source_ref;
  END IF;
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS sync_short_order_number ON public.orders;
CREATE TRIGGER sync_short_order_number AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_short_order_number();
