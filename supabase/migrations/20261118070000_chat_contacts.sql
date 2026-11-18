-- 💬 Chat: a quién le puede escribir cada usuario.
--   ADMIN / PROVEEDOR / DESPACHANTE → a todos.
--   VENDEDOR / DELIVERY → a admin, proveedores y despachantes.
CREATE OR REPLACE FUNCTION public.chat_contacts()
RETURNS TABLE (email text, name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  WITH me AS (
    SELECT upper(ur.role::text) AS role FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND coalesce(ur.approved, false)
    ORDER BY CASE upper(ur.role::text) WHEN 'ADMIN' THEN 1 WHEN 'PROVEEDOR' THEN 2 WHEN 'DESPACHANTE' THEN 3 ELSE 4 END
    LIMIT 1
  ), people AS (
    SELECT DISTINCT ON (lower(p.email)) lower(p.email) AS email, coalesce(nullif(trim(p.name), ''), p.email) AS name, upper(ur.role::text) AS role
    FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.user_id AND coalesce(ur.approved, false)
    WHERE coalesce(p.approved, false) AND p.email IS NOT NULL AND p.user_id <> auth.uid()
    ORDER BY lower(p.email), CASE upper(ur.role::text) WHEN 'ADMIN' THEN 1 WHEN 'PROVEEDOR' THEN 2 WHEN 'DESPACHANTE' THEN 3 ELSE 4 END
  )
  SELECT people.email, people.name, people.role FROM people, me
  WHERE me.role IN ('ADMIN', 'PROVEEDOR', 'DESPACHANTE')
     OR people.role IN ('ADMIN', 'PROVEEDOR', 'DESPACHANTE')
  ORDER BY CASE people.role WHEN 'ADMIN' THEN 1 WHEN 'PROVEEDOR' THEN 2 WHEN 'DESPACHANTE' THEN 3 ELSE 4 END, people.name;
$function$;
REVOKE ALL ON FUNCTION public.chat_contacts() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.chat_contacts() TO authenticated;
