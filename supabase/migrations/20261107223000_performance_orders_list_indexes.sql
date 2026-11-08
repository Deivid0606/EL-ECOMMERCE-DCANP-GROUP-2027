-- Aceleración de listados de pedidos. No altera filas, importes ni permisos.
-- created_at: consultas paginadas de Pedidos y Dashboard.
CREATE INDEX IF NOT EXISTS orders_created_at_id_desc_idx
  ON public.orders (created_at DESC, id DESC);
-- status2 + created_at: cola de Despacho con los pendientes.
CREATE INDEX IF NOT EXISTS orders_status2_created_at_idx
  ON public.orders (status2, created_at DESC);
-- delivery_settled + assigned_at: Cierres sin rendir y rendidos.
CREATE INDEX IF NOT EXISTS orders_delivery_settled_assigned_at_idx
  ON public.orders (delivery_settled, assigned_at DESC);
