-- Qué proveedores puede ver cada delivery en «Asignar Pedidos» (lo decide el admin).
-- Un delivery sin proveedores asignados sigue viendo todos (como antes).
CREATE TABLE IF NOT EXISTS public.delivery_providers (
  delivery_email text NOT NULL,
  provider_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (delivery_email, provider_email)
);
ALTER TABLE public.delivery_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin manages delivery providers" ON public.delivery_providers;
CREATE POLICY "admin manages delivery providers" ON public.delivery_providers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN')) WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));
DROP POLICY IF EXISTS "delivery reads own providers" ON public.delivery_providers;
CREATE POLICY "delivery reads own providers" ON public.delivery_providers FOR SELECT TO authenticated
  USING (lower(delivery_email) = (SELECT public.current_profile_email()));
