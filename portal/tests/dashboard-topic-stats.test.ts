import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as orm from 'drizzle-orm';
import * as schema from '../lib/db/schema.ts';
import * as examCore from '../lib/exam-core.ts';
import ts from 'typescript';

// Geçmiş ekranındaki "Konu bazlı ortalama" kartının verisi: bitmiş denemelerde
// konu başına ortalama doğru / ortalama soru. Yarım kalan deneme sayılmamalı,
// cevapsız soru yanlış sayılmalı, başka kullanıcının denemesi karışmamalı.
test('dashboard examTopicStats: bitmiş denemelerde konu başına ortalama doğru sayısı', async () => {
  const pg = new PGlite();
  try {
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort()) {
      await pg.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
    }
    const db = drizzle(pg);
    const [bank] = await db.insert(schema.questionBanks)
      .values({ version: 'v1', questionCount: 4, isActive: true }).returning();
    const konular = ['Kredi', 'Kredi', 'Hukuk', 'Kambiyo'];
    const soruIds: string[] = [];
    for (let i = 0; i < konular.length; i++) {
      const [row] = await db.insert(schema.questions).values({
        bankId: bank.id, guid: 'q' + i, topic: konular[i], prompt: 'S' + i,
        options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: '',
      }).returning();
      soruIds.push(row.id);
    }
    // deneme 1 (bitmiş): Kredi 1/2 (biri cevapsız), Hukuk 1/1, Kambiyo 0/1
    // deneme 2 (bitmiş): Kredi 2/2, Hukuk 0/1, Kambiyo 0/1
    // deneme 3 (yarım): tamamı doğru — ortalamaya HİÇ girmemeli
    // başka kullanıcının bitmiş denemesi — karışmamalı
    // gun: kaç gün önce bitti (null = bitmedi); dogru: denemenin kayıtlı doğru sayısı.
    const denemeler: Array<{ user: string; status: 'finished' | 'active'; secim: Array<number | null>; gun: number | null; dogru: number }> = [
      { user: 'ben', status: 'finished', secim: [0, null, 0, 3], gun: 10, dogru: 31 },
      { user: 'ben', status: 'finished', secim: [0, 0, 2, 1], gun: 1, dogru: 40 },
      { user: 'ben', status: 'active', secim: [0, 0, 0, 0], gun: null, dogru: 50 },
      { user: 'baskasi', status: 'finished', secim: [0, 0, 0, 0], gun: 0, dogru: 50 },
    ];
    for (const d of denemeler) {
      const [attempt] = await db.insert(schema.examAttempts).values({
        userId: d.user, bankId: bank.id, mode: 'rastgele', status: d.status,
        examCode: 'X', elapsedSeconds: 600, correctCount: d.dogru, wrongCount: 0, blankCount: 0, scorePercent: 0,
        finishedAt: d.gun === null ? null : new Date(Date.now() - d.gun * 86_400_000),
      }).returning();
      for (let i = 0; i < soruIds.length; i++) {
        const [aq] = await db.insert(schema.examAttemptQuestions).values({
          attemptId: attempt.id, questionId: soruIds[i], questionGuid: 'q' + i, position: i + 1,
          topic: konular[i], prompt: 'S' + i, options: ['A', 'B', 'C', 'D'], correctIndex: 0,
        }).returning();
        if (d.secim[i] !== null) {
          await db.insert(schema.examAnswers).values({ attemptQuestionId: aq.id, selectedIndex: d.secim[i]! });
        }
      }
    }
    await db.insert(schema.profiles).values({ userId: 'ben', username: 'ben', isActive: true });

    const mocks: Record<string, unknown> = {
      'next/server': { NextResponse: { json: (data: unknown) => new Response(JSON.stringify(data)) } },
      'drizzle-orm': orm, '@/lib/db': { getDb: () => db, schema },
      '@/lib/auth/session': { getSessionProfile: async () => ({ userId: 'ben', isActive: true, canSeeAiSources: true, disclaimerAcceptedAt: new Date() }) },
      '@/lib/cors': { withCors: (r: Response) => r }, '@/lib/exam-core': examCore, '@/lib/practice-core': {},
      '@/data/bank-corrections.json': [],
    };
    const exports: { POST?: (r: Request) => Promise<Response> } = {};
    const compiled = ts.transpileModule(readFileSync(new URL('../app/api/exam/route.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(compiled, { exports, require: (key: string) => mocks[key], console, Buffer });
    const res = await exports.POST!(new Request('https://test.invalid/api/exam', {
      method: 'POST', body: JSON.stringify({ action: 'dashboard' }),
    }));
    const data = await res.json();

    assert.equal(data.examStats.count, 2);
    assert.equal(data.examStats.avgCorrect, 35.5);
    // Son 7 gün: yalnız 1 gün önce biten deneme; 10 gün önceki, yarım olan ve başkasınınki sayılmaz.
    assert.equal(data.examStats.weekCount, 1);
    assert.equal(data.examStats.weekAvgCorrect, 40);
    const konuBazli = Object.fromEntries(data.examTopicStats.map((t: { topic: string }) => [t.topic, t]));
    assert.deepEqual(Object.keys(konuBazli).sort(), ['Hukuk', 'Kambiyo', 'Kredi']);
    // Kredi: 4 soru soruldu, 3 doğru → deneme başına 2 soru / 1.5 doğru
    assert.deepEqual(konuBazli.Kredi, {
      topic: 'Kredi', asked: 4, correct: 3, avgAsked: 2, avgCorrect: 1.5, percent: 75,
      weekAvgAsked: 2, weekAvgCorrect: 2, weekPercent: 100,
    });
    assert.deepEqual(konuBazli.Hukuk, {
      topic: 'Hukuk', asked: 2, correct: 1, avgAsked: 1, avgCorrect: 0.5, percent: 50,
      weekAvgAsked: 1, weekAvgCorrect: 0, weekPercent: 0,
    });
    assert.deepEqual(konuBazli.Kambiyo, {
      topic: 'Kambiyo', asked: 2, correct: 0, avgAsked: 1, avgCorrect: 0, percent: 0,
      weekAvgAsked: 1, weekAvgCorrect: 0, weekPercent: 0,
    });
    // En çok soru gelen konu başta listelenir.
    assert.equal(data.examTopicStats[0].topic, 'Kredi');
  } finally { await pg.close(); }
});
