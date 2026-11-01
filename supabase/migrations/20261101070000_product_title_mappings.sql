-- "Nombre del producto en la página del vendedor" → SKU de la plataforma.
CREATE TABLE IF NOT EXISTS public.product_title_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  title_key text NOT NULL,
  raw_title text NOT NULL,
  sku text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_email, title_key)
);
ALTER TABLE public.product_title_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own mappings select" ON public.product_title_mappings FOR SELECT TO authenticated
  USING (lower(owner_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), '')) OR public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "own mappings insert" ON public.product_title_mappings FOR INSERT TO authenticated
  WITH CHECK (lower(owner_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), '')));
CREATE POLICY "own mappings update" ON public.product_title_mappings FOR UPDATE TO authenticated
  USING (lower(owner_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), '')))
  WITH CHECK (lower(owner_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), '')));
CREATE POLICY "own mappings delete" ON public.product_title_mappings FOR DELETE TO authenticated
  USING (lower(owner_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), '')));
