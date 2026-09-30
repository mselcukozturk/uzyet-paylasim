ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS daily_day text;
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS daily_number smallint;
CREATE TABLE IF NOT EXISTS daily_exams (
  code text PRIMARY KEY,
  day text NOT NULL,
  number smallint NOT NULL CHECK (number IN (1, 2)),
  bank_id uuid NOT NULL REFERENCES question_banks(id) ON DELETE RESTRICT,
  snapshots jsonb NOT NULL CHECK (jsonb_array_length(snapshots) = 50),
  CONSTRAINT daily_exams_day_number_unique UNIQUE (day, number)
);
