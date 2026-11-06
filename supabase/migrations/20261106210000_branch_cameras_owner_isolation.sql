-- Sucursal: each approved ADMIN/PROVEEDOR owns and sees only their cameras.
-- Store local connection metadata only. Never store passwords or RTSP credentials.
CREATE TABLE IF NOT EXISTS public.branch_cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 100),
  branch_name text NOT NULL DEFAULT 'Sucursal principal' CHECK (char_length(btrim(branch_name)) BETWEEN 2 AND 100),
  local_ip inet,
  rtsp_port integer NOT NULL DEFAULT 554 CHECK (rtsp_port BETWEEN 1 AND 65535),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  stream_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_cameras_ipv4_private_only CHECK (
    local_ip IS NULL OR
    (family(local_ip)=4 AND (
      local_ip << inet '10.0.0.0/8' OR
      local_ip << inet '172.16.0.0/12' OR
      local_ip << inet '192.168.0.0/16'
    ))
  )
);
CREATE INDEX IF NOT EXISTS branch_cameras_owner_idx ON public.branch_cameras(owner_user_id,created_at DESC);
ALTER TABLE public.branch_cameras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.branch_cameras FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_cameras TO authenticated;

CREATE OR REPLACE FUNCTION public.branch_camera_account_allowed(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_user_id IS NOT NULL
   AND p_user_id = auth.uid()
   AND EXISTS (
     SELECT 1 FROM public.user_roles r
     JOIN public.profiles p ON p.user_id=r.user_id
     WHERE r.user_id=p_user_id AND r.approved IS TRUE AND p.approved IS TRUE
       AND r.role::text IN ('ADMIN','PROVEEDOR')
   )
$$;
REVOKE ALL ON FUNCTION public.branch_camera_account_allowed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_camera_account_allowed(uuid) TO authenticated;

DROP POLICY IF EXISTS branch_cameras_select_own ON public.branch_cameras;
CREATE POLICY branch_cameras_select_own ON public.branch_cameras
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND public.branch_camera_account_allowed(auth.uid()));
DROP POLICY IF EXISTS branch_cameras_insert_own ON public.branch_cameras;
CREATE POLICY branch_cameras_insert_own ON public.branch_cameras
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id=auth.uid() AND public.branch_camera_account_allowed(auth.uid()));
DROP POLICY IF EXISTS branch_cameras_update_own ON public.branch_cameras;
CREATE POLICY branch_cameras_update_own ON public.branch_cameras
  FOR UPDATE TO authenticated
  USING (owner_user_id=auth.uid() AND public.branch_camera_account_allowed(auth.uid()))
  WITH CHECK (owner_user_id=auth.uid() AND public.branch_camera_account_allowed(auth.uid()));
DROP POLICY IF EXISTS branch_cameras_delete_own ON public.branch_cameras;
CREATE POLICY branch_cameras_delete_own ON public.branch_cameras
  FOR DELETE TO authenticated
  USING (owner_user_id=auth.uid() AND public.branch_camera_account_allowed(auth.uid()));

-- Do not allow a camera's identity/owner to be changed after creation.
CREATE OR REPLACE FUNCTION public.branch_camera_guard_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.stream_id IS DISTINCT FROM OLD.stream_id THEN
    RAISE EXCEPTION 'No se permite transferir cámaras ni cambiar su identidad de transmisión';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.branch_camera_guard_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_branch_camera_guard ON public.branch_cameras;
CREATE TRIGGER trg_branch_camera_guard
  BEFORE UPDATE ON public.branch_cameras
  FOR EACH ROW EXECUTE FUNCTION public.branch_camera_guard_update();

COMMENT ON TABLE public.branch_cameras IS 'Private owner-scoped camera directory; video gateway must authorize streams independently and must not expose RTSP credentials in client.';