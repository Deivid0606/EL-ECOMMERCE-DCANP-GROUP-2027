-- Aplicado en la base como: seller_payout_kyc, payout_missing_fix, admin_users_overview.
-- Perfil completo para cobrar: datos personales, cobro (banco o billetera),
-- cédula (frente y dorso) y selfie con la cédula (bucket privado kyc-documents).
-- commission_request_payout (BEFORE INSERT en commission_requests) bloquea la
-- solicitud si falta algo y guarda solos los datos de cobro en meta_json.payout.
-- admin_users_overview(): última conexión, ventas, comisión pendiente y perfil.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS id_front_path text,
  ADD COLUMN IF NOT EXISTS id_back_path text,
  ADD COLUMN IF NOT EXISTS selfie_path text,
  ADD COLUMN IF NOT EXISTS payout_method text NOT NULL DEFAULT 'bank';
INSERT INTO storage.buckets (id, name, public) VALUES ('kyc-documents', 'kyc-documents', false) ON CONFLICT (id) DO NOTHING;
-- (políticas de storage, payout_missing, my_payout_status, commission_request_payout,
--  sellers_payout_status y admin_users_overview: ver la base de datos)
