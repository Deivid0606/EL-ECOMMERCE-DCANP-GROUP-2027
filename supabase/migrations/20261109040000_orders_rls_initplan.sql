-- Rendimiento: las reglas de lectura de pedidos calculaban rol/email por CADA pedido.
-- Con (SELECT ...) se calculan una sola vez por consulta. Quién ve qué no cambia.
DROP POLICY IF EXISTS orders_select_policy ON public.orders;
CREATE POLICY orders_select_policy ON public.orders FOR SELECT USING (
  (SELECT public.is_admin())
  OR (SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'DESPACHANTE'::public.app_role))
  OR ((SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'PROVEEDOR'::public.app_role)) AND lower(TRIM(BOTH FROM provider_email)) = (SELECT public.current_user_email()))
  OR ((SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'VENDEDOR'::public.app_role)) AND lower(TRIM(BOTH FROM created_by)) = (SELECT public.current_user_email()))
  OR ((SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'DELIVERY'::public.app_role)) AND (assigned_delivery IS NULL OR lower(TRIM(BOTH FROM assigned_delivery)) = (SELECT public.current_user_email())))
);

DROP POLICY IF EXISTS delivery_can_view_owned_or_assigned_orders ON public.orders;
CREATE POLICY delivery_can_view_owned_or_assigned_orders ON public.orders FOR SELECT TO authenticated USING (
  (SELECT public.current_user_has_role(ARRAY['DELIVERY'::text]))
  AND (lower(COALESCE(delivery_owner, '')) = (SELECT public.current_profile_email()) OR lower(COALESCE(assigned_delivery, '')) = (SELECT public.current_profile_email()))
);

DROP POLICY IF EXISTS team_leader_can_view_member_orders ON public.orders;
CREATE POLICY team_leader_can_view_member_orders ON public.orders FOR SELECT TO authenticated USING (
  (SELECT public.current_user_has_role(ARRAY['ADMIN'::text, 'PROVEEDOR'::text, 'DELIVERY'::text]))
  AND lower(TRIM(BOTH FROM COALESCE(assigned_delivery, ''))) IN (
    SELECT lower(TRIM(BOTH FROM COALESCE(pm.email, '')))
    FROM public.delivery_team_members dt JOIN public.profiles pm ON pm.user_id = dt.member_user_id
    WHERE dt.owner_user_id = (SELECT auth.uid()) AND upper(COALESCE(dt.status, '')) = 'ACCEPTED' AND dt.removed_at IS NULL)
);
