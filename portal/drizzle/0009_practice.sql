CREATE TABLE IF NOT EXISTS "practice_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "guid" text NOT NULL,
  "topic" text NOT NULL,
  "modul" text NOT NULL,
  "prompt" text NOT NULL,
  "options" jsonb NOT NULL,
  "correct_index" smallint NOT NULL,
  "explanation" text DEFAULT '' NOT NULL,
  "source" text DEFAULT '' NOT NULL,
  "version" text NOT NULL,
  CONSTRAINT "practice_questions_guid_unique" UNIQUE ("guid"),
  CONSTRAINT "practice_questions_options_check" CHECK (jsonb_typeof("options") = 'array' and jsonb_array_length("options") between 2 and 4),
  CONSTRAINT "practice_questions_correct_index_check" CHECK ("correct_index" between 0 and 3)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_questions_topic_modul_idx" ON "practice_questions" USING btree ("topic", "modul");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "practice_checkpoints" (
  "id" text PRIMARY KEY NOT NULL,
  "topic" text NOT NULL,
  "title" text NOT NULL,
  "subtitle" text DEFAULT '' NOT NULL,
  "html" text NOT NULL,
  "sira" integer DEFAULT 0 NOT NULL,
  "version" text NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "practice_stats" (
  "user_id" text NOT NULL,
  "question_guid" text NOT NULL,
  "shown_count" integer DEFAULT 0 NOT NULL,
  "correct_count" integer DEFAULT 0 NOT NULL,
  "wrong_count" integer DEFAULT 0 NOT NULL,
  "last_result" boolean,
  "last_seen_at" timestamp with time zone,
  CONSTRAINT "practice_stats_user_guid_unique" UNIQUE ("user_id", "question_guid")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "practice_sessions" (
  "user_id" text NOT NULL,
  "topic" text NOT NULL,
  "modul" text NOT NULL,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "practice_sessions_user_topic_modul_unique" UNIQUE ("user_id", "topic", "modul")
);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "can_see_ai_sources" boolean DEFAULT false NOT NULL;
