ALTER TABLE "klasik_isaret" ADD COLUMN IF NOT EXISTS "hatirlatici" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "klasik_isaret" ALTER COLUMN "isaret" DROP NOT NULL;
