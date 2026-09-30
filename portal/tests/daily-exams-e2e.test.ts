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
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

async function setup(day = "2026-10-01", multiplier = 3) {
  const pg = new PGlite();
  for (const name of (await readdir(new URL('../drizzle/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
  }
  const db = drizzle(pg);
  const [bank] = await db.insert(schema.questionBanks).values({ version: 'v1', questionCount: 50, isActive: true }).returning();
  await db.insert(schema.questions).values(Object.entries(examCore.OFFICIAL_DISTRIBUTION).flatMap(([topic, n]) =>
    Array.from({ length: n * multiplier }, (_, i) => ({
      bankId: bank.id, guid: `${topic}-${i}`, topic, prompt: `${topic} ${i}`, options: ['A', 'B', 'C', 'D'], correctIndex: 0,
    }))));

  const mocks: Record<string, unknown> = {
    'next/server': { NextResponse: Response }, 'drizzle-orm': orm,
    '@/lib/db': { getDb: () => db, schema }, '@/lib/exam-core': { ...examCore, dailyExamDay: () => day }, '@/lib/practice-core': { validatePracticeAnswer },
    '@/lib/auth/session': {
      getSessionProfile: async (request: Request) => ({
        userId: request.headers.get('x-user'), isActive: true, isAdmin: request.headers.get('x-user') === 'admin',
        canSeeAiSources: true, disclaimerAcceptedAt: new Date(),
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
  return { pg, db, bank, post, handler: exports.POST! };
}

// Failure modes: code bypass, overlap, insufficient quotas, concurrent users, repeated scores,
// deleted snapshots, wrong day override, and mobile navigation failing to unlock the second.
const artifacts = new URL('../outputs/daily-exams/', import.meta.url);
const start = (number: number) => ({ action: 'start', mode: 'rastgele', daily: true, dailyNumber: number });
const guids = (attempt: any) => attempt.questions.map((q: any) => q.guid);
async function finish(db: any, post: any, user: string, attempt: any, correct: number) {
  const rows = await db.select().from(schema.examAttemptQuestions).where(orm.eq(schema.examAttemptQuestions.attemptId, attempt.id));
  for (const row of rows.slice(0, correct)) assert.equal((await post(user, { action: 'answer', attemptId: attempt.id, questionId: row.id, selectedIndex: row.correctIndex })).status, 200);
  const result = await post(user, { action: 'finish', attemptId: attempt.id });
  assert.equal(result.status, 200); assert.equal(result.data.score.correct, correct);
}

test('daily pair API: gate, disjoint immutable questions, independent scores and history', async () => {
  const { pg, db, post } = await setup();
  try {
    assert.equal((await post('alice', start(2))).status, 409);
    const initial = (await post('alice', { action: 'dashboard' })).data;
    assert.equal(initial.dailySecond.unlocked, false);
    assert.equal((await post('alice', { action: 'start', mode: 'rastgele', examCode: initial.dailySecond.code.toLowerCase() })).status, 409);
    assert.equal((await post('alice', { ...start(2), dailyNumber: 3 })).status, 400);
    const [first, bobFirst] = await Promise.all(['alice', 'bob'].map(async user => {
      const response = await post(user, start(1)); assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data;
    }));
    assert.deepEqual(guids(first), guids(bobFirst));
    await finish(db, post, 'alice', first, 40); await finish(db, post, 'bob', bobFirst, 0);
    assert.equal((await post('alice', { action: 'dashboard' })).data.dailySecond.unlocked, true);
    const second = await post('alice', start(2)); assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.dailyNumber, 2); assert.equal(second.data.isDaily, true);
    assert.equal(guids(second.data).filter((g: string) => guids(first).includes(g)).length, 0);
    await finish(db, post, 'alice', second.data, 30);
    const bobSecond = await post('bob', { action: 'start', mode: 'rastgele', examCode: second.data.examCode });
    assert.equal(bobSecond.status, 200); assert.deepEqual(guids(second.data), guids(bobSecond.data));
    await finish(db, post, 'bob', bobSecond.data, 20);
    const repeat = await post('alice', start(2)); assert.deepEqual(guids(second.data), guids(repeat.data));
    await finish(db, post, 'alice', repeat.data, 50);
    const dash = (await post('alice', { action: 'dashboard' })).data;
    assert.equal(dash.daily.myCorrect, 40); assert.equal(dash.dailySecond.myCorrect, 30);
    assert.equal(dash.dailySecond.avgCorrect, 30); assert.equal(dash.dailySecond.solvedCount, 2);
    assert.equal((await post('carol', { action: 'dashboard' })).data.dailySecond.avgCorrect, null);
    assert.deepEqual((await post('alice', { action: 'history' })).data.attempts.map((a: any) => a.dailyNumber), [2, 2, 1]);
    assert.deepEqual((await post('admin', { action: 'daily-solvers', dailyNumber: 2 })).data.solvers.map((s: any) => s.correct), [30, 20]);
    assert.equal((await post('alice', { action: 'daily-solvers', dailyNumber: 2 })).status, 403);
    for (const [user, attempt] of [['alice', first], ['bob', bobFirst]] as const) assert.equal((await post(user, { action: 'delete', attemptId: attempt.id })).status, 200);
    const recreated = await post('carol', start(1)); assert.equal(recreated.status, 200); assert.deepEqual(guids(recreated.data), guids(first));
    await mkdir(artifacts, { recursive: true });
    await writeFile(new URL('api-report.json', artifacts), JSON.stringify({ passed: true, firstCount: 50, secondCount: 50, intersection: 0, firstGuids: guids(first), secondGuids: guids(second.data), dashboard: dash }, null, 2));
  } finally { await pg.close(); }
});

test('30 September preserves the specified exam snapshot', async () => {
  const { pg, db, bank, post } = await setup('2026-09-30');
  try {
    const rows = await db.select().from(schema.questions).where(orm.eq(schema.questions.bankId, bank.id));
    const part = (number: number) => rows.filter(q => { const i = Number(q.guid.split('-').at(-1)), quota = examCore.OFFICIAL_DISTRIBUTION[q.topic]; return i >= quota * number && i < quota * (number + 1); });
    for (const [code, selected] of [[examCore.dailyExamCode('2026-09-30'), part(0)], ['UZY-R17QNG8G', part(1)]] as const) {
      const [attempt] = await db.insert(schema.examAttempts).values({ userId: 'source', bankId: bank.id, mode: 'rastgele', status: 'finished', correctCount: 40, finishedAt: new Date(), examCode: code }).returning();
      await db.insert(schema.examAttemptQuestions).values(selected.map((q, i) => ({ attemptId: attempt.id, questionId: q.id, questionGuid: q.guid, position: i + 1, topic: q.topic, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, explanation: q.explanation })));
    }
    const first = await post('alice', start(1)); await finish(db, post, 'alice', first.data, 0);
    const second = await post('alice', start(2)); assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.examCode, 'UZY-R17QNG8G'); assert.deepEqual(guids(second.data), part(1).map(q => q.guid));
  } finally { await pg.close(); }
});

test('after 07:00 an unstarted previous-day second code still enforces its first-exam gate', async () => {
  const { pg, post } = await setup('2026-10-02');
  try {
    const previous = examCore.secondDailyExamCode('2026-10-01');
    assert.equal((await post('alice', { action: 'start', mode: 'rastgele', examCode: previous })).status, 409);
    assert.equal((await post('alice', { action: 'start', mode: 'rastgele', examCode: 'UZY-R17QNG8G' })).status, 409);
    assert.equal((await post('alice', { action: 'start', mode: 'rastgele', examCode: 'UZY-D20261001-1' })).status, 400);
    const current = await post('alice', start(1));
    assert.equal(current.status, 200);
    const result = await post('alice', { action: 'finish', attemptId: current.data.id });
    assert.equal(result.status, 200);
    assert.equal((await post('alice', { action: 'start', mode: 'rastgele', examCode: previous })).status, 409,
      'today\'s first score cannot unlock yesterday\'s second exam');
  } finally { await pg.close(); }
});

test('short bank preserves first exam and refuses an overlapping second', async () => {
  const { pg, db, post } = await setup('2026-10-01', 1);
  try {
    const first = await post('alice', start(1)); assert.equal(first.status, 200);
    await finish(db, post, 'alice', first.data, 0); assert.equal((await post('alice', start(2))).status, 503);
  } finally { await pg.close(); }
});

test('browser E2E: switch, locked second, first score unlocks second, mobile screenshots', async () => {
  const { pg, post, handler } = await setup();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const server = createServer(async (req, res) => {
    try {
      const origin = `http://127.0.0.1:${(server.address() as any).port}`;
      if (req.url === '/api/access') {
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ authenticated: true, username: 'browser', isActive: true, isAdmin: true, disclaimerAccepted: true, canSeeAiSources: false }));
      } else if (req.url === '/api/exam') {
        let body = ''; for await (const chunk of req) body += chunk;
        const response = await handler(new Request(origin + req.url, { method: 'POST', headers: { 'x-user': 'browser' }, body }));
        res.statusCode = response.status; res.setHeader('Content-Type', 'application/json'); res.end(await response.text());
      } else {
        res.setHeader('Content-Type', 'text/html'); res.end(html.replace('var REMOTE_API = "https://uzyet-portal.vercel.app";', `var REMOTE_API = ${JSON.stringify(origin)};`));
      }
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    await page.locator('[data-action="switch-daily-exam"]').waitFor();
    await page.locator('[data-action="switch-daily-exam"]').click();
    assert.equal(await page.locator('[data-action="start-daily-exam"]').isEnabled(), false);
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('second-locked.png', artifacts)), fullPage: true });
    await page.locator('[data-action="switch-daily-exam"]').click();
    await page.locator('[data-action="start-daily-exam"]').click();
    await page.locator('[data-action="finish-exam"]').click();
    await page.locator('[data-action="back-menu"]').click();
    await page.locator('[data-action="switch-daily-exam"]').click();
    await page.locator('[data-action="start-daily-exam"]:enabled').waitFor();
    await page.screenshot({ path: fileURLToPath(new URL('second-unlocked.png', artifacts)), fullPage: true });
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.screenshot({ path: fileURLToPath(new URL('second-desktop.png', artifacts)), fullPage: true });
    await page.locator('[data-action="start-daily-exam"]').click();
    await page.locator('[data-action="finish-exam"]').waitFor();
    assert.equal((await post('browser', { action: 'dashboard' })).data.activeAttempt.dailyNumber, 2);
    assert.deepEqual(errors, []);
    await writeFile(new URL('browser-report.json', artifacts), JSON.stringify({ passed: true, viewport: { width: 390, height: 844 }, pageErrors: errors }, null, 2));
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); await pg.close(); }
});

