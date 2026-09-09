import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { validatePracticeAnswer } from '../lib/practice-core.ts';

// Run the real route with an in-memory query adapter: no live database or credentials.
const source = readFileSync(new URL('../app/api/exam/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
type Row = Record<string, unknown>;
const allowed = { userId: 'owner', isActive: true, canSeeAiSources: true, disclaimerAcceptedAt: new Date() };

function route(profile: Row | null, data: Record<string, Row[]> = {}) {
  const reads: string[] = [];
  const schema = Object.fromEntries(['practiceQuestions', 'practiceCheckpoints', 'practiceStats', 'practiceSessions'].map((name) => [
    name, { name, userId: 'userId', topic: 'topic', modul: 'modul', updatedAt: 'updatedAt', sira: 'sira' },
  ]));
  const db = {
    select(fields?: Record<string, string>) {
      return {
        from(table: { name: string }) {
          assert.ok(table, 'only practice tables may be read');
          reads.push(table.name);
          let rows = [...(data[table.name] ?? [])];
          const query = {
            where(predicate: (row: Row) => boolean) { rows = rows.filter(predicate); return query; },
            orderBy(column: string) { rows.sort((a, b) => Number(a[column]) - Number(b[column])); return query; },
            then(resolve: (value: Row[]) => unknown) {
              return Promise.resolve(rows.map((row) => fields
                ? Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[column]]))
                : row)).then(resolve);
            },
          };
          return query;
        },
      };
    },
  };
  const mocks: Record<string, unknown> = {
    'next/server': { NextResponse: Response },
    'drizzle-orm': { eq: (column: string, value: unknown) => (row: Row) => row[column] === value },
    '@/lib/auth/session': { getSessionProfile: async () => profile },
    '@/lib/cors': { withCors: (response: Response) => response },
    '@/lib/db': { getDb: () => db, schema },
    '@/lib/exam-core': {},
    '@/lib/practice-core': { validatePracticeAnswer },
    '@/data/bank-corrections.json': [],
  };
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  runInNewContext(compiled, {
    exports, require: (name: string) => {
      assert.ok(name in mocks, `unexpected dependency: ${name}`);
      return mocks[name];
    }, console,
  });
  return {
    reads,
    post: (action: string) => exports.POST!(new Request('https://test.invalid/api/exam', {
      method: 'POST', body: JSON.stringify({ action }),
    })),
  };
}

test('all practice reads enforce session, approval, AI permission and disclaimer before querying', async () => {
  for (const action of ['practice-bank', 'checkpoints', 'practice-stats', 'practice-answer',
    'practice-session-save', 'practice-session-load', 'practice-session-delete']) {
    for (const [profile, expected] of [
      [null, 401],
      [{ ...allowed, isActive: false }, 403],
      [{ ...allowed, canSeeAiSources: false }, 403],
      [{ ...allowed, disclaimerAcceptedAt: null }, 403],
    ] as const) {
      const api = route(profile);
      assert.equal((await api.post(action)).status, expected);
      assert.deepEqual(api.reads, []);
    }
  }
});

test('practice bank maps module and correct answer for the client without internal fields', async () => {
  const api = route(allowed, { practiceQuestions: [{
    id: 'internal', version: 'v1', guid: 'q1', topic: 'Hukuk', modul: 'M1', prompt: 'Soru?',
    options: ['Bir', 'İki'], correctIndex: 1, explanation: 'Açıklama', source: 'Kaynak',
  }] });
  const response = await api.post('practice-bank');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { questions: [{
    guid: 'q1', konu: 'Hukuk', modul: 'M1', soru: 'Soru?', siklar: ['Bir', 'İki'],
    cevapIdx: 1, cevapHarf: 'B', cevapMetni: 'İki', aciklama: 'Açıklama', kaynak: 'Kaynak',
  }] });
});

test('checkpoints preserve source order and HTML while omitting storage fields', async () => {
  const checkpoint = { topic: 'Hukuk', title: 'Başlık', subtitle: '', html: '<h3>İçerik</h3>', version: 'v1' };
  const api = route(allowed, { practiceCheckpoints: [
    { ...checkpoint, id: 'second', sira: 1 }, { ...checkpoint, id: 'first', sira: 0 },
  ] });
  const response = await api.post('checkpoints');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { checkpoints: ['first', 'second'].map((id) => ({
    id, konu: 'Hukuk', title: 'Başlık', subtitle: '', html: checkpoint.html,
  })) });
});

test('practice progress is user-scoped and sessions never expose payloads', async () => {
  const date = new Date('2026-09-09T12:00:00Z');
  const stat = { questionGuid: 'q1', shownCount: 3, correctCount: 2, wrongCount: 1, lastResult: false, lastSeenAt: date };
  const session = { topic: 'Hukuk', modul: 'M1', updatedAt: date, payload: { private: true } };
  const api = route(allowed, {
    practiceStats: [{ ...stat, questionGuid: 'other-private-question', userId: 'other' }, { ...stat, userId: 'owner' },
      { ...stat, questionGuid: 'q2', userId: 'owner', lastResult: null, lastSeenAt: null }],
    practiceSessions: [{ ...session, userId: 'other' }, { ...session, userId: 'owner' }],
  });
  const response = await api.post('practice-stats');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    stats: {
      q1: { gosterim: 3, dogru: 2, yanlis: 1, sonSonucDogruMu: false, sonGorulme: date.toISOString() },
      q2: { gosterim: 3, dogru: 2, yanlis: 1, sonSonucDogruMu: null, sonGorulme: null },
    },
    sessions: [{ konu: 'Hukuk', modul: 'M1', updatedAt: date.toISOString() }],
  });
});

test('authorized reads return empty collections before content import', async () => {
  for (const [action, expected] of [
    ['practice-bank', { questions: [] }], ['checkpoints', { checkpoints: [] }],
    ['practice-stats', { stats: {}, sessions: [] }],
  ] as const) {
    const response = await route(allowed).post(action);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }
});
