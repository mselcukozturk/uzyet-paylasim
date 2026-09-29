import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as orm from 'drizzle-orm';
import * as schema from '../lib/db/schema.ts';
import * as examCore from '../lib/exam-core.ts';
import * as practiceCore from '../lib/practice-core.ts';
import ts from 'typescript';

// Failure cases: unseen persistence missing, display counted as answer, repeat
// delivery erasing last result, cross-account updates, inactive/nonexistent GUID,
// unauthenticated or unapproved access. Real route + real PostgreSQL engine.
test('görülme API kaydı kalıcıdır; cevap geçmişi, hesap sınırı ve erişim korunur', async () => {
  const pg = new PGlite();
  try {
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
      await pg.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
    }
    const db = drizzle(pg);
    const [bank] = await db.insert(schema.questionBanks).values({ version:'seen-test', questionCount:1, isActive:true }).returning();
    await db.insert(schema.questions).values({ bankId:bank.id, guid:'q1', topic:'Kredi', prompt:'Soru', options:['A','B'], correctIndex:0 });
    await db.insert(schema.questionStats).values({ userId:'other', questionGuid:'q1', shownCount:3, correctCount:1, wrongCount:2, lastResult:false });
    let profile: { userId:string; isActive:boolean } | null = { userId:'owner', isActive:true };
    const modules: Record<string, unknown> = {
      'next/server': { NextResponse:{json:(data:unknown, init?:ResponseInit) => new Response(JSON.stringify(data), init)} },
      'drizzle-orm':orm, '@/lib/db':{getDb:()=>db,schema}, '@/lib/exam-core':examCore,
      '@/lib/practice-core':practiceCore, '@/data/bank-corrections.json':[],
      '@/lib/auth/session':{getSessionProfile:async()=>profile},
      '@/lib/cors':{withCors:(r:Response)=>r,corsPreflight:()=>new Response()},
    };
    const exports: {POST?:(r:Request)=>Promise<Response>} = {};
    const compiled = ts.transpileModule(readFileSync(new URL('../app/api/exam/route.ts', import.meta.url),'utf8'), {
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    }).outputText;
    runInNewContext(compiled,{exports,require:(key:string)=>modules[key],console,Buffer,process:{env:{}}});
    const send = (body:unknown) => exports.POST!(new Request('https://test.invalid/api/exam',{method:'POST',body:JSON.stringify(body)}));
    const seen = {action:'study-seen',questionGuid:'q1'};
    let response = await send(seen);
    assert.equal(response.status,200);
    const data = await response.json();
    assert.deepEqual([data.stat.gosterim,data.stat.dogru,data.stat.yanlis,data.stat.sonSonucDogruMu],[0,0,0,null]);
    assert.ok(data.stat.sonGorulme);
    await db.update(schema.questionStats).set({shownCount:1,correctCount:1,wrongCount:0,lastResult:true})
      .where(orm.eq(schema.questionStats.userId,'owner'));
    await send(seen); await send(seen);
    const rows = await db.select().from(schema.questionStats);
    const own = rows.find(r=>r.userId === 'owner')!;
    assert.deepEqual([own.shownCount,own.correctCount,own.wrongCount,own.lastResult],[1,1,0,true]);
    assert.equal(rows.find(r=>r.userId === 'other')!.shownCount,3);
    assert.equal((await send({action:'study-seen',questionGuid:'missing'})).status,400);
    assert.equal((await send({action:'study-seen',questionGuid:''})).status,400);
    await db.update(schema.questionBanks).set({isActive:false});
    assert.equal((await send(seen)).status,400);
    profile = {userId:'owner',isActive:false};
    assert.equal((await send(seen)).status,403);
    profile = null;
    assert.equal((await send(seen)).status,401);
  } finally { await pg.close(); }
});
