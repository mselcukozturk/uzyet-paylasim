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
import { validatePracticeAnswer } from '../lib/practice-core.ts';
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
    '@/lib/db': { getDb: () => db, schema }, '@/lib/exam-core': examCore, '@/lib/practice-core': { validatePracticeAnswer },
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

test('Konu Konu Bak sunucudaki kişisel geçmişi yükler ve cevapları aynı istatistiğe yazar', async () => {
  const { pg, db, bank, post } = await kur();
  try {
    const [question] = await db.select().from(schema.questions).where(orm.eq(schema.questions.bankId, bank.id)).limit(1);
    await db.insert(schema.questionStats).values([
      {
        userId: 'owner', questionGuid: question.guid, shownCount: 2, correctCount: 1, wrongCount: 1,
        lastResult: false, lastSeenAt: new Date('2026-09-01T10:00:00Z'),
      },
      {
        userId: 'other', questionGuid: question.guid, shownCount: 99, correctCount: 99, wrongCount: 0,
        lastResult: true, lastSeenAt: new Date('2026-09-02T10:00:00Z'),
      },
      {
        userId: 'owner', questionGuid: 'eski-banka-sorusu', shownCount: 25, correctCount: 0, wrongCount: 25,
        lastResult: false, lastSeenAt: new Date('2026-08-01T10:00:00Z'),
      },
    ]);

    const bankResponse = await post('owner', { action: 'bank' });
    assert.equal(bankResponse.status, 200);
    assert.deepEqual(bankResponse.data.stats[question.guid], {
      gosterim: 2, dogru: 1, yanlis: 1, sonSonucDogruMu: false, sonGorulme: '2026-09-01T10:00:00.000Z',
    });
    assert.equal(bankResponse.data.stats['eski-banka-sorusu'], undefined);

    const correct = await post('owner', {
      action: 'study-answer', questionGuid: question.guid, selectedAnswer: question.options[question.correctIndex],
      requestId: 'study_same_answer_1',
    });
    assert.equal(correct.status, 200, JSON.stringify(correct.data));
    assert.deepEqual(correct.data.stat, {
      gosterim: 3, dogru: 2, yanlis: 1, sonSonucDogruMu: true,
      sonGorulme: correct.data.stat.sonGorulme,
    });

    const retried = await post('owner', {
      action: 'study-answer', questionGuid: question.guid, selectedAnswer: question.options[question.correctIndex],
      requestId: 'study_same_answer_1',
    });
    assert.deepEqual(retried.data, correct.data, 'aynı istek yeniden gelince sayaç ikinci kez artmamalı');
    assert.equal((await post('owner', {
      action: 'study-answer', questionGuid: question.guid, selectedAnswer: question.options[(question.correctIndex + 1) % 4],
      requestId: 'study_same_answer_1',
    })).status, 409);

    assert.equal((await post('owner', {
      action: 'study-answer', questionGuid: question.guid, selectedAnswer: 'havuzda-yok',
    })).status, 400);
    assert.equal((await post('owner', {
      action: 'study-answer', questionGuid: 'olmayan-soru', selectedAnswer: 'A',
    })).status, 400);
  } finally { await pg.close(); }
});
