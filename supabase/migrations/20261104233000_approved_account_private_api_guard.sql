-- Revoked accounts must not query private application data even with a valid old JWT.
-- Public tracking/landing endpoints remain unchanged; they require separate access rules.
CREATE OR REPLACE FUNCTION public.app_account_approved()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $guard$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles AS r
    WHERE r.user_id = auth.uid() AND r.approved IS TRUE
  );
$guard$;
REVOKE ALL ON FUNCTION public.app_account_approved() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_account_approved() TO authenticated;

DO $guard$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ad_spend',
    'ai_generations',
    'chat_channels',
    'chat_dm_messages',
    'chat_message_reads',
    'chat_messages',
    'client_prices',
    'closure_bank_destinations',
    'closure_nodate_rules',
    'commission_requests',
    'delivery_attempt_payments',
    'delivery_closure_orders',
    'delivery_closure_recovery',
    'delivery_closure_submissions',
    'delivery_day_closures',
    'delivery_fees',
    'delivery_status_pay',
    'delivery_stock',
    'delivery_stock_movements',
    'delivery_team_members',
    'delivery_team_receipt_orders',
    'delivery_team_receipts',
    'dispatcher_providers',
    'notification_preferences',
    'order_sequence',
    'order_status_history',
    'order_stock_ledger',
    'orders',
    'product_title_mappings',
    'products',
    'push_queue',
    'push_subscriptions',
    'rendiciones_pagadas',
    'role_change_audit',
    'seller_store_settings',
    'sheet_row_statuses',
    'shopify_autoload_settings',
    'store_order_imports',
    'user_favorites',
    'wallet_transactions',
    'wallets'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=table_name
        AND policyname='approved_account_required'
    ) THEN
      EXECUTE format(
        'CREATE POLICY approved_account_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.app_account_approved())) WITH CHECK ((SELECT public.app_account_approved()))',
        table_name
      );
    END IF;
  END LOOP;
END;
$guard$;

-- Two legacy RPCs were reachable without login and bypassed normal RLS.
-- The administration UI operates through user_roles and does not call these.
REVOKE ALL ON FUNCTION public.approve_user(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_all_orders_without_limit() FROM PUBLIC, anon, authenticated;
