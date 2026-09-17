import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as orm from 'drizzle-orm';
import * as schema from '../lib/db/schema.ts';
import { validatePracticeAnswer } from '../lib/practice-core.ts';
import ts from 'typescript';

test('real Postgres practice writes: retry deduplication, counters, session isolation and size limit', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('create table profiles (user_id text primary key)');
    for (const name of ['0009_practice.sql', '0010_practice_answer_receipts.sql']) {
      const migration = readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8');
      await pg.exec(migration);
      await pg.exec(migration); // Idempotent DDL must also work on a populated schema.
    }
    await pg.exec(`
      create table question_banks (
        id uuid primary key, version text not null unique, question_count integer not null,
        is_active boolean not null default false, imported_at timestamptz not null default now()
      );
      create table questions (
        id uuid primary key, bank_id uuid not null references question_banks(id), guid text not null,
        topic text not null, prompt text not null, options jsonb not null, correct_index smallint not null,
        explanation text not null default '', source text not null default '', verified boolean not null default false
      );
    `);
    const db = drizzle(pg);
    await db.insert(schema.practiceQuestions).values({ guid: 'q1', topic: 'K', modul: 'M', prompt: '?', options: ['A', 'B'], correctIndex: 1, version: 'v1' });
    const bankId = '11111111-1111-4111-8111-111111111111';
    await db.insert(schema.questionBanks).values({ id: bankId, version: 'bank-v1', questionCount: 1, isActive: true });
    await db.insert(schema.questions).values({
      id: '22222222-2222-4222-8222-222222222222', bankId, guid: 'official-q', topic: 'K',
      prompt: 'Resmî soru?', options: ['A', 'B'], correctIndex: 1,
    });
    let userId = 'owner';
    const mocks: Record<string, unknown> = {
      'next/server': { NextResponse: Response }, 'drizzle-orm': orm,
      '@/lib/db': { getDb: () => db, schema }, '@/lib/practice-core': { validatePracticeAnswer },
      '@/lib/auth/session': { getSessionProfile: async () => ({ userId, isActive: true, canSeeAiSources: true, disclaimerAcceptedAt: new Date() }) },
      '@/lib/cors': { withCors: (r: Response) => r }, '@/lib/exam-core': {}, '@/data/bank-corrections.json': [],
    };
    const exports: { POST?: (r: Request) => Promise<Response> } = {};
    const compiled = ts.transpileModule(readFileSync(new URL('../app/api/exam/route.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(compiled, { exports, require: (key: string) => mocks[key], console, Buffer });
    const post = (body: unknown) => exports.POST!(new Request('https://test.invalid/api/exam', { method: 'POST', body: JSON.stringify(body) }));
    const answer = { action: 'practice-answer', questionGuid: 'q1', selectedAnswer: 'B', requestId: 'retry-request-1' };
    const first = await post(answer);
    assert.equal(first.status, 200);
    const expected = await first.json();
    assert.equal(expected.stat.gosterim, 1);
    assert.deepEqual(await (await post(answer)).json(), expected);
    assert.equal((await db.select().from(schema.practiceStats))[0].shownCount, 1);
    assert.equal((await post({ ...answer, selectedAnswer: 'A' })).status, 409);
    assert.equal((await post({ ...answer, requestId: 'retry-request-2', selectedAnswer: 'A' })).status, 200);
    const [stat] = await db.select().from(schema.practiceStats);
    assert.equal(stat.shownCount, 2); assert.equal(stat.correctCount, 1); assert.equal(stat.wrongCount, 1);
    const fallback = await post({
      action: 'practice-answer', questionGuid: 'official-q', selectedAnswer: 'A', requestId: 'retry-request-3',
    });
    assert.equal(fallback.status, 200, 'AI denemesinin resmî banka tamamlaması practice_stats içine yazılmalı');
    const [fallbackStat] = await db.select().from(schema.practiceStats).where(orm.eq(schema.practiceStats.questionGuid, 'official-q'));
    assert.equal(fallbackStat.lastResult, false);
    assert.equal((await post({ ...answer, questionGuid: 'missing' })).status, 400);
    assert.equal((await post({ ...answer, selectedAnswer: 'C' })).status, 400);
    const session = { konu: 'K', modul: 'M', payload: { kuyruk: ['q1'], index: 0, cevaplar: { q1: 1 }, custom: ['opaque'] } };
    assert.equal((await post({ action: 'practice-session-save', ...session })).status, 200);
    assert.deepEqual(await (await post({ action: 'practice-session-load', ...session })).json(), { payload: session.payload });
    userId = 'other';
    assert.deepEqual(await (await post({ action: 'practice-session-load', ...session })).json(), { payload: null });
    await post({ action: 'practice-session-delete', ...session });
    userId = 'owner';
    assert.deepEqual(await (await post({ action: 'practice-session-load', ...session })).json(), { payload: session.payload });
    assert.equal((await post({ action: 'practice-session-save', ...session, payload: 'ş'.repeat(140000) })).status, 413);
    await post({ action: 'practice-session-delete', ...session });
    assert.deepEqual(await (await post({ action: 'practice-session-load', ...session })).json(), { payload: null });
  } finally { await pg.close(); }
});
