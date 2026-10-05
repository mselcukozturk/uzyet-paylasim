CREATE TABLE IF NOT EXISTS "klasik_gunun_secimi" (
	"gun" text PRIMARY KEY NOT NULL,
	"sorular" text[] NOT NULL,
	"olusturma_zamani" timestamp with time zone DEFAULT now() NOT NULL
);
