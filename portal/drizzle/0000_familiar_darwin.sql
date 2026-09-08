CREATE TYPE "public"."attempt_status" AS ENUM('active', 'paused', 'finished', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."exam_mode" AS ENUM('rastgele', 'azgorulen', 'yanlislar');--> statement-breakpoint
CREATE TABLE "exam_answers" (
	"attempt_question_id" uuid PRIMARY KEY NOT NULL,
	"selected_index" smallint NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_attempt_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_guid" text NOT NULL,
	"position" smallint NOT NULL,
	"topic" text NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_index" smallint NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	CONSTRAINT "attempt_question_position_unique" UNIQUE("attempt_id","position"),
	CONSTRAINT "attempt_question_source_unique" UNIQUE("attempt_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "exam_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"bank_id" uuid NOT NULL,
	"mode" "exam_mode" NOT NULL,
	"status" "attempt_status" DEFAULT 'active' NOT NULL,
	"exam_code" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_resumed_at" timestamp with time zone DEFAULT now(),
	"elapsed_seconds" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correct_count" integer,
	"wrong_count" integer,
	"blank_count" integer,
	"score_percent" integer,
	"stats_applied" boolean DEFAULT false NOT NULL,
	CONSTRAINT "exam_attempts_exam_code_unique" UNIQUE("exam_code")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"question_count" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_banks_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "question_flags" (
	"user_id" text NOT NULL,
	"question_guid" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"is_reported" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_flags_user_guid_unique" UNIQUE("user_id","question_guid")
);
--> statement-breakpoint
CREATE TABLE "question_stats" (
	"user_id" text NOT NULL,
	"question_guid" text NOT NULL,
	"shown_count" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"wrong_count" integer DEFAULT 0 NOT NULL,
	"last_result" boolean,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "question_stats_user_guid_unique" UNIQUE("user_id","question_guid")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"topic" text NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_index" smallint NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "questions_bank_guid_unique" UNIQUE("bank_id","guid")
);
--> statement-breakpoint
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_attempt_question_id_exam_attempt_questions_id_fk" FOREIGN KEY ("attempt_question_id") REFERENCES "public"."exam_attempt_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempt_questions" ADD CONSTRAINT "exam_attempt_questions_attempt_id_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."exam_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempt_questions" ADD CONSTRAINT "exam_attempt_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_bank_id_question_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."question_banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_bank_id_question_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."question_banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_exam_per_user" ON "exam_attempts" USING btree ("user_id") WHERE "exam_attempts"."status" in ('active', 'paused');--> statement-breakpoint
CREATE INDEX "exam_attempts_user_updated_idx" ON "exam_attempts" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_email_lower_idx" ON "profiles" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username_lower_idx" ON "profiles" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_question_bank" ON "question_banks" USING btree ("is_active") WHERE "question_banks"."is_active" = true;--> statement-breakpoint
CREATE INDEX "questions_bank_topic_idx" ON "questions" USING btree ("bank_id","topic");