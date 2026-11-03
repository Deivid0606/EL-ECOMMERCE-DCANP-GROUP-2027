-- Eliminar un producto con stock asignado a deliverys ya no falla por el registro de movimientos.
CREATE OR REPLACE FUNCTION public.log_delivery_stock_changes()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF current_setting('app.skip_stock_log', true) = '1' THEN RETURN NULL; END IF;
    IF TG_OP = 'INSERT' THEN
        INSERT INTO delivery_stock_movements (delivery_email, product_id, quantity_change, reason, order_id)
        VALUES (NEW.delivery_email, NEW.product_id, NEW.quantity, '➕ Asignación inicial de stock', NULL);
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.quantity IS DISTINCT FROM NEW.quantity THEN
            INSERT INTO delivery_stock_movements (delivery_email, product_id, quantity_change, reason, order_id)
            VALUES (NEW.delivery_email, NEW.product_id, NEW.quantity - OLD.quantity,
                CASE WHEN NEW.quantity > OLD.quantity THEN '➕ Incremento de stock asignado' ELSE '➖ Reducción de stock' END, NULL);
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM public.products WHERE id = OLD.product_id) THEN
            INSERT INTO delivery_stock_movements (delivery_email, product_id, quantity_change, reason, order_id)
            VALUES (OLD.delivery_email, OLD.product_id, -OLD.quantity, '➖ Stock eliminado', NULL);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
