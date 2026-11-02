ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS favorite_providers text[] NOT NULL DEFAULT '{}';
