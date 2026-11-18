-- 🔢 Número corto con el origen adelante: SHOPIFY100005, MITIENDA100006, BOT100007, VENTA100008.
-- Un solo contador para todos (nunca se repite). Los pedidos anteriores no cambian.
CREATE OR REPLACE FUNCTION public.auto_assign_order_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE src text; prefix text;
BEGIN
  IF coalesce(NEW.order_number, '') !~ '^(SHOPIFY|MITIENDA|BOT|VENTA)\d{6}$' THEN
    NEW.source_ref := coalesce(NEW.source_ref, nullif(trim(coalesce(NEW.order_number, '')), ''));
    src := upper(coalesce(NEW.source_ref, ''));
    prefix := CASE
      WHEN coalesce(NEW.obs, '') ILIKE 'PEDIDO MI TIENDA%' THEN 'MITIENDA'
      WHEN src LIKE 'SHOPIFY%' THEN 'SHOPIFY'
      WHEN src LIKE 'BS%' THEN 'BOT'
      ELSE 'VENTA'
    END;
    LOOP
      NEW.order_number := prefix || nextval('public.seq_order_short')::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE order_number = NEW.order_number);
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;
