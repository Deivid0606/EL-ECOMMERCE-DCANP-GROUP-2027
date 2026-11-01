-- Auto-carga de Pedidos Shopify en el servidor (funciona sin la app abierta).
CREATE TABLE IF NOT EXISTS public.shopify_autoload_settings (
  user_email text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  city_aliases jsonb NOT NULL DEFAULT '{}'::jsonb,
  product_aliases jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled_at timestamptz,
  last_run_at timestamptz,
  last_result jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shopify_autoload_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own autoload select" ON public.shopify_autoload_settings FOR SELECT TO authenticated
  USING (lower(user_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), '')));
CREATE POLICY "own autoload insert" ON public.shopify_autoload_settings FOR INSERT TO authenticated
  WITH CHECK (lower(user_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), '')));
CREATE POLICY "own autoload update" ON public.shopify_autoload_settings FOR UPDATE TO authenticated
  USING (lower(user_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), '')))
  WITH CHECK (lower(user_email) = lower(coalesce((SELECT email FROM public.profiles WHERE user_id = auth.uid()), '')));

-- Cada 5 minutos el servidor revisa los Sheets con auto-carga activa.
SELECT cron.unschedule('skyline-shopify-autoload') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'skyline-shopify-autoload');
SELECT cron.schedule(
  'skyline-shopify-autoload',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://mnpbwoknqwsjtiyrrxbm.supabase.co/functions/v1/shopify-autoload',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_dispatch_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
