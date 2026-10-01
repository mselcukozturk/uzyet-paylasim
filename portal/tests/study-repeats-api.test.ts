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

// Failure cases: non-admin disclosure, absent zero-count users, shared GUIDs in
// old banks double-counted, retired/practice/display-only questions counted,
// counts mixed between users, incorrect order, empty active bank, write effects.
test('yönetici tekrar listesi kullanıcı bazında aktif banka toplamını verir ve yetkisiz erişimi reddeder', async () => {
  const pg = new PGlite();
  try {
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
      await pg.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
    }
    const db = drizzle(pg);
    await db.insert(schema.profiles).values([
      {userId:'admin',username:'yonetici',isAdmin:true,isActive:true},
      {userId:'second',username:'ikinci',isActive:true},
      {userId:'zero',username:'yeni',isActive:true},
    ]);
    const [bank] = await db.insert(schema.questionBanks).values({version:'active',questionCount:2,isActive:true}).returning();
    const [old] = await db.insert(schema.questionBanks).values({version:'old',questionCount:2,isActive:false}).returning();
    for (const [bankId,guids] of [[bank.id,['q1','seen']],[old.id,['q1','retired']]] as const) {
      await db.insert(schema.questions).values(guids.map(guid=>({bankId,guid,topic:'Kredi',prompt:'Soru',options:['A','B'],correctIndex:0})));
    }
    await db.insert(schema.questionStats).values([
      {userId:'admin',questionGuid:'q1',shownCount:7},
      {userId:'admin',questionGuid:'seen',shownCount:0,lastSeenAt:new Date()},
      {userId:'admin',questionGuid:'retired',shownCount:100},
      {userId:'admin',questionGuid:'practice_q',shownCount:200},
      {userId:'second',questionGuid:'q1',shownCount:11},
    ]);
    let profile: {userId:string;isActive:boolean;isAdmin:boolean} | null = {userId:'admin',isActive:true,isAdmin:true};
    const modules: Record<string,unknown> = {
      'next/server':{NextResponse:{json:(data:unknown,init?:ResponseInit)=>new Response(JSON.stringify(data),init)}},
      'drizzle-orm':orm,'@/lib/db':{getDb:()=>db,schema},'@/lib/exam-core':examCore,
      '@/lib/practice-core':practiceCore,'@/data/bank-corrections.json':[],
      '@/lib/auth/session':{getSessionProfile:async()=>profile},
      '@/lib/cors':{withCors:(r:Response)=>r,corsPreflight:()=>new Response()},
    };
    const exports:{POST?:(r:Request)=>Promise<Response>} = {};
    const compiled=ts.transpileModule(readFileSync(new URL('../app/api/exam/route.ts',import.meta.url),'utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    }).outputText;
    runInNewContext(compiled,{exports,require:(key:string)=>modules[key],console,Buffer,process:{env:{}}});
    const send=()=>exports.POST!(new Request('https://test.invalid/api/exam',{method:'POST',body:JSON.stringify({action:'study-repeats'})}));
    const response=await send();
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{users:[
      {name:'ikinci',totalRepeats:11},{name:'yonetici',totalRepeats:7},{name:'yeni',totalRepeats:0},
    ]});
    assert.equal((await db.select().from(schema.questionStats)).length,5,'okuma istatistik yazmamalı');
    profile={userId:'second',isActive:true,isAdmin:false}; assert.equal((await send()).status,403);
    profile={userId:'admin',isActive:false,isAdmin:true}; assert.equal((await send()).status,403);
    profile=null; assert.equal((await send()).status,401);
    profile={userId:'admin',isActive:true,isAdmin:true};
    await db.update(schema.questionBanks).set({isActive:false});
    assert.deepEqual(await (await send()).json(),{users:[
      {name:'ikinci',totalRepeats:0},{name:'yeni',totalRepeats:0},{name:'yonetici',totalRepeats:0},
    ]});
  } finally {await pg.close();}
});
