CREATE TABLE IF NOT EXISTS "klasik_ses" (
	"soru_no" text NOT NULL,
	"tur" text NOT NULL,
	"surum" text NOT NULL,
	"veri" bytea NOT NULL,
	"guncelleme_zamani" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "klasik_ses_soru_no_tur_pk" PRIMARY KEY("soru_no","tur")
);
