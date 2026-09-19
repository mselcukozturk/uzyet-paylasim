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

// AI Günün Denemesi sunucuda sınav oturumu açmaz: /api/exam "ai-daily" yalnız günün
// tohumunu verir ve bitmiş sonuçları toplar. Kritik davranış, resmi Günün Denemesi'yle
// aynı: bir kullanıcının İLK sonucu sayılır (tekrar çözen ortalamayı şişirmesin) ve
// ortalama yalnız kendisi çözmüş olana döner.

async function setupDb() {
  const pg = new PGlite();
  const migrationDir = new URL('../drizzle/', import.meta.url);
  const names = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const name of names) {
    await pg.exec(await readFile(new URL(name, migrationDir), 'utf8'));
  }
  return { pg, db: drizzle(pg) };
}

function buildRoutePost(
  db: ReturnType<typeof drizzle>,
  sessionUserId: { current: string },
  profile: { canSeeAiSources: boolean } = { canSeeAiSources: true },
) {
  const mocks: Record<string, unknown> = {
    'next/server': { NextResponse: Response }, 'drizzle-orm': orm,
    '@/lib/db': { getDb: () => db, schema }, '@/lib/exam-core': examCore,
    '@/lib/practice-core': { validatePracticeAnswer: () => true },
    '@/lib/auth/session': {
      getSessionProfile: async () => ({
        userId: sessionUserId.current, isActive: true,
        canSeeAiSources: profile.canSeeAiSources, disclaimerAcceptedAt: new Date(),
      }),
    },
    '@/lib/cors': { withCors: (r: Response) => r }, '@/data/bank-corrections.json': [],
  };
  const exports: { POST?: (r: Request) => Promise<Response> } = {};
  const compiled = ts.transpileModule(
    readFileSync(new URL('../app/api/exam/route.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  runInNewContext(compiled, { exports, require: (key: string) => mocks[key], console, Buffer, crypto: globalThis.crypto });
  return (body: unknown) => exports.POST!(new Request('https://test.invalid/api/exam', { method: 'POST', body: JSON.stringify(body) }));
}

type Daily = {
  day: string; seed: number; code: string;
  solvedCount: number; myCorrect: number | null; avgCorrect: number | null;
};

void test('ai-daily: ilk sonuç sayılır, tekrar çözmek ortalamayı değiştirmez', async () => {
  const { pg, db } = await setupDb();
  try {
    const sessionUserId = { current: 'alice' };
    const post = buildRoutePost(db, sessionUserId);

    const bos = await post({ action: 'ai-daily' }) as Response;
    assert.equal(bos.status, 200);
    const ilk = await bos.json() as Daily;
    assert.equal(ilk.solvedCount, 0);
    assert.equal(ilk.myCorrect, null);
    // Çözmeden ortalama görünmez — resmi Günün Denemesi'ndeki kuralın aynısı.
    assert.equal(ilk.avgCorrect, null);
    assert.ok(ilk.code.startsWith('UZA-'), `beklenen UZA- öneki, gelen: ${ilk.code}`);

    const alice = await (await post({ action: 'ai-daily', sonuc: { dogru: 26, yanlis: 19, bos: 5, sureSaniye: 1800 } })).json() as Daily;
    assert.equal(alice.myCorrect, 26);
    assert.equal(alice.avgCorrect, null, '27 altındaki tek sonuç ortalama oluşturmamalı');
    assert.equal(alice.solvedCount, 1);

    // Aynı kullanıcı tekrar çözerse İLK sonuç korunur.
    const tekrar = await (await post({ action: 'ai-daily', sonuc: { dogru: 50, yanlis: 0, bos: 0, sureSaniye: 60 } })).json() as Daily;
    assert.equal(tekrar.myCorrect, 26, 'ikinci deneme ilk sonucu ezdi');
    assert.equal(tekrar.solvedCount, 1);

    sessionUserId.current = 'bob';
    const bob = await (await post({ action: 'ai-daily', sonuc: { dogru: 27, yanlis: 23, bos: 0, sureSaniye: 2400 } })).json() as Daily;
    assert.equal(bob.myCorrect, 27);
    assert.equal(bob.solvedCount, 2);
    assert.equal(bob.avgCorrect, 27, '26 dışlanıp sınırdaki 27 ortalamaya dahil edilmeli');

    // Hiç çözmemiş üçüncü kullanıcı çözen sayısını görür, ortalamayı görmez.
    sessionUserId.current = 'carol';
    const carol = await (await post({ action: 'ai-daily' })).json() as Daily;
    assert.equal(carol.solvedCount, 2);
    assert.equal(carol.myCorrect, null);
    assert.equal(carol.avgCorrect, null);

    // Tohum gün boyunca sabit: aynı kodu açan aynı 50 soruyu alır.
    assert.equal(carol.seed, ilk.seed);
    assert.equal(carol.day, ilk.day);
  } finally { await pg.close(); }
});

void test('ai-daily: geçersiz sonuç reddedilir, AI erişimi kapalı hesap giremez', async () => {
  const { pg, db } = await setupDb();
  try {
    const sessionUserId = { current: 'alice' };
    const post = buildRoutePost(db, sessionUserId);
    for (const sonuc of [{ dogru: 51 }, { dogru: -1 }, { dogru: 'çok' }, { dogru: 1.5 }]) {
      const res = await post({ action: 'ai-daily', sonuc });
      assert.equal(res.status, 400, `${JSON.stringify(sonuc)} kabul edildi`);
    }
    // Hiçbiri kaydedilmemiş olmalı.
    const temiz = await (await post({ action: 'ai-daily' })).json() as Daily;
    assert.equal(temiz.solvedCount, 0);

    const kapali = buildRoutePost(db, sessionUserId, { canSeeAiSources: false });
    assert.equal((await kapali({ action: 'ai-daily' })).status, 403);
  } finally { await pg.close(); }
});

void test('AI günün denemesinin tohumu resmi Günün Denemesi ile aynı değil', () => {
  const day = '2026-09-16';
  const resmi = examCore.parseExamCode(examCore.dailyExamCode(day, 'test-secret'));
  assert.ok(resmi);
  assert.notEqual(examCore.aiDailySeed(day, 'test-secret'), resmi.seed);
  // Gün değişince tohum da değişir.
  assert.notEqual(examCore.aiDailySeed('2026-09-17', 'test-secret'), examCore.aiDailySeed(day, 'test-secret'));
  // Sunucu ve istemci aynı kod biçimini üretmeli (istemci: aiKoduUret).
  assert.equal(examCore.aiExamCode(1234567), `UZA-${(1234567).toString(36).toUpperCase()}`);
});

void test('istemci: günün AI denemesi kartı bağlı ve hata AI bölümünü kapatmıyor', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.ok(script);

  const menuTest = script.match(/^  function renderMenuTest\(\)[\s\S]*?^  \}/m)?.[0];
  assert.ok(menuTest, 'renderMenuTest bulunamadı');
  assert.ok(menuTest.includes('aiGununDenemesiHtml()'), 'kart Test ekranına eklenmemiş');
  assert.equal(script.split('"start-ai-daily"').length - 1, 2, 'start-ai-daily: basım + işleyici çifti eksik');

  // Uç hata verirse kart gizlenir, AI bölümü kapanmaz: çağrı Promise.all'ın DIŞINDA olmalı
  // (oradaki bir false bölümü kapatıp kullanıcıyı Deneme ekranına atıyor).
  const accept = script.match(/^  function acceptAiSources\(\)[\s\S]*?^  \}/m)?.[0];
  assert.ok(accept, 'acceptAiSources bulunamadı');
  assert.match(accept, /remoteLoadAiGunun\(null\);\s*\n\s*Promise\.all\(/);

  // Sonuç sunucuya gönderilmeli, yoksa ortalama hiç oluşmaz.
  const finish = script.match(/^  function finishAiExam\(\)[\s\S]*?^  \}/m)?.[0];
  assert.ok(finish, 'finishAiExam bulunamadı');
  assert.match(finish, /if \(aiGunu\) \{[\s\S]*remoteLoadAiGunun\(\{/);

  // Sıradan AI denemesi (aiGunu yok) sunucuya sonuç YAZMAMALI.
  const start = script.match(/^  function startAiExam\([\s\S]*?^  \}/m)?.[0];
  assert.ok(start, 'startAiExam bulunamadı');
  assert.match(start, /aiGunu: gununGunu \|\| null/);

  const avgHelper = script.match(/^  function gununDenemesiOrtalamaHtml\([\s\S]*?^  \}/m)?.[0];
  assert.ok(avgHelper, 'gununDenemesiOrtalamaHtml bulunamadı');
  const sandbox: Record<string, unknown> = {};
  runInNewContext(avgHelper + '\nresult = gununDenemesiOrtalamaHtml({ solvedCount: 1, avgCorrect: null });', sandbox);
  assert.match(String(sandbox.result), /—/);
  assert.doesNotMatch(String(sandbox.result), /null/);
});
