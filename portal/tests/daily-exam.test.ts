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

// Gerçek route, PGlite üstünde. Oturumdaki kullanıcı "x-user" başlığından gelir.
async function kur() {
  const pg = new PGlite();
  for (const name of (await readdir(new URL('../drizzle/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
  }
  const db = drizzle(pg);
  const [bank] = await db.insert(schema.questionBanks).values({ version: 'v1', questionCount: 50, isActive: true }).returning();
  await db.insert(schema.questions).values(Object.entries(examCore.OFFICIAL_DISTRIBUTION).flatMap(([topic, n]) =>
    Array.from({ length: n }, (_, i) => ({
      bankId: bank.id, guid: `${topic}-${i}`, topic, prompt: `${topic} ${i}`, options: ['A', 'B', 'C', 'D'], correctIndex: 0,
    }))));

  const mocks: Record<string, unknown> = {
    'next/server': { NextResponse: Response }, 'drizzle-orm': orm,
    '@/lib/db': { getDb: () => db, schema }, '@/lib/exam-core': examCore, '@/lib/practice-core': {},
    '@/lib/auth/session': {
      getSessionProfile: async (request: Request) => ({
        userId: request.headers.get('x-user'), isActive: true, canSeeAiSources: true, disclaimerAcceptedAt: new Date(),
      }),
    },
    '@/lib/cors': { withCors: (r: Response) => r }, '@/data/bank-corrections.json': [],
  };
  const exports: { POST?: (r: Request) => Promise<Response> } = {};
  const compiled = ts.transpileModule(readFileSync(new URL('../app/api/exam/route.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { exports, require: (key: string) => mocks[key], console, Buffer, crypto: globalThis.crypto });
  const post = async (userId: string, body: unknown) => {
    const res = await exports.POST!(new Request('https://test.invalid/api/exam', {
      method: 'POST', headers: { 'x-user': userId }, body: JSON.stringify(body),
    }));
    return { status: res.status, data: await res.json() };
  };
  return { pg, db, bank, post };
}

type Started = { id: string; examCode: string; isDaily: boolean; questions: Array<{ guid: string; position: number }> };
const guids = (d: Started) => [...d.questions].sort((a, b) => a.position - b.position).map((q) => q.guid);

test('günün denemesi: aynı anda ilk kez başlayana da aynı sorular; ortalama kişi başı ilk bitmiş denemeden, yalnız çözene', async () => {
  const { pg, db, post } = await kur();
  try {
    const start = async (userId: string) => {
      const r = await post(userId, { action: 'start', mode: 'rastgele', daily: true });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.isDaily, true);
      return r.data as Started;
    };
    // correctCount soruyu doğru cevaplayıp bitirir.
    const finish = async (userId: string, attemptId: string, correctCount: number) => {
      const rows = await db.select().from(schema.examAttemptQuestions)
        .where(orm.eq(schema.examAttemptQuestions.attemptId, attemptId)).orderBy(schema.examAttemptQuestions.position);
      for (const row of rows.slice(0, correctCount)) {
        assert.equal((await post(userId, { action: 'answer', attemptId, questionId: row.id, selectedIndex: row.correctIndex })).status, 200);
      }
      assert.equal((await post(userId, { action: 'finish', attemptId })).status, 200);
    };

    const [alice, bob] = await Promise.all([start('alice'), start('bob')]);
    assert.deepEqual(guids(bob), guids(alice));

    await finish('alice', alice.id, 40);
    assert.deepEqual((await post('carol', { action: 'dashboard' })).data.daily,
      { day: examCore.dailyExamDay(), code: alice.examCode, solvedCount: 1, myCorrect: null, avgCorrect: null });

    await finish('bob', bob.id, 21); // ortalama (40 + 21) / 2 = 30,5
    const again = await start('alice');
    assert.deepEqual(guids(again), guids(alice));
    await finish('alice', again.id, 50); // tekrar çözüm ortalamayı değiştirmemeli

    const aliceDaily = (await post('alice', { action: 'dashboard' })).data.daily;
    assert.equal(aliceDaily.solvedCount, 2);
    assert.equal(aliceDaily.myCorrect, 40);
    assert.equal(aliceDaily.avgCorrect, 30.5);

    const history = (await post('alice', { action: 'history' })).data;
    assert.equal(history.total, 2);
    assert.ok(history.attempts.every((a: { isDaily: boolean }) => a.isDaily));
  } finally { await pg.close(); }
});

test('geçmiş: bitmiş denemelerin tamamı 20şer sayfa, en yeniden eskiye; bitmemiş sayılmaz', async () => {
  const { pg, db, bank, post } = await kur();
  try {
    await db.insert(schema.examAttempts).values(Array.from({ length: 45 }, (_, i) => ({
      userId: 'dave', bankId: bank.id, mode: 'rastgele' as const, status: 'finished' as const, examCode: 'UZY-R1',
      finishedAt: new Date(Date.UTC(2026, 0, 1 + i)), correctCount: i, wrongCount: 0, blankCount: 50 - i, scorePercent: i * 2,
    })));
    await db.insert(schema.examAttempts).values({ userId: 'dave', bankId: bank.id, mode: 'rastgele', status: 'cancelled', examCode: 'UZY-R2' });
    const page = async (n: number) => (await post('dave', { action: 'history', page: n })).data;

    const first = await page(0);
    assert.equal(first.total, 45);
    assert.equal(first.pageSize, 20);
    assert.equal(first.attempts.length, 20);
    assert.equal(first.attempts[0].score.correct, 44);
    assert.equal(first.attempts[0].isDaily, false);
    const last = await page(2);
    assert.equal(last.attempts.length, 5);
    assert.equal(last.attempts[4].score.correct, 0);
    assert.equal((await page(3)).attempts.length, 0);
  } finally { await pg.close(); }
});
