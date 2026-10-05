ALTER TABLE "klasik_sorular" ADD COLUMN IF NOT EXISTS "konu" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "klasik_sorular" ADD COLUMN IF NOT EXISTS "kontrol" text DEFAULT 'edilecek' NOT NULL;--> statement-breakpoint
ALTER TABLE "klasik_sorular" ADD COLUMN IF NOT EXISTS "guncellik_notu" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "klasik_isaret" (
  "user_id" text NOT NULL,
  "soru_no" text NOT NULL,
  "isaret" text NOT NULL,
  "guncelleme_zamani" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "klasik_isaret_user_soru_unique" UNIQUE ("user_id", "soru_no")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "klasik_geri_bildirim" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "soru_no" text NOT NULL,
  "metin" text NOT NULL,
  "olusturma_zamani" timestamp with time zone DEFAULT now() NOT NULL,
  "durum" text DEFAULT 'bekliyor' NOT NULL
);
