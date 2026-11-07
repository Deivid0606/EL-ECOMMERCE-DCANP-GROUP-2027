-- Fecha real de retiro para KPI diario de DELIVERY.
-- Se registra al pasar a REALIZADO y nunca se infiere de updated_at.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS retiro_realizado_at timestamptz;
CREATE INDEX IF NOT EXISTS orders_retiro_realizado_at_idx
  ON public.orders (retiro_realizado_at) WHERE retiro_realizado_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.track_order_pickup_timestamp()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF upper(trim(coalesce(NEW.estado_retiro, ''))) = 'REALIZADO' THEN
      NEW.retiro_realizado_at := now();
    END IF;
  ELSIF NEW.estado_retiro IS DISTINCT FROM OLD.estado_retiro THEN
    IF upper(trim(coalesce(NEW.estado_retiro, ''))) = 'REALIZADO' THEN
      NEW.retiro_realizado_at := now();
    ELSE
      NEW.retiro_realizado_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_order_pickup_timestamp ON public.orders;
CREATE TRIGGER trg_order_pickup_timestamp
  BEFORE INSERT OR UPDATE OF estado_retiro ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.track_order_pickup_timestamp();

COMMENT ON COLUMN public.orders.retiro_realizado_at IS
  'Fecha efectiva de transición a estado de retiro REALIZADO; los retiros anteriores sin fecha quedan NULL.';
