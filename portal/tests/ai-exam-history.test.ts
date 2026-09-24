import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as orm from 'drizzle-orm';
import * as schema from '../lib/db/schema.ts';
import * as examCore from '../lib/exam-core.ts';
import ts from 'typescript';

// AI denemeleri sunucuda sınav oturumu açmaz; biten deneme practice_sessions'ta ayrılmış
// '__aiDeneme__' anahtarında durur. İstatistik sayfasının "AI Denemesi" sekmesi resmi
// sekmeyle aynı alanları (examStats/examTopicStats) bu kayıtlardan üretmeli.
test('AI deneme geçmişi: kayıt, istatistik, detay, silme ve hesap yalıtımı', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('create table profiles (user_id text primary key)');
    await pg.exec(readFileSync(new URL('../drizzle/0009_practice.sql', import.meta.url), 'utf8'));
    const db = drizzle(pg);
    let userId = 'owner';
    const mocks: Record<string, unknown> = {
      'next/server': { NextResponse: Response }, 'drizzle-orm': orm,
      '@/lib/db': { getDb: () => db, schema }, '@/lib/practice-core': {},
      '@/lib/auth/session': { getSessionProfile: async () => ({ userId, isActive: true, canSeeAiSources: true, disclaimerAcceptedAt: new Date() }) },
      '@/lib/cors': { withCors: (r: Response) => r }, '@/lib/exam-core': examCore, '@/data/bank-corrections.json': [],
    };
    const exports: { POST?: (r: Request) => Promise<Response> } = {};
    const compiled = ts.transpileModule(readFileSync(new URL('../app/api/exam/route.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(compiled, { exports, require: (key: string) => mocks[key], console, Buffer, crypto });
    const post = (body: unknown) => exports.POST!(new Request('https://test.invalid/api/exam', { method: 'POST', body: JSON.stringify(body) }));

    const kayit = (dogru: number, bitisISO: string) => ({
      examCode: 'UZA-TEST', aiGunu: null, bitisISO, sureSaniye: 1800,
      skor: { dogru, yanlis: 50 - dogru, bos: 0 },
      konuKirilim: { Kredi: { dogru, yanlis: 50 - dogru, bos: 0 } },
      sorular: ['g1'], cevaplar: { g1: 0 }, soruKayitlari: { g1: { soru: 'Soru metni' } },
    });
    const bugun = new Date().toISOString();
    const onGunOnce = new Date(Date.now() - 10 * 86_400_000).toISOString();

    const kaydedildi = await post({ action: 'ai-exam-save', payload: kayit(40, bugun) });
    assert.equal(kaydedildi.status, 200);
    const yeniId = (await kaydedildi.json()).id as string;
    assert.equal((await post({ action: 'ai-exam-save', payload: kayit(20, onGunOnce) })).status, 200);

    const gecmis = await (await post({ action: 'ai-exam-history' })).json();
    assert.equal(gecmis.total, 2);
    assert.equal(gecmis.attempts[0].id, yeniId, 'en yeni deneme üstte olmalı');
    assert.equal(gecmis.attempts[0].mode, 'ai');
    assert.deepEqual(gecmis.attempts[0].score, { correct: 40, wrong: 10, blank: 0 });
    assert.equal(gecmis.attempts[0].totalCount, 50);
    assert.equal(gecmis.attempts[0].soruKayitlari, undefined, 'liste 50 sorunun görüntüsünü taşımamalı');
    assert.equal(gecmis.examStats.count, 2);
    assert.equal(gecmis.examStats.avgCorrect, 30);
    assert.equal(gecmis.examStats.avgPercent, 60);
    assert.equal(gecmis.examStats.avgSeconds, 1800);
    assert.equal(gecmis.examStats.weekCount, 1, '10 gün önceki deneme haftalık ortalamaya girmemeli');
    assert.equal(gecmis.examStats.weekAvgCorrect, 40);
    assert.equal(gecmis.examStats.threeDayAvgCorrect, 40);
    const konu = gecmis.examTopicStats[0];
    assert.equal(konu.topic, 'Kredi');
    assert.equal(konu.avgAsked, 50);
    assert.equal(konu.avgCorrect, 30);
    assert.equal(konu.percent, 60);
    assert.equal(konu.weekAvgCorrect, 40);

    const detay = await (await post({ action: 'ai-exam-detail', attemptId: yeniId })).json();
    assert.deepEqual(detay.payload.soruKayitlari, { g1: { soru: 'Soru metni' } });

    userId = 'other';
    assert.equal((await (await post({ action: 'ai-exam-history' })).json()).total, 0);
    assert.equal((await post({ action: 'ai-exam-detail', attemptId: yeniId })).status, 404);
    await post({ action: 'ai-exam-delete', attemptId: yeniId });
    userId = 'owner';
    assert.equal((await (await post({ action: 'ai-exam-history' })).json()).total, 2, 'başka hesap silememeli');
    await post({ action: 'ai-exam-delete', attemptId: yeniId });
    const kalan = await (await post({ action: 'ai-exam-history' })).json();
    assert.equal(kalan.total, 1);
    assert.equal(kalan.examStats.avgCorrect, 20);

    const bozuk = await post({ action: 'ai-exam-save', payload: { ...kayit(40, bugun), skor: { dogru: 51, yanlis: 0, bos: 0 } } });
    assert.equal(bozuk.status, 400);
  } finally { await pg.close(); }
});

// Yarım kalan oturumlar kaldırıldıktan sonra tabloda yalnız ayrılmış anahtarlar kalmalı.
test('0014: eski yarım oturum satırları silinir, ayrılmış anahtarlar durur', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('create table profiles (user_id text primary key)');
    await pg.exec(readFileSync(new URL('../drizzle/0009_practice.sql', import.meta.url), 'utf8'));
    const db = drizzle(pg);
    await db.insert(schema.practiceSessions).values([
      { userId: 'u', topic: 'Kredi', modul: 'K1', payload: { index: 3 } },
      { userId: 'u', topic: '__checkpoint__:Kredi', modul: 'cp-1', payload: { index: 2 } },
      { userId: 'u', topic: '__pBest__', modul: '__pBest__', payload: { Kredi: {} } },
      { userId: 'u', topic: '__aiGunun__', modul: '2026-09-20', payload: { dogru: 30 } },
      { userId: 'u', topic: '__aiDeneme__', modul: 'id-1', payload: { skor: { dogru: 30 } } },
    ]);
    const temizle = readFileSync(new URL('../drizzle/0014_drop_paused_sessions.sql', import.meta.url), 'utf8');
    await pg.exec(temizle);
    await pg.exec(temizle); // tekrar çalıştırılabilir olmalı
    const kalan = (await db.select().from(schema.practiceSessions)).map((r) => r.topic).sort();
    assert.deepEqual(kalan, ['__aiDeneme__', '__aiGunun__', '__pBest__']);
  } finally { await pg.close(); }
});

