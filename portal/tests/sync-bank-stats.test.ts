import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as orm from 'drizzle-orm';
import * as schema from '../lib/db/schema.ts';
import * as examCore from '../lib/exam-core.ts';
import ts from 'typescript';

test('sync-bank aynı transaction içinde belirtilen GUID istatistiklerini sıfırlar', async () => {
  const pg = new PGlite();
  try {
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort()) {
      await pg.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
    }
    const db = drizzle(pg);
    await db.insert(schema.questionStats).values([
      { userId: 'u1', questionGuid: 'abc123', shownCount: 2, correctCount: 1, wrongCount: 1 },
      { userId: 'u1', questionGuid: 'korunsun', shownCount: 1, correctCount: 1, wrongCount: 0 },
    ]);

    const mocks: Record<string, unknown> = {
      'next/server': { NextResponse: { json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), init) } },
      'node:crypto': await import('node:crypto'),
      'drizzle-orm': orm,
      '@/lib/db': { getDb: () => db, schema },
      '@/lib/exam-core': examCore,
    };
    const exports: { POST?: (r: Request) => Promise<Response> } = {};
    const compiled = ts.transpileModule(readFileSync(new URL('../app/api/admin/sync-bank/route.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(compiled, {
      exports, require: (key: string) => mocks[key], console, Buffer,
      process: { env: { FLAGS_EXPORT_TOKEN: 'token' } },
    });
    const body = [{
      guid: 'abc123', konu: 'Kredi', soru: 'Soru?', a: 'A', b: 'B', c: 'C', d: 'D',
      cevap_harf: 'A', cevap_metni: 'A', aciklama: '', kaynak: '', dogrulanmis: 'Evet',
    }];
    const response = await exports.POST!(new Request('https://test.invalid/api/admin/sync-bank', {
      method: 'POST', body: JSON.stringify(body),
      headers: { authorization: 'Bearer token', 'x-reset-question-stats': 'abc123' },
    }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.resetStatsCount, 1);
    const kalan = await db.select().from(schema.questionStats);
    assert.deepEqual(kalan.map((row) => row.questionGuid), ['korunsun']);
  } finally {
    await pg.close();
  }
});
