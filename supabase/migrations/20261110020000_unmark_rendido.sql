-- ↩️ Quitar RENDIDO (admin / proveedor) a pedidos marcados por error.
-- No se tocan pedidos que ya están en un comprobante de cierre del delivery ni rendiciones pagadas.
CREATE OR REPLACE FUNCTION public.unmark_rendido(p_order_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text := public.current_profile_email(); v_role text; v_ok uuid[]; v_skipped int;
BEGIN
  SELECT upper(ur.role::text) INTO v_role FROM public.user_roles ur
  WHERE ur.user_id = auth.uid() AND coalesce(ur.approved, false) AND upper(ur.role::text) IN ('ADMIN', 'PROVEEDOR')
  ORDER BY CASE upper(ur.role::text) WHEN 'ADMIN' THEN 1 ELSE 2 END LIMIT 1;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Solo admin o proveedor pueden quitar RENDIDO'; END IF;

  SELECT coalesce(array_agg(o.id), '{}') INTO v_ok FROM public.orders o
  WHERE o.id = ANY (p_order_ids)
    AND (coalesce(o.delivery_settled, false) OR upper(coalesce(o.status2, '')) = 'RENDIDO')
    AND o.delivery_paid_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.delivery_closure_orders d WHERE d.order_id = o.id)
    AND (v_role = 'ADMIN' OR lower(trim(coalesce(o.provider_email, ''))) = v_email);
  v_skipped := cardinality(p_order_ids) - cardinality(v_ok);
  IF cardinality(v_ok) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'skipped', v_skipped);
  END IF;

  INSERT INTO public.order_status_history (order_id, previous_status, new_status, changed_by_email, changed_by_role, message, event_type)
  SELECT o.id, coalesce(o.status, 'PENDIENTE'), coalesce(o.status, 'PENDIENTE'), v_email, v_role, '↩️ Quitó RENDIDO', 'edit'
  FROM public.orders o WHERE o.id = ANY (v_ok);

  -- Se conserva la fecha original de la guía (el guard la pondría en hoy).
  CREATE TEMP TABLE IF NOT EXISTS _unrendido (id uuid, g timestamptz) ON COMMIT DROP;
  DELETE FROM _unrendido;
  INSERT INTO _unrendido SELECT o.id, o.guide_generated_at FROM public.orders o WHERE o.id = ANY (v_ok);
  UPDATE public.orders o SET delivery_settled = false,
    status2 = CASE WHEN u.g IS NOT NULL THEN 'GUIA GENERADA' ELSE '--' END, updated_at = now()
  FROM _unrendido u WHERE o.id = u.id AND upper(coalesce(o.status2, '')) = 'RENDIDO';
  UPDATE public.orders o SET delivery_settled = false, updated_at = now()
  FROM _unrendido u WHERE o.id = u.id AND coalesce(o.delivery_settled, false);
  UPDATE public.orders o SET guide_generated_at = u.g FROM _unrendido u WHERE o.id = u.id;

  RETURN jsonb_build_object('updated', cardinality(v_ok), 'skipped', v_skipped);
END; $$;
REVOKE ALL ON FUNCTION public.unmark_rendido(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.unmark_rendido(uuid[]) TO authenticated;
