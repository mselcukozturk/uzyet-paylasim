import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as orm from 'drizzle-orm';
import * as schema from '../lib/db/schema.ts';
import * as examCore from '../lib/exam-core.ts';
import ts from 'typescript';

test('günün denemesi 07:00 (İstanbul) sınırında değişir, kod gizli anahtara bağlıdır', () => {
  assert.equal(examCore.dailyExamDay(new Date('2026-09-13T03:59:59Z')), '2026-09-12');
  assert.equal(examCore.dailyExamDay(new Date('2026-09-13T04:00:00Z')), '2026-09-13');
  assert.notEqual(examCore.dailyExamCode('2026-09-13', 'a'), examCore.dailyExamCode('2026-09-13', 'b'));
  assert.ok(examCore.parseExamCode(examCore.dailyExamCode('2026-09-13', 'a')));
});

test('günün denemesi: herkese aynı sorular; ortalama kişi başı ilk bitmiş denemeden, yalnız çözene', async () => {
  const pg = new PGlite();
  try {
    for (const name of (await readdir(new URL('../drizzle/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort()) {
      await pg.exec(await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
    }
    const db = drizzle(pg);
    const [bank] = await db.insert(schema.questionBanks).values({ version: 'v1', questionCount: 50, isActive: true }).returning();
    await db.insert(schema.questions).values(Object.entries(examCore.OFFICIAL_DISTRIBUTION).flatMap(([topic, n]) =>
      Array.from({ length: n }, (_, i) => ({
        bankId: bank.id, guid: `${topic}-${i}`, topic, prompt: `${topic} ${i}`, options: ['A', 'B', 'C', 'D'], correctIndex: 0,
      }))));

    const user = { current: 'alice' };
    const mocks: Record<string, unknown> = {
      'next/server': { NextResponse: Response }, 'drizzle-orm': orm,
      '@/lib/db': { getDb: () => db, schema }, '@/lib/exam-core': examCore, '@/lib/practice-core': {},
      '@/lib/auth/session': { getSessionProfile: async () => ({ userId: user.current, isActive: true, canSeeAiSources: true, disclaimerAcceptedAt: new Date() }) },
      '@/lib/cors': { withCors: (r: Response) => r }, '@/data/bank-corrections.json': [],
    };
    const exports: { POST?: (r: Request) => Promise<Response> } = {};
    const compiled = ts.transpileModule(readFileSync(new URL('../app/api/exam/route.ts', import.meta.url), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(compiled, { exports, require: (key: string) => mocks[key], console, Buffer, crypto: globalThis.crypto });
    const post = async (body: unknown) => {
      const res = await exports.POST!(new Request('https://test.invalid/api/exam', { method: 'POST', body: JSON.stringify(body) }));
      return { status: res.status, data: await res.json() };
    };

    // correctCount soruyu doğru cevaplayıp bitirir; soru guid'lerini sırasıyla döner.
    const solve = async (correctCount: number) => {
      const started = await post({ action: 'start', mode: 'rastgele', daily: true });
      assert.equal(started.status, 200, JSON.stringify(started.data));
      const rows = await db.select().from(schema.examAttemptQuestions)
        .where(orm.eq(schema.examAttemptQuestions.attemptId, started.data.id)).orderBy(schema.examAttemptQuestions.position);
      for (const row of rows.slice(0, correctCount)) {
        assert.equal((await post({ action: 'answer', attemptId: started.data.id, questionId: row.id, selectedIndex: row.correctIndex })).status, 200);
      }
      assert.equal((await post({ action: 'finish', attemptId: started.data.id })).status, 200);
      return { code: started.data.examCode as string, guids: rows.map((row) => row.questionGuid) };
    };

    const alice = await solve(40); // %80
    user.current = 'bob';
    const bobBefore = (await post({ action: 'dashboard' })).data.daily;
    assert.deepEqual(bobBefore, { day: examCore.dailyExamDay(), code: alice.code, solvedCount: 1, myPercent: null, avgPercent: null });

    const bob = await solve(20); // %40
    assert.deepEqual(bob.guids, alice.guids);

    user.current = 'alice';
    await solve(50); // tekrar çözüm ortalamayı değiştirmemeli
    const aliceDaily = (await post({ action: 'dashboard' })).data.daily;
    assert.equal(aliceDaily.solvedCount, 2);
    assert.equal(aliceDaily.myPercent, 80);
    assert.equal(aliceDaily.avgPercent, 60);
  } finally { await pg.close(); }
});
