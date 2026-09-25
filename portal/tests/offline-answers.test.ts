import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as orm from 'drizzle-orm';
import { and, eq } from 'drizzle-orm';
import * as schema from '../lib/db/schema.ts';
import * as examCore from '../lib/exam-core.ts';
import { validatePracticeAnswer } from '../lib/practice-core.ts';
import ts from 'typescript';

async function setupDb() {
  const pg = new PGlite();
  const migrationDir = new URL('../drizzle/', import.meta.url);
  const names = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const name of names) {
    await pg.exec(await readFile(new URL(name, migrationDir), 'utf8'));
  }
  const db = drizzle(pg);
  const [bank] = await db.insert(schema.questionBanks).values({
    version: 'v1',
    questionCount: 50,
    isActive: true,
  }).returning();
  await db.insert(schema.questions).values(
    Object.entries(examCore.OFFICIAL_DISTRIBUTION).flatMap(([topic, n]) =>
      Array.from({ length: n }, (_, i) => ({
        bankId: bank.id,
        guid: `${topic}-${i}`,
        topic,
        prompt: `${topic} ${i}`,
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: '',
        source: '',
        verified: true,
      }))
    )
  );
  return { pg, db, bank };
}

function buildExamPost(db: ReturnType<typeof drizzle>, user = { current: 'alice', isAdmin: false }) {
  const mocks: Record<string, unknown> = {
    'next/server': { NextResponse: Response },
    'drizzle-orm': orm,
    '@/lib/db': { getDb: () => db, schema },
    '@/lib/exam-core': examCore,
    '@/lib/practice-core': { validatePracticeAnswer },
    '@/lib/auth/session': {
      getSessionProfile: async () => ({
        userId: user.current,
        isActive: true,
        isAdmin: user.isAdmin,
        canSeeAiSources: true,
        disclaimerAcceptedAt: new Date(),
      }),
    },
    '@/lib/cors': { withCors: (r: Response) => r },
    '@/data/bank-corrections.json': [],
  };
  const exports: { POST?: (r: Request) => Promise<Response> } = {};
  const compiled = ts.transpileModule(readFileSync(new URL('../app/api/exam/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, {
    exports,
    require: (key: string) => mocks[key],
    console,
    Buffer,
    crypto: globalThis.crypto,
  });
  return async (body: unknown) => {
    const res = await exports.POST!(new Request('https://test.invalid/api/exam', {
      method: 'POST',
      body: JSON.stringify(body),
    }));
    return { status: res.status, data: await res.json() };
  };
}

function buildAdminRoute(db: ReturnType<typeof drizzle>, envToken = 'test-token') {
  const mocks: Record<string, unknown> = {
    'next/server': { NextResponse: Response },
    'drizzle-orm': orm,
    '@/lib/db': { getDb: () => db, schema },
  };
  const exports: {
    GET?: (r: Request) => Promise<Response>;
    POST?: (r: Request) => Promise<Response>;
  } = {};
  const compiled = ts.transpileModule(
    readFileSync(new URL('../app/api/admin/attempt-answers/route.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  runInNewContext(compiled, {
    exports,
    require: (key: string) => mocks[key],
    console,
    Buffer,
    URL: globalThis.URL,
    crypto: globalThis.crypto,
    process: { env: { FLAGS_EXPORT_TOKEN: envToken } },
  });
  const get = async (url: string, token?: string) => {
    const headers: Record<string, string> = {};
    if (token) headers['authorization'] = `Bearer ${token}`;
    const res = await exports.GET!(new Request(url, { method: 'GET', headers }));
    return { status: res.status, data: await res.json() };
  };
  const post = async (body: unknown, token?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    const res = await exports.POST!(new Request('https://test.invalid/api/admin/attempt-answers', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }));
    return { status: res.status, data: await res.json() };
  };
  return { get, post };
}

test('offline answers: finish answers haritası sunucuya ulaşmamış cevapları puana katar', async () => {
  const { pg, db } = await setupDb();
  try {
    await db.insert(schema.profiles).values({
      userId: 'alice',
      username: 'alice',
      isActive: true,
    });
    const post = buildExamPost(db, { current: 'alice', isAdmin: false });
    const startRes = await post({ action: 'start', mode: 'rastgele' });
    assert.equal(startRes.status, 200);
    const attemptId = startRes.data.id as string;

    const dbQuestions = await db.select().from(schema.examAttemptQuestions)
      .where(eq(schema.examAttemptQuestions.attemptId, attemptId))
      .orderBy(schema.examAttemptQuestions.position);
    assert.equal(dbQuestions.length, 50);

    // Hiçbir soru 'answer' eylemiyle sunucuya gönderilmedi.
    // 35 soru doğru, 10 soru yanlış, 5 soru boş haritası oluştur.
    const clientAnswers: Record<string, number> = {};
    for (let i = 0; i < 35; i++) {
      clientAnswers[dbQuestions[i].id] = dbQuestions[i].correctIndex;
    }
    for (let i = 35; i < 45; i++) {
      clientAnswers[dbQuestions[i].id] = (dbQuestions[i].correctIndex + 1) % 4;
    }

    const finishRes = await post({ action: 'finish', attemptId, answers: clientAnswers });
    assert.equal(finishRes.status, 200);
    assert.equal(finishRes.data.score.correct, 35);
    assert.equal(finishRes.data.score.wrong, 10);
    assert.equal(finishRes.data.score.blank, 5);
    assert.equal(finishRes.data.score.percent, 70);

    // Veritabanındaki examAttempts kaydını doğrula
    const [attempt] = await db.select().from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    assert.equal(attempt.status, 'finished');
    assert.equal(attempt.correctCount, 35);
    assert.equal(attempt.wrongCount, 10);
    assert.equal(attempt.blankCount, 5);
    assert.equal(attempt.scorePercent, 70);

    // examAnswers tablosuna 45 cevabın kaydedildiğini doğrula
    const answersInDb = await db.select().from(schema.examAnswers);
    assert.equal(answersInDb.length, 45);
  } finally {
    await pg.close();
  }
});

test('offline answers: zaten bitmiş denemede answers yok sayılır', async () => {
  const { pg, db } = await setupDb();
  try {
    await db.insert(schema.profiles).values({
      userId: 'alice',
      username: 'alice',
      isActive: true,
    });
    const post = buildExamPost(db, { current: 'alice', isAdmin: false });
    const startRes = await post({ action: 'start', mode: 'rastgele' });
    const attemptId = startRes.data.id as string;

    const dbQuestions = await db.select().from(schema.examAttemptQuestions)
      .where(eq(schema.examAttemptQuestions.attemptId, attemptId))
      .orderBy(schema.examAttemptQuestions.position);

    // İlk finish: 30 doğru, 20 boş
    const initialAnswers: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      initialAnswers[dbQuestions[i].id] = dbQuestions[i].correctIndex;
    }
    const finish1 = await post({ action: 'finish', attemptId, answers: initialAnswers });
    assert.equal(finish1.status, 200);
    assert.equal(finish1.data.score.correct, 30);
    assert.equal(finish1.data.score.blank, 20);

    // İkinci finish: Sınav zaten 'finished'. Farklı cevaplar göndersek de yok sayılmalı.
    const secondAnswers: Record<string, number> = {};
    for (let i = 0; i < 50; i++) {
      secondAnswers[dbQuestions[i].id] = dbQuestions[i].correctIndex;
    }
    const finish2 = await post({ action: 'finish', attemptId, answers: secondAnswers });
    assert.equal(finish2.status, 200);
    assert.equal(finish2.data.score.correct, 30);
    assert.equal(finish2.data.score.blank, 20);

    // Veritabanındaki deneme kaydının değişmediğini doğrula
    const [attempt] = await db.select().from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    assert.equal(attempt.correctCount, 30);
    assert.equal(attempt.blankCount, 20);
  } finally {
    await pg.close();
  }
});

