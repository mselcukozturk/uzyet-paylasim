ALTER TABLE daily_exams DROP CONSTRAINT IF EXISTS daily_exams_number_check;
ALTER TABLE daily_exams ADD CONSTRAINT daily_exams_number_check CHECK (number IN (1, 2, 3));
