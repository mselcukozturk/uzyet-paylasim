import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const examMode = pgEnum('exam_mode', ['rastgele', 'azgorulen', 'yanlislar']);
export const attemptStatus = pgEnum('attempt_status', ['active', 'paused', 'finished', 'cancelled']);

export const profiles = pgTable('profiles', {
  userId: text('user_id').primaryKey(),
  email: text('email'),
  username: text('username').notNull(),
  displayName: text('display_name'),
  isActive: boolean('is_active').notNull().default(false),
  isAdmin: boolean('is_admin').notNull().default(false),
  disclaimerAcceptedAt: timestamp('disclaimer_accepted_at', { withTimezone: true }),
  pinEncrypted: text('pin_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('profiles_email_lower_idx').on(table.email),
  uniqueIndex('profiles_username_lower_idx').on(table.username),
]);

export const questionBanks = pgTable('question_banks', {
  id: uuid('id').primaryKey().defaultRandom(),
  version: text('version').notNull().unique(),
  questionCount: integer('question_count').notNull(),
  isActive: boolean('is_active').notNull().default(false),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('question_banks_count_check', sql`${table.questionCount} >= 0`),
  uniqueIndex('one_active_question_bank').on(table.isActive).where(sql`${table.isActive} = true`),
]);

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  bankId: uuid('bank_id').notNull().references(() => questionBanks.id, { onDelete: 'restrict' }),
  guid: text('guid').notNull(),
  topic: text('topic').notNull(),
  prompt: text('prompt').notNull(),
  options: jsonb('options').$type<string[]>().notNull(),
  correctIndex: smallint('correct_index').notNull(),
  explanation: text('explanation').notNull().default(''),
  source: text('source').notNull().default(''),
  verified: boolean('verified').notNull().default(false),
}, (table) => [
  unique('questions_bank_guid_unique').on(table.bankId, table.guid),
  check('questions_options_check', sql`jsonb_typeof(${table.options}) = 'array' and jsonb_array_length(${table.options}) between 2 and 4`),
  check('questions_correct_index_check', sql`${table.correctIndex} between 0 and 3`),
  index('questions_bank_topic_idx').on(table.bankId, table.topic),
]);

export const examAttempts = pgTable('exam_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  bankId: uuid('bank_id').notNull().references(() => questionBanks.id, { onDelete: 'restrict' }),
  mode: examMode('mode').notNull(),
  status: attemptStatus('status').notNull().default('active'),
  // Bilerek UNIQUE değil: aynı kod (özellikle "rastgele" modda) farklı kullanıcılarca
  // paylaşılıp aynı anda kullanılabilmeli — kod aramaya değil, yalnız görüntü/yeniden
  // türetmeye yarar (bkz. /api/exam "start" examCode dalı). Eskiden UNIQUE'ti; ikinci
  // kullanıcı aynı kodu girince INSERT çakışması 500 hatası veriyordu (8 Eyl 2026 bulundu).
  examCode: text('exam_code').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastResumedAt: timestamp('last_resumed_at', { withTimezone: true }).defaultNow(),
  elapsedSeconds: integer('elapsed_seconds').notNull().default(0),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  correctCount: integer('correct_count'),
  wrongCount: integer('wrong_count'),
  blankCount: integer('blank_count'),
  scorePercent: integer('score_percent'),
  statsApplied: boolean('stats_applied').notNull().default(false),
}, (table) => [
  uniqueIndex('one_open_exam_per_user').on(table.userId).where(sql`${table.status} in ('active', 'paused')`),
  check('exam_attempts_elapsed_check', sql`${table.elapsedSeconds} >= 0`),
  check('exam_attempts_score_check', sql`${table.scorePercent} is null or ${table.scorePercent} between 0 and 100`),
  index('exam_attempts_user_updated_idx').on(table.userId, table.updatedAt),
]);

export const examAttemptQuestions = pgTable('exam_attempt_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  attemptId: uuid('attempt_id').notNull().references(() => examAttempts.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'restrict' }),
  questionGuid: text('question_guid').notNull(),
  position: smallint('position').notNull(),
  topic: text('topic').notNull(),
  prompt: text('prompt').notNull(),
  options: jsonb('options').$type<string[]>().notNull(),
  correctIndex: smallint('correct_index').notNull(),
  explanation: text('explanation').notNull().default(''),
}, (table) => [
  unique('attempt_question_position_unique').on(table.attemptId, table.position),
  unique('attempt_question_source_unique').on(table.attemptId, table.questionId),
  check('attempt_question_position_check', sql`${table.position} between 1 and 50`),
  check('attempt_question_correct_index_check', sql`${table.correctIndex} between 0 and 3`),
]);

export const examAnswers = pgTable('exam_answers', {
  attemptQuestionId: uuid('attempt_question_id').primaryKey().references(() => examAttemptQuestions.id, { onDelete: 'cascade' }),
  selectedIndex: smallint('selected_index').notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check('exam_answers_selected_index_check', sql`${table.selectedIndex} between 0 and 3`)]);

export const questionStats = pgTable('question_stats', {
  userId: text('user_id').notNull(),
  questionGuid: text('question_guid').notNull(),
  shownCount: integer('shown_count').notNull().default(0),
  correctCount: integer('correct_count').notNull().default(0),
  wrongCount: integer('wrong_count').notNull().default(0),
  lastResult: boolean('last_result'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, (table) => [unique('question_stats_user_guid_unique').on(table.userId, table.questionGuid)]);

export const questionFlags = pgTable('question_flags', {
  userId: text('user_id').notNull(),
  questionGuid: text('question_guid').notNull(),
  note: text('note').notNull().default(''),
  category: text('category'),
  isReported: boolean('is_reported').notNull().default(true),
  isReminder: boolean('is_reminder').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique('question_flags_user_guid_unique').on(table.userId, table.questionGuid)]);

// Sıradan kullanıcılar için parolasız oturum: yalnız kullanıcı adı ile istek, yönetici onayı bekler.
// Yönetici girişi ayrıca profiles.isAdmin + Neon Auth (e-posta/parola) ile yapılır.
export const userSessions = pgTable('user_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => profiles.userId, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('user_sessions_user_idx').on(table.userId)]);
