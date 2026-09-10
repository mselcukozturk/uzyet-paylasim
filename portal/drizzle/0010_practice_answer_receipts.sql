CREATE TABLE IF NOT EXISTS "practice_answer_receipts" (
  "user_id" text NOT NULL,
  "request_id" text NOT NULL,
  "question_guid" text NOT NULL,
  "selected_answer" text NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "practice_answer_receipts_user_request_unique" UNIQUE ("user_id", "request_id")
);
