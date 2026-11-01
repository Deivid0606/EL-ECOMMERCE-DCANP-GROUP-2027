-- profiles.approved refleja si el usuario está activo (rol aprobado). Las listas
-- de la app sólo muestran usuarios activos: al revocar el acceso deja de aparecer.
CREATE OR REPLACE FUNCTION public.sync_profile_approved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid := coalesce(NEW.user_id, OLD.user_id);
BEGIN
  UPDATE public.profiles p
  SET approved = EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = uid AND r.approved)
  WHERE p.user_id = uid
    AND p.approved IS DISTINCT FROM EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = uid AND r.approved);
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS sync_profile_approved ON public.user_roles;
CREATE TRIGGER sync_profile_approved AFTER INSERT OR UPDATE OF approved, user_id OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_approved();
UPDATE public.profiles p
SET approved = EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.user_id AND r.approved)
WHERE p.approved IS DISTINCT FROM EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.user_id AND r.approved);

-- Qué proveedores puede despachar cada despachante (lo decide el admin).
-- Un despachante sin proveedores asignados ve todos (como antes).
CREATE TABLE IF NOT EXISTS public.dispatcher_providers (
  dispatcher_email text NOT NULL,
  provider_email text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dispatcher_email, provider_email)
);
ALTER TABLE public.dispatcher_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin manages dispatcher providers" ON public.dispatcher_providers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN')) WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "dispatcher reads own providers" ON public.dispatcher_providers FOR SELECT TO authenticated
  USING (lower(dispatcher_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), '')));

CREATE OR REPLACE FUNCTION public.my_dispatch_providers()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(lower(provider_email)), ARRAY[]::text[]) FROM public.dispatcher_providers
  WHERE lower(dispatcher_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), ''));
$$;
REVOKE ALL ON FUNCTION public.my_dispatch_providers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_dispatch_providers() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_edit_order_items(o public.orders)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me text; mine text[];
BEGIN
  IF public.has_role(auth.uid(), 'ADMIN') THEN RETURN true; END IF;
  SELECT lower(email) INTO me FROM public.profiles WHERE user_id = auth.uid();
  IF me IS NULL THEN RETURN false; END IF;
  IF public.has_role(auth.uid(), 'DESPACHANTE') THEN
    mine := public.my_dispatch_providers();
    RETURN cardinality(mine) = 0
      OR lower(coalesce(o.provider_email, '')) = ANY(mine)
      OR regexp_split_to_array(lower(coalesce(o.provider_emails_list, '')), '[,;[:space:]]+') && mine;
  END IF;
  IF NOT public.has_role(auth.uid(), 'PROVEEDOR') THEN RETURN false; END IF;
  RETURN lower(coalesce(o.provider_email, '')) = me
    OR me = ANY(regexp_split_to_array(lower(coalesce(o.provider_emails_list, '')), '[,;[:space:]]+'));
END; $$;
REVOKE ALL ON FUNCTION public.can_edit_order_items(public.orders) FROM PUBLIC, anon;
