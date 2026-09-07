ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_selected_index_check" CHECK ("exam_answers"."selected_index" between 0 and 3);--> statement-breakpoint
ALTER TABLE "exam_attempt_questions" ADD CONSTRAINT "attempt_question_position_check" CHECK ("exam_attempt_questions"."position" between 1 and 50);--> statement-breakpoint
ALTER TABLE "exam_attempt_questions" ADD CONSTRAINT "attempt_question_correct_index_check" CHECK ("exam_attempt_questions"."correct_index" between 0 and 3);--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_elapsed_check" CHECK ("exam_attempts"."elapsed_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_score_check" CHECK ("exam_attempts"."score_percent" is null or "exam_attempts"."score_percent" between 0 and 100);--> statement-breakpoint
ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_count_check" CHECK ("question_banks"."question_count" >= 0);--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_options_check" CHECK (jsonb_typeof("questions"."options") = 'array' and jsonb_array_length("questions"."options") between 2 and 4);--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_correct_index_check" CHECK ("questions"."correct_index" between 0 and 3);