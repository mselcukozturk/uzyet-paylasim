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

async function setupDb() {
  const pg = new PGlite();
  const migrationDir = new URL('../drizzle/', import.meta.url);
  const names = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const name of names) await pg.exec(await readFile(new URL(name, migrationDir), 'utf8'));
  return { pg, db: drizzle(pg) };
}

async function seedBank(db: ReturnType<typeof drizzle>) {
  const [bank] = await db.insert(schema.questionBanks)
    .values({ version: 'v1', questionCount: 50, isActive: true }).returning();
  const rows = Object.entries(examCore.OFFICIAL_DISTRIBUTION).flatMap(([topic, count]) =>
    Array.from({ length: count }, (_, index) => ({
      bankId: bank.id, guid: `${topic}-${index}`, topic, prompt: `${topic} ${index}`,
      options: [`${topic} ${index} A`, `${topic} ${index} B`, `${topic} ${index} C`, `${topic} ${index} D`],
      correctIndex: index % 4, explanation: '', source: '', verified: true,
    })));
  await db.insert(schema.questions).values(rows);
  return { bank, rows };
}

function compileRoute(path: string, mocks: Record<string, unknown>) {
  const exports: Record<string, (...args: never[]) => unknown> = {};
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, {
    exports, require: (key: string) => mocks[key], console, Buffer, crypto: globalThis.crypto,
    process: { env: { FLAGS_EXPORT_TOKEN: 'test-token' } },
  });
  return exports;
}

function buildExamPost(db: ReturnType<typeof drizzle>, user: { current: string }) {
  const exports = compileRoute('../app/api/exam/route.ts', {
    'next/server': { NextResponse: Response }, 'drizzle-orm': orm,
    '@/lib/db': { getDb: () => db, schema }, '@/lib/exam-core': examCore,
    '@/lib/practice-core': { validatePracticeAnswer: () => true },
    '@/lib/auth/session': { getSessionProfile: async () => ({
      userId: user.current, isActive: true, canSeeAiSources: true, disclaimerAcceptedAt: new Date(),
    }) },
    '@/lib/cors': { withCors: (response: Response) => response }, '@/data/bank-corrections.json': [],
  });
  return (body: unknown) => (exports.POST as (request: Request) => Promise<Response>)(
    new Request('https://test.invalid/api/exam', { method: 'POST', body: JSON.stringify(body) }),
  );
}

function buildAdminRoute(db: ReturnType<typeof drizzle>) {
  return compileRoute('../app/api/admin/fixed-exam/route.ts', {
    'node:crypto': { randomBytes: () => Buffer.from([0, 0, 0, Math.floor(Math.random() * 256)]) },
    'next/server': { NextResponse: Response }, 'drizzle-orm': orm,
    '@/lib/db': { getDb: () => db, schema }, '@/lib/exam-core': examCore,
  });
}

async function startedQuestions(response: Response) {
  const body = await response.json() as { questions: Array<{ guid: string; options: string[]; position: number }> };
  return body.questions.sort((a, b) => a.position - b.position)
    .map(({ guid, options, position }) => ({ guid, options, position }));
}

test('unknown fixed exam code returns 404', async () => {
  const { pg, db } = await setupDb();
  try {
    await seedBank(db);
    const post = buildExamPost(db, { current: 'alice' });
    const response = await post({ action: 'start', mode: 'rastgele', examCode: examCore.fixedExamCode(123) });
    assert.equal(response.status, 404);
  } finally { await pg.close(); }
});

test('fixed exam preserves GUID and option order for different users', async () => {
  const { pg, db } = await setupDb();
  try {
    const { rows } = await seedBank(db);
    const guids = [...rows].reverse().map((row) => row.guid);
    const code = examCore.fixedExamCode(456);
    await db.insert(schema.fixedExams).values({ code, title: 'Sabit', questionGuids: guids });
    const user = { current: 'alice' };
    const post = buildExamPost(db, user);
    const alice = await post({ action: 'start', mode: 'rastgele', examCode: code });
    assert.equal(alice.status, 200);
    const aliceQuestions = await startedQuestions(alice);
    assert.deepEqual(aliceQuestions.map((question) => question.guid), guids);
    assert.deepEqual(aliceQuestions.map((question) => question.options), [...rows].reverse().map((row) => row.options));
    user.current = 'bob';
    const bob = await post({ action: 'start', mode: 'rastgele', examCode: code });
    assert.equal(bob.status, 200);
    assert.deepEqual(await startedQuestions(bob), aliceQuestions);
  } finally { await pg.close(); }
});

test('admin rejects fixed exam GUIDs missing from active bank', async () => {
  const { pg, db } = await setupDb();
  try {
    const { rows } = await seedBank(db);
    const route = buildAdminRoute(db);
    const response = await (route.POST as (request: Request) => Promise<Response>)(new Request('https://test.invalid/api/admin/fixed-exam', {
      method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Eksik', guids: [...rows.slice(0, 49).map((row) => row.guid), 'missing-guid'] }),
    }));
    assert.equal(response.status, 400);
    assert.match(JSON.stringify(await response.json()), /missing-guid/);
  } finally { await pg.close(); }
});

test('existing random exam codes still start normally', async () => {
  const { pg, db } = await setupDb();
  try {
    await seedBank(db);
    const post = buildExamPost(db, { current: 'alice' });
    const code = examCore.examCode('rastgele', 789);
    const response = await post({ action: 'start', mode: 'rastgele', examCode: code });
    assert.equal(response.status, 200);
    assert.equal((await startedQuestions(response)).length, 50);
  } finally { await pg.close(); }
});
