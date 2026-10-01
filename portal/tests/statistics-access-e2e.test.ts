import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as orm from 'drizzle-orm';
import * as schema from '../lib/db/schema.ts';
import * as examCore from '../lib/exam-core.ts';
import * as practiceCore from '../lib/practice-core.ts';
import ts from 'typescript';

// Failure cases: granting administrator status, granting unrelated users, losing
// administrator reads, trusting request flags, inactive/anonymous disclosure,
// login/status omitting the capability, mutation access, migration reapplication.
test('istatistik görüntüleme: yalnız iki hesap, gerçek API ve yönetim işlemleri', async () => {
  const pg = new PGlite();
  try {
    const migration = new URL('../drizzle/0017_statistics_access.sql', import.meta.url);
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql') && f !== '0017_statistics_access.sql').sort()) {
      await pg.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
    }
    await pg.exec(`insert into profiles(user_id,username,is_active,is_admin,disclaimer_accepted_at)
      values ('admin','yonetici',true,true,now()), ('emre','emrebot',true,false,now()),
      ('numan','numanbaba',true,false,now()), ('other','diger',true,false,now());`);
    assert.ok(existsSync(migration), 'İki kullanıcı için ayrı görüntüleme izni migrationı gerekli');
    await pg.exec(readFileSync(migration, 'utf8'));
    await pg.exec(readFileSync(migration, 'utf8'));
    const db = drizzle(pg);
    const rows = await db.select().from(schema.profiles).orderBy(schema.profiles.username);
    assert.deepEqual(rows.map(p => [p.username, p.canViewStatistics, p.isAdmin]), [
      ['diger',false,false],['emrebot',true,false],['numanbaba',true,false],['yonetici',false,true],
    ]);
    let current = rows.find(p => p.userId === 'admin')!;
    const modules: Record<string, unknown> = {
      'next/server': { NextResponse: { json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), init) } },
      'drizzle-orm': orm, '@/lib/db': { getDb: () => db, schema },
      '@/lib/exam-core': examCore, '@/lib/practice-core': practiceCore, '@/data/bank-corrections.json': [],
      '@/lib/auth/session': { getSessionProfile: async () => current },
      '@/lib/auth/server': { auth: { getSession: async () => ({data:{user:{id:current?.userId}}}) } },
      'next/cache': { revalidatePath: () => { throw new Error('Görüntüleme kullanıcısı yazma işlemi yaptı'); } },
      '@/lib/cors': { withCors: (r: Response) => r, corsPreflight: () => new Response() },
    };
    function load(path: string) {
      const exports: any = {};
      const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      runInNewContext(code, {exports, require: (key: string) => modules[key], console, Buffer, process: {env:{}}});
      return exports;
    }
    const exam = load('../app/api/exam/route.ts');
    const access = load('../app/api/access/route.ts');
    const admin = load('../app/actions/admin.ts');
    const send = (action: string, extra = {}) => exam.POST(new Request('https://test.invalid/api/exam', {
      method:'POST', body:JSON.stringify({action, ...extra}),
    }));
    const evidence: any[] = [];
    for (const userId of ['admin','emre','numan','other']) {
      current = rows.find(p => p.userId === userId)!;
      const allowed = userId !== 'other';
      for (const action of ['study-repeats','daily-solvers']) {
        const response = await send(action, {canViewStatistics:true,isAdmin:true});
        assert.equal(response.status, allowed ? 200 : 403, userId + ' ' + action);
        evidence.push({userId,action,status:response.status});
      }
      const response = await access.GET(new Request('https://test.invalid/api/access'));
      const payload = await response.json();
      assert.equal(payload.canViewStatistics, allowed);
      assert.equal(payload.isAdmin, userId === 'admin');
      const loginPayload = await (await access.POST(new Request('https://test.invalid/api/access', {method:'POST',body:'{}'}))).json();
      assert.equal(loginPayload.canViewStatistics,allowed);
      if (userId === 'emre' || userId === 'numan') {
        for (const result of [await admin.approveUserAction('other'), await admin.rejectUserAction('other'),
          await admin.deleteUserAction('other'), await admin.toggleAiAccessAction('other',true)]) {
          assert.equal(result.ok, false, 'Görüntüleme izni yönetim yetkisi vermemeli');
        }
        current = {...current, isActive:false};
        assert.equal((await send('study-repeats')).status,403);
        assert.equal((await send('daily-solvers')).status,403);
        assert.equal((await (await access.GET(new Request('https://test.invalid/api/access'))).json()).canViewStatistics,false);
      }
    }
    current = null as any;
    assert.equal((await send('study-repeats')).status,401);
    assert.equal((await send('daily-solvers')).status,401);
    assert.equal((await db.select().from(schema.profiles)).length,4);
    const output = new URL('../outputs/statistics-access/', import.meta.url);
    mkdirSync(output,{recursive:true});
    writeFileSync(new URL('api-result.json',output),JSON.stringify({ok:true,grants:rows.map(p=>({username:p.username,isAdmin:p.isAdmin,canViewStatistics:p.canViewStatistics})),requests:evidence},null,2));
  } finally { await pg.close(); }
});
