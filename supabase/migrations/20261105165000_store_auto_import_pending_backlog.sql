-- Backfill old pending sales when a seller enables global automatic import.
-- Retain all coverage, product, price, stock and idempotency checks in
-- store_auto_import_order_trigger, also used for live checkout inserts.
DROP TRIGGER IF EXISTS trg_store_auto_import_pending_retry ON public.landing_page_orders;
CREATE TRIGGER trg_store_auto_import_pending_retry
  AFTER UPDATE OF landing_page_id ON public.landing_page_orders
  FOR EACH ROW WHEN (NEW.system_status IN ('pending', 'opened'))
  EXECUTE FUNCTION public.store_auto_import_order_trigger();

CREATE OR REPLACE FUNCTION public.store_run_pending_auto_import_for_user(
  p_user_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $body$
DECLARE
  v_email text;
  v_processed integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Parámetros inválidos';
  END IF;
  SELECT lower(trim(p.email)) INTO v_email
    FROM public.profiles p
    JOIN public.user_roles r ON r.user_id=p.user_id AND r.approved IS TRUE
    WHERE p.user_id=p_user_id AND p.approved IS TRUE
      AND lower(p.role) IN ('admin','administrador','vendedor','seller')
    LIMIT 1;
  IF v_email IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.store_seller_auto_import_settings s
    WHERE s.user_id=p_user_id AND s.enabled IS TRUE
  ) THEN
    RETURN 0;
  END IF;

  -- Updating the unchanged page ID safely invokes the existing server import
  -- logic for a pending order. The nested trigger guards against duplicates
  -- and records the reason if any prerequisite fails.
  WITH candidates AS (
    SELECT o.id
    FROM public.landing_page_orders o
    JOIN public.landing_pages p ON p.id=o.landing_page_id
    WHERE lower(trim(o.seller_email))=v_email
      AND lower(trim(p.owner_email))=v_email
      AND p.status='published'
      AND coalesce(o.system_status,'pending') IN ('pending','opened')
      AND NOT EXISTS (
        SELECT 1 FROM public.store_order_imports m WHERE m.source_order_id=o.id
      )
    ORDER BY o.created_at DESC
    LIMIT p_limit
  )
  UPDATE public.landing_page_orders o
     SET landing_page_id=o.landing_page_id
    FROM candidates c
   WHERE o.id=c.id;
  GET DIAGNOSTICS v_processed = ROW_COUNT;
  RETURN v_processed;
END
$body$;
REVOKE ALL ON FUNCTION public.store_run_pending_auto_import_for_user(uuid,integer)
  FROM PUBLIC, anon, authenticated;

-- The switch remains restricted to the signed-in, approved seller.
-- When enabled, attempt the backlog immediately, without requiring a dashboard.
CREATE OR REPLACE FUNCTION public.store_set_auto_import_enabled(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $body$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Sesión o valor inválido';
  END IF;
  IF NOT public.app_account_approved() OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles r ON r.user_id=p.user_id AND r.approved IS TRUE
    WHERE p.user_id=v_uid AND lower(p.role) IN ('admin','administrador','vendedor','seller')
  ) THEN
    RAISE EXCEPTION 'Cuenta sin autorización para activar cargas automáticas';
  END IF;
  INSERT INTO public.store_seller_auto_import_settings(user_id,enabled,updated_at)
  VALUES(v_uid,p_enabled,now())
  ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now();
  IF p_enabled THEN
    PERFORM public.store_run_pending_auto_import_for_user(v_uid,100);
  END IF;
  RETURN p_enabled;
END
$body$;
REVOKE ALL ON FUNCTION public.store_set_auto_import_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_set_auto_import_enabled(boolean) TO authenticated;

-- Seller had already switched ON before the backfill behavior existed.
-- Process its existing pending orders once as part of the migration.
DO $body$
DECLARE
  v_user record;
BEGIN
  FOR v_user IN SELECT user_id FROM public.store_seller_auto_import_settings
    WHERE enabled IS TRUE
  LOOP
    PERFORM public.store_run_pending_auto_import_for_user(v_user.user_id,100);
  END LOOP;
END
$body$;
