CREATE TABLE IF NOT EXISTS "klasik_sorular" (
  "no" text PRIMARY KEY NOT NULL,
  "sira" integer NOT NULL,
  "kategori" text NOT NULL,
  "soru" text NOT NULL,
  "durum" text NOT NULL,
  "cevap" jsonb NOT NULL,
  "ipuclari" jsonb NOT NULL,
  "version" text NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "klasik_gorulme" (
  "user_id" text NOT NULL,
  "soru_no" text NOT NULL,
  "gorulme_zamani" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "klasik_gorulme_user_soru_unique" UNIQUE ("user_id", "soru_no")
);
