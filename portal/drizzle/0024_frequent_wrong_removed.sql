ALTER TABLE "question_stats" ADD COLUMN IF NOT EXISTS "frequent_wrong_removed" boolean DEFAULT false NOT NULL;