test('admin attempt-answers: token yoksa 401, boş soruyu doğruya çevirince correct/blank ve question_stats güncellenir', async () => {
  const { pg, db } = await setupDb();
  try {
    await db.insert(schema.profiles).values({
      userId: 'alice',
      username: 'alice',
      isActive: true,
    });
    const post = buildExamPost(db, { current: 'alice', isAdmin: false });
    const admin = buildAdminRoute(db, 'test-token');

    const startRes = await post({ action: 'start', mode: 'rastgele' });
    const attemptId = startRes.data.id as string;

    const dbQuestions = await db.select().from(schema.examAttemptQuestions)
      .where(eq(schema.examAttemptQuestions.attemptId, attemptId))
      .orderBy(schema.examAttemptQuestions.position);

    // İlk 40 soruyu doğru cevapla, son 10 soruyu boş bırak ve sınavı bitir
    const answers: Record<string, number> = {};
    for (let i = 0; i < 40; i++) {
      answers[dbQuestions[i].id] = dbQuestions[i].correctIndex;
    }
    const finishRes = await post({ action: 'finish', attemptId, answers });
    assert.equal(finishRes.status, 200);
    assert.equal(finishRes.data.score.correct, 40);
    assert.equal(finishRes.data.score.blank, 10);

    // Boş bırakılan bir soru: dbQuestions[40]
    const blankQuestion = dbQuestions[40];
    const [statBefore] = await db.select().from(schema.questionStats)
      .where(and(
        eq(schema.questionStats.userId, 'alice'),
        eq(schema.questionStats.questionGuid, blankQuestion.questionGuid)
      ));
    assert.ok(statBefore, 'question_stats satırı oluşmuş olmalı');
    assert.equal(statBefore.correctCount, 0);
    assert.equal(statBefore.lastResult, null);

    // 1. Token yoksa 401
    const noToken = await admin.post({ attemptId, answers: { [blankQuestion.id]: blankQuestion.correctIndex } });
    assert.equal(noToken.status, 401);

    // Yanlış token ile 401
    const wrongToken = await admin.post(
      { attemptId, answers: { [blankQuestion.id]: blankQuestion.correctIndex } },
      'gecersiz-token'
    );
    assert.equal(wrongToken.status, 401);

    // 2. Geçerli token ile POST: boş soruyu doğruya çevir
    const adminPostRes = await admin.post(
      { attemptId, answers: { [blankQuestion.id]: blankQuestion.correctIndex } },
      'test-token'
    );
    assert.equal(adminPostRes.status, 200);
    assert.equal(adminPostRes.data.ok, true);
    assert.equal(adminPostRes.data.correctCount, 41);
    assert.equal(adminPostRes.data.blankCount, 9);
    assert.equal(adminPostRes.data.wrongCount, 0);
    assert.equal(adminPostRes.data.changedCount, 1);

    // exam_attempts tablosundaki güncellemeyi doğrula
    const [attemptAfter] = await db.select().from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    assert.equal(attemptAfter.correctCount, 41);
    assert.equal(attemptAfter.blankCount, 9);

    // question_stats tablosundaki güncellemeyi doğrula
    const [statAfter] = await db.select().from(schema.questionStats)
      .where(and(
        eq(schema.questionStats.userId, 'alice'),
        eq(schema.questionStats.questionGuid, blankQuestion.questionGuid)
      ));
    assert.equal(statAfter.correctCount, 1);
    assert.equal(statAfter.lastResult, true);
    assert.equal(statAfter.shownCount, statBefore.shownCount, 'shownCount değişmemeli');

    // 3. Geçersiz şık verildiğinde 400 döner ve hiçbir şey yazılmaz
    const invalidOptionRes = await admin.post(
      { attemptId, answers: { [blankQuestion.id]: 99 } },
      'test-token'
    );
    assert.equal(invalidOptionRes.status, 400);

    // 4. Admin GET testi
    const getRes = await admin.get('https://test.invalid/api/admin/attempt-answers?username=alice', 'test-token');
    assert.equal(getRes.status, 200);
    assert.ok(Array.isArray(getRes.data));
    assert.equal(getRes.data.length, 1);
    assert.equal(getRes.data[0].id, attemptId);
    assert.equal(getRes.data[0].correctCount, 41);
    assert.equal(getRes.data[0].blankCount, 9);

    // Bulunamayan kullanıcı 404
    const notFoundUser = await admin.get('https://test.invalid/api/admin/attempt-answers?username=olmayan_kullanici', 'test-token');
    assert.equal(notFoundUser.status, 404);
  } finally {
    await pg.close();
  }
});

