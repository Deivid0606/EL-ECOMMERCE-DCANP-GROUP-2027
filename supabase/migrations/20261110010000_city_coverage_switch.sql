-- Cobertura por ciudad con interruptor (admin) y ciudades que cada proveedor no entrega.
ALTER TABLE public.client_prices ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.city_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT regexp_replace(lower(translate(trim(coalesce(p, '')), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouaeiounnuu')), '\s+', ' ', 'g')
$$;

CREATE TABLE IF NOT EXISTS public.provider_city_blocks (
  provider_email text NOT NULL,
  city_key text NOT NULL,
  city text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_email, city_key)
);
ALTER TABLE public.provider_city_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_city_blocks_read ON public.provider_city_blocks;
CREATE POLICY provider_city_blocks_read ON public.provider_city_blocks FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS provider_city_blocks_write ON public.provider_city_blocks;
CREATE POLICY provider_city_blocks_write ON public.provider_city_blocks FOR ALL TO authenticated
  USING ((SELECT public.is_admin()) OR lower(provider_email) = (SELECT public.current_profile_email()))
  WITH CHECK ((SELECT public.is_admin()) OR lower(provider_email) = (SELECT public.current_profile_email()));

-- Ningún pedido nuevo entra a una ciudad apagada, ni con productos de un proveedor que no entrega ahí.
CREATE OR REPLACE FUNCTION public.block_order_city_coverage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k text := public.city_key(NEW.city); it jsonb; prov text; provs text[] := ARRAY[]::text[]; who text;
BEGIN
  IF k = '' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.client_prices c WHERE public.city_key(c.city) = k AND NOT c.active)
     AND NOT EXISTS (SELECT 1 FROM public.client_prices c WHERE public.city_key(c.city) = k AND c.active) THEN
    RAISE EXCEPTION 'Ciudad sin cobertura: % está desactivada', NEW.city;
  END IF;
  IF jsonb_typeof(NEW.items_json) = 'array' THEN
    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items_json) LOOP
      SELECT lower(trim(p.provider_email)) INTO prov FROM public.products p WHERE p.id = public.order_item_product(it);
      IF coalesce(prov, '') = '' THEN prov := lower(trim(coalesce(it->>'provider_email', ''))); END IF;
      IF prov <> '' THEN provs := array_append(provs, prov); END IF;
    END LOOP;
  END IF;
  IF cardinality(provs) = 0 THEN
    provs := ARRAY(SELECT lower(trim(x)) FROM unnest(string_to_array(coalesce(NEW.provider_emails_list, NEW.provider_email, ''), ',')) x WHERE trim(x) <> '');
  END IF;
  SELECT coalesce(nullif(trim(pr.name), ''), b.provider_email) INTO who
  FROM public.provider_city_blocks b LEFT JOIN public.profiles pr ON lower(pr.email) = b.provider_email
  WHERE b.city_key = k AND b.provider_email = ANY (provs) LIMIT 1;
  IF who IS NOT NULL THEN
    RAISE EXCEPTION 'El proveedor % no entrega en %', who, NEW.city;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS block_order_city_coverage ON public.orders;
CREATE TRIGGER block_order_city_coverage BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.block_order_city_coverage();

-- Las páginas de venta sólo ofrecen ciudades activas.
CREATE OR REPLACE FUNCTION public.store_public_coverage()
 RETURNS TABLE(departamento text, city text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT DISTINCT c.departamento::text, c.city::text
  FROM public.client_prices AS c
  WHERE c.active
    AND nullif(trim(c.city), '') IS NOT NULL
    AND nullif(trim(c.departamento), '') IS NOT NULL
    AND NOT (lower(trim(c.departamento)) = 'varios' AND lower(trim(c.city)) = 'interior pago anticipado')
$function$;
