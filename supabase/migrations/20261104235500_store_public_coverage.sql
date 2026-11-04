-- Public checkout needs city coverage even before login.
-- Return only place names; keep delivery fees and private settings protected.
CREATE OR REPLACE FUNCTION public.store_public_coverage()
RETURNS TABLE(departamento text, city text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT c.departamento::text, c.city::text
  FROM public.client_prices AS c
  WHERE nullif(trim(c.city), '') IS NOT NULL
    AND nullif(trim(c.departamento), '') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.store_public_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_public_coverage() TO anon, authenticated;