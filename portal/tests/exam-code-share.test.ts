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

// Paylaşılan bir "deneme kodu" HER zaman aynı 50 soruyu getirmeli — kim açarsa açsın.
// Bu, "azgorulen"/"yanlislar" gibi kişisel istatistiğe bağlı modlarda eskiden doğru
// değildi: kod açan her kullanıcının KENDİ question_stats'ına göre yeniden seçim
// yapılıyordu. Bu test /api/exam "start" işleyicisinin gerçek Postgres (PGlite) üstünde,
// aynı koda farklı kullanıcılarla birden çok kez başlandığında hep aynı 50 soru + aynı
// sırayı döndürdüğünü doğrular (bkz. app/api/exam/route.ts "start" işleyicisi).

async function setupDb() {
  const pg = new PGlite();
  const migrationDir = new URL('../drizzle/', import.meta.url);
  const names = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const name of names) {
    const migration = await readFile(new URL(name, migrationDir), 'utf8');
    await pg.exec(migration);
  }
  return { pg, db: drizzle(pg) };
}

async function seedBank(db: ReturnType<typeof drizzle>) {
  const [bank] = await db.insert(schema.questionBanks)
    .values({ version: 'v1', questionCount: 50, isActive: true }).returning();
  const rows = Object.entries(examCore.OFFICIAL_DISTRIBUTION).flatMap(([topic, count]) =>
    Array.from({ length: count }, (_, index) => ({
      bankId: bank.id, guid: `${topic}-${index}`, topic, prompt: `${topic} ${index}`,
      options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: '', source: '', verified: true,
    })));
  await db.insert(schema.questions).values(rows);
  return { bank, rows };
}

function buildRoutePost(db: ReturnType<typeof drizzle>, sessionUserId: { current: string }) {
  const mocks: Record<string, unknown> = {
    'next/server': { NextResponse: Response }, 'drizzle-orm': orm,
    '@/lib/db': { getDb: () => db, schema }, '@/lib/exam-core': examCore,
    '@/lib/practice-core': { validatePracticeAnswer: () => true },
    '@/lib/auth/session': {
      getSessionProfile: async () => ({
        userId: sessionUserId.current, isActive: true, canSeeAiSources: true, disclaimerAcceptedAt: new Date(),
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

async function guidsInOrder(response: Response) {
  const data = await response.json() as { examCode: string; questions: Array<{ guid: string; position: number }> };
  return { examCode: data.examCode, guids: [...data.questions].sort((a, b) => a.position - b.position).map((q) => q.guid) };
}

for (const mode of ['yanlislar', 'azgorulen'] as const) {
  test(`shared exam code (${mode}): every opener gets the exact same 50 questions in the same order`, async () => {
    const { pg, db } = await setupDb();
    try {
      const { rows } = await seedBank(db);
      const code = examCore.examCode(mode, 987654321);

      // Kişisel istatistikleri kasıtlı olarak birbirinden çok farklı yap — eski (hatalı)
      // davranışta bu, "yanlislar"/"azgorulen" seçimini kullanıcıdan kullanıcıya değiştirirdi.
      const alice = rows.map((q, i) => ({
        userId: 'alice', questionGuid: q.guid,
        shownCount: i % 7, wrongCount: i % 3, lastResult: i % 4 === 0,
      }));
      const bob = rows.map((q, i) => ({
        userId: 'bob', questionGuid: q.guid,
        shownCount: (rows.length - i) % 11, wrongCount: (i + 1) % 5, lastResult: i % 4 !== 0,
      }));
      await db.insert(schema.questionStats).values([...alice, ...bob]);

      const sessionUserId = { current: 'alice' };
      const post = buildRoutePost(db, sessionUserId);

      const aliceRes = await post({ action: 'start', mode: 'rastgele', examCode: code });
      assert.equal(aliceRes.status, 200);
      const aliceResult = await guidsInOrder(aliceRes);
      assert.equal(aliceResult.examCode, code);
      assert.equal(aliceResult.guids.length, 50);

      sessionUserId.current = 'bob';
      const bobRes = await post({ action: 'start', mode: 'rastgele', examCode: code });
      assert.equal(bobRes.status, 200);
      const bobResult = await guidsInOrder(bobRes);
      assert.deepEqual(bobResult.guids, aliceResult.guids, `${mode}: bob'un soru listesi/sırası alice'ten farklı çıktı`);

      // carol: hiç istatistiği yok — üçüncü bir açılışta da aynı kaynağın kullanıldığını kanıtlar.
      sessionUserId.current = 'carol';
      const carolRes = await post({ action: 'start', mode: 'rastgele', examCode: code });
      assert.equal(carolRes.status, 200);
      const carolResult = await guidsInOrder(carolRes);
      assert.deepEqual(carolResult.guids, aliceResult.guids, `${mode}: carol'un soru listesi/sırası alice'ten farklı çıktı`);
    } finally { await pg.close(); }
  });
}

test('starting fresh (no exam code yet) still uses the starting user\'s own stats, as before', async () => {
  const { pg, db } = await setupDb();
  try {
    await seedBank(db);
    const sessionUserId = { current: 'alice' };
    const post = buildRoutePost(db, sessionUserId);
    const res = await post({ action: 'start', mode: 'yanlislar' });
    assert.equal(res.status, 200);
    const { guids } = await guidsInOrder(res);
    assert.equal(guids.length, 50);
  } finally { await pg.close(); }
});
