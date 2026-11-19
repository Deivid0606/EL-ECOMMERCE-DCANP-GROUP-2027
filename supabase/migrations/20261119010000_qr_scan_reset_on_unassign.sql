-- 📷 Si al pedido se le saca el delivery (o se lo cambia a mano a otro), la guía se
-- puede volver a escanear: se borra la marca de escaneado. El escaneo mismo no la borra.
CREATE OR REPLACE FUNCTION public.orders_qr_scan_reset()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF OLD.qr_scanned_at IS NOT NULL
     AND NEW.qr_scanned_at IS NOT DISTINCT FROM OLD.qr_scanned_at
     AND lower(trim(coalesce(NEW.assigned_delivery, ''))) IS DISTINCT FROM lower(trim(coalesce(OLD.assigned_delivery, ''))) THEN
    NEW.qr_scanned_at := NULL;
    NEW.qr_scanned_by := NULL;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS orders_qr_scan_reset ON public.orders;
CREATE TRIGGER orders_qr_scan_reset BEFORE UPDATE OF assigned_delivery ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_qr_scan_reset();

-- Pedidos que ya fueron escaneados y después quedaron sin delivery: se liberan.
UPDATE public.orders SET qr_scanned_at = NULL, qr_scanned_by = NULL
WHERE qr_scanned_at IS NOT NULL AND assigned_delivery IS NULL;
