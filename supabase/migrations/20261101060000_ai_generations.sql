-- Registro de usos de la IA (límite diario por usuario).
CREATE TABLE IF NOT EXISTS public.ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  kind text NOT NULL DEFAULT 'landing_copy',
  product_title text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_generations_user_day ON public.ai_generations (user_email, created_at DESC);
ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;
-- Sin políticas: sólo la función del servidor (service role) lee y escribe.
