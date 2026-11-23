-- 📷 scan_order_qr también devuelve el id del pedido (para escribirle al cliente al escanear).
DO $m$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.scan_order_qr(text,text)'::regprocedure);
  IF position('''id'', o.id, ''order_number'', o.order_number, ''customer_name''' IN def) = 0 THEN
    IF position('jsonb_build_object(''ok'', true, ''order_number'', o.order_number, ''customer_name''' IN def) = 0 THEN
      RAISE EXCEPTION 'patrón no encontrado';
    END IF;
    def := replace(def, 'jsonb_build_object(''ok'', true, ''order_number'', o.order_number, ''customer_name''',
                        'jsonb_build_object(''ok'', true, ''id'', o.id, ''order_number'', o.order_number, ''customer_name''');
    EXECUTE def;
  END IF;
END $m$;