// İki sekme, iki ayrı kaynak: resmi istatistik yalnız exam_attempts'tan, AI istatistiği
// yalnız practice_sessions'taki '__aiDeneme__' satırlarından beslenmeli.
test('istatistik kaynakları ayrı: resmi dashboard practice_sessions okumaz, AI ucu exam_attempts okumaz', () => {
  const route = readFileSync(new URL('../app/api/exam/route.ts', import.meta.url), 'utf8');
  const dashboard = route.slice(route.indexOf('async function dashboard('), route.indexOf("\nasync function", route.indexOf('async function dashboard(') + 10));
  assert.ok(!dashboard.includes('practiceSessions'), 'resmi dashboard AI kayıtlarını okumamalı');
  const aiBlok = route.slice(route.indexOf("body.action === 'ai-exam-save'"), route.indexOf("body.action === 'practice-bank'"));
  assert.ok(aiBlok.includes('AI_EXAM_SLOT'), 'AI ucu ayrılmış anahtarı kullanmalı');
  assert.ok(!aiBlok.includes('examAttempts'), 'AI ucu resmi denemeleri okumamalı');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  // 📊 hangi ekrandan basıldıysa o sekme açılır.
  assert.match(html, /istatistikSekmesi = \(aiModu && remoteAuth\.canSeeAiSources === true\) \? "ai" : "resmi";/);
});
