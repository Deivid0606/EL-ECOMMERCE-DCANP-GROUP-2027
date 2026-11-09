-- Cierres: pedidos de un delivery ordenados por fecha de asignación, sin recorrer toda la tabla.
CREATE INDEX IF NOT EXISTS orders_assigned_delivery_assigned_at_idx ON public.orders (assigned_delivery, assigned_at DESC);
