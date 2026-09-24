CREATE TABLE IF NOT EXISTS "fixed_exams" (
  "code" text PRIMARY KEY,
  "title" text NOT NULL,
  "question_guids" text[] NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
