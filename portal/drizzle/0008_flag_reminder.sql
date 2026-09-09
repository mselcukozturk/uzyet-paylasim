-- IF NOT EXISTS: bu sütun prod'a migrate.mjs dışında bir yolla eklenmişti, bu yüzden
-- _migrations kaydı yokken sütun vardı ve migration tekrar çalıştırılamıyordu (9 Eyl 2026).
-- Idempotent hâli, kayıt ile gerçek şemanın ayrıştığı ortamlarda da güvenle çalışır.
ALTER TABLE "question_flags" ADD COLUMN IF NOT EXISTS "is_reminder" boolean NOT NULL DEFAULT false;