test('istemci: index.html uzyet_exam_answers_v1, online dinleyicisi ve finish answers alanını içerir', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  // 1. localStorage yedek anahtarı
  assert.ok(
    html.includes('uzyet_exam_answers_v1:'),
    'index.html "uzyet_exam_answers_v1:" localStorage anahtarını içermelidir'
  );

  // 2. online olay dinleyicisi
  assert.ok(
    html.includes('window.addEventListener("online"') || html.includes("window.addEventListener('online'"),
    'index.html "online" event listener içermelidir'
  );

  // 3. finishExamRemote içinde answers alanı
  assert.match(
    html,
    /finishExamRemote[\s\S]*?action:\s*"finish"[\s\S]*?answers:\s*answers/,
    'finishExamRemote /api/exam isteğinde answers alanını göndermelidir'
  );

  // 4. pauseExamRemote içinde answers alanı
  assert.match(
    html,
    /pauseExamRemote[\s\S]*?action:\s*"pause"[\s\S]*?answers:\s*answers/,
    'pauseExamRemote /api/exam isteğinde answers alanını göndermelidir'
  );

  // 5. Çevrimdışı kayıtlı bildirim satırı
  assert.ok(
    html.includes('cevap cihazda kayıtlı — bağlantı gelince gönderilecek'),
    'Sınav ekranında bekleyen cevap bildirim satırı bulunmalıdır'
  );
});
