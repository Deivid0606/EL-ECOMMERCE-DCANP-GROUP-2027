-- 'Varios / INTERIOR PAGO ANTICIPADO' is a delivery tariff category,
-- not a city, and must not appear in the checkout platform-coverage selector.
-- Keep the client_prices row untouched for existing logistical calculations.
CREATE OR REPLACE FUNCTION public.store_public_coverage()
RETURNS TABLE(departamento text, city text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT c.departamento::text, c.city::text
  FROM public.client_prices AS c
  WHERE nullif(trim(c.city), '') IS NOT NULL
    AND nullif(trim(c.departamento), '') IS NOT NULL
    AND NOT (
      lower(trim(c.departamento)) = 'varios'
      AND lower(trim(c.city)) = 'interior pago anticipado'
    )
$$;
REVOKE ALL ON FUNCTION public.store_public_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_public_coverage() TO anon, authenticated;
