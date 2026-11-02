-- Admin: eliminar usuarios en lote (nunca a sí mismo ni a otros admin).
-- Si tienen cierres/rendiciones guardados, la cuenta se bloquea y se quita de la app.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE OR REPLACE FUNCTION public.admin_delete_users(p_user_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE uid uuid; deleted int := 0; blocked int := 0; skipped int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND lower(role) = 'admin') THEN
    RAISE EXCEPTION 'Sólo el administrador puede eliminar usuarios';
  END IF;
  FOREACH uid IN ARRAY coalesce(p_user_ids, ARRAY[]::uuid[]) LOOP
    IF uid = auth.uid()
       OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = uid AND lower(role) = 'admin')
       OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text = 'ADMIN') THEN
      skipped := skipped + 1; CONTINUE;
    END IF;
    BEGIN
      DELETE FROM auth.users WHERE id = uid;
      deleted := deleted + 1;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE auth.users SET banned_until = 'infinity' WHERE id = uid;
      DELETE FROM public.user_roles WHERE user_id = uid;
      UPDATE public.profiles SET deleted_at = now() WHERE user_id = uid;
      blocked := blocked + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('deleted', deleted, 'blocked', blocked, 'skipped', skipped);
END; $$;
REVOKE ALL ON FUNCTION public.admin_delete_users(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_users(uuid[]) TO authenticated;
