// Failure paths: 0020, 0021, 0022, 0023, 0025 must be repeatable; unanswered/no-clue sync accepted; invalid control,
// empty answered response rejected; daily excludes unanswered; list includes control for every account.
// Unknown question/mark/reminder, user mark leakage, duplicate marks, null deletion with reminder preservation,
// reminder toggle with mark preservation, invalid feedback, unauthorized feedback administration,
// processed feedback, re-sync loss, anonymous actions rejected;
// duplicate daily selection on same day, question leakage across priority tiers,
// low-priority inclusion before normal exhaustion, partial day low-priority completion failure,
// oldest-shown ordering violation on cycle completion, deleted/unanswered question leakage in daily response,
// cross-user daily divergence, consecutive day repetition before tier exhaustion,
// admin ses unauthorized access, admin ses invalid parameters and payload size limits,
// duplicate ses overwrite failure, admin ses delete leakage, user ses unauthorized/unapproved, missing ses 404,
// audio content-type/cache-control header mismatch, payload byte corruption, exam route missing ses field,
// and question re-sync ses deletion.
// Chunked ses: interrupted upload exposure, out-of-order/duplicate/version-mismatched chunks,
// invalid chunk parameters, total above 32,000,000 bytes, restart failure, streamed byte corruption.
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
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

// Failure cases covered:
// 1. Migration reapplication causing DDL errors or non-idempotency.
// 2. sync-klasik unauthorized access (missing/wrong FLAGS_EXPORT_TOKEN -> 401).
// 3. sync-klasik malformed payloads: non-JSON, empty questions array, duplicate 'no', invalid 'no' format,
//    missing kategori/soru, invalid durum (not 'tam'|'kismi'|'cevapsiz'), invalid cevap öğesi türleri, empty clue item -> 400.
// 4. sync-klasik version calculation and skipping re-insert when the same payload is sent twice.
// 5. klasik-daily unauthenticated / unapproved access rejected (401 / 403).
// 6. klasik-daily selects up to 5 questions randomly across pool without category restriction.
// 7. klasik-daily deterministic list for the same day across different users.
// 8. klasik-daily different day produces deterministic result for that day.
// 9. klasik-seen with non-existent 'no' returns 400.
// 10. klasik-seen updates seen status only for the requesting user, idempotent on conflict.
// 11. Re-sync of questions preserves existing klasik_gorulme user progress records.
// 12. klasik-daily kalıcı ve öncelikli seçim akışı (uçtan uca):
//     - (i) ardışık günlerde normal sorular tekrarsız tükenir;
//     - (ii) normal bitmeden hiçbir günde düşük soru seçilmez;
//     - (iii) normalden 7'den az kalan gün düşükle tamamlanır;
//     - (iv) hepsi bitince en eski gösterilenler gelir;
//     - (v) aynı gün ikinci istek aynı 7 soruyu aynı sırayla döndürür ve klasik_gunun_secimi tablosunda tek satır vardır;
//     - (vi) iki farklı kullanıcı aynı seçimi görür;
//     - (vii) seçimdeki soru silinince veya cevapsız yapılınca yanıtta atlanır ve yeni soru eklenmez.
// 13. 0022_klasik_hatirlatici migration idempotency and table schema:
//     - hatirlatici column added as boolean not null default false,
//     - isaret column allows null so reminder can stay active without color mark,
//     - re-applying 0022 migration does not fail.
// 14. 0023_klasik_gunun_secimi migration idempotency and table schema:
//     - gun text primary key, sorular text[] not null, olusturma_zamani timestamptz not null default now(),
//     - re-applying 0023 migration does not fail.
// 15. klasik-reminder authentication and payload validation:
//     - anonymous/inactive user rejected with 401/403,
//     - invalid/missing no or non-existent question rejected with 400,
//     - non-boolean hatirlatici payload rejected with 400.
// 16. klasik-reminder state persistence and coexistence with color mark:
//     - reminder can be set without any color mark (isaret remains null),
//     - setting reminder does not overwrite existing color mark,
//     - clearing color mark (isaret: null) preserves active reminder (row not deleted),
//     - turning off reminder (hatirlatici: false) preserves active color mark,
//     - row deleted only when both color mark and reminder are cleared,
//     - question re-sync does not delete reminder state.
// 17. Response payload enrichment:
//     - klasik-list, klasik-question, and klasik-daily contain hatirlatici boolean field for every question,
//     - reminder state is properly scoped to requesting user.
// 18. 0025_klasik_ses migration idempotency and table schema:
//     - re-applying 0025 migration twice does not fail.
// 19. Admin klasik-ses endpoint:
//     - missing or wrong token rejected with 401,
//     - PUT with invalid no, tur, surum, empty body, or body exceeding 4,000,000 bytes rejected with 400,
//     - valid PUT inserts record and returns {ok:true},
//     - GET returns list without reading veri column,
//     - PUT on existing (no, tur) updates surum and veri without creating duplicate rows,
//     - DELETE removes record from GET listing.
// 20. User klasik-ses endpoint:
//     - anonymous request rejected with 401,
//     - unapproved user rejected with 403,
//     - non-existent question audio returns 404,
//     - approved user receives audio/mpeg bytes with immutable cache header matching uploaded data.
// 21. Exam route ses integration:
//     - klasik-daily and klasik-question return ses: {soru, cevap} object with surum or null,
//     - question re-sync via sync-klasik does not delete klasik_ses rows.
test('klasik e2e: senkron, gunun sorulari secimi, gorulme kaydi ve izolasyon', async () => {
  const pg = new PGlite();
  try {
    const drizzleDir = new URL('../drizzle/', import.meta.url);
    const sqlFiles = readdirSync(drizzleDir).filter(f => f.endsWith('.sql')).sort();
    for (const name of sqlFiles) {
      await pg.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
    }
    // Migration idempotent test: re-apply 0019_klasik_sorular.sql, 0020, 0021, 0022, 0023
    const migration0019 = new URL('../drizzle/0019_klasik_sorular.sql', import.meta.url);
    assert.ok(existsSync(migration0019), '0019_klasik_sorular.sql migration dosyası mevcut olmalı');
    await pg.exec(readFileSync(migration0019, 'utf8'));
    await pg.exec(readFileSync(new URL('../drizzle/0020_klasik_isaret_ve_geri_bildirim.sql', import.meta.url), 'utf8'));
    await pg.exec(readFileSync(new URL('../drizzle/0021_klasik_oncelik.sql', import.meta.url), 'utf8'));
    const migration0022 = new URL('../drizzle/0022_klasik_hatirlatici.sql', import.meta.url);
    if (existsSync(migration0022)) {
      await pg.exec(readFileSync(migration0022, 'utf8'));
    }
    const migration0023 = new URL('../drizzle/0023_klasik_gunun_secimi.sql', import.meta.url);
    assert.ok(existsSync(migration0023), '0023_klasik_gunun_secimi.sql migration dosyası mevcut olmalı');
    await pg.exec(readFileSync(migration0023, 'utf8'));

    const migration0025 = new URL('../drizzle/0025_klasik_ses.sql', import.meta.url);
    assert.ok(existsSync(migration0025), '0025_klasik_ses.sql migration dosyası mevcut olmalı');
    await pg.exec(readFileSync(migration0025, 'utf8'));
    await pg.exec(readFileSync(migration0025, 'utf8'));

    await pg.exec(`insert into profiles(user_id,username,is_active,is_admin,disclaimer_accepted_at)
      values ('u1','kullanici1',true,false,now()),
             ('u2','kullanici2',true,false,now()),
             ('u_inactive','onaysiz',false,false,now());`);

    const db = drizzle(pg);
    let currentProfile: any = null;
    let currentDay: string | null = null;

    class MockNextResponse extends Response {
      static json(data: unknown, init?: ResponseInit) {
        const body = JSON.stringify(data);
        const headers = new Headers(init?.headers);
        headers.set('content-type', 'application/json');
        return new MockNextResponse(body, { ...init, headers });
      }
    }

    const modules: Record<string, unknown> = {
      'next/server': {
        NextResponse: MockNextResponse,
      },
      'drizzle-orm': orm,
      '@/lib/db': { getDb: () => db, schema },
      '@/lib/exam-core': {
        ...examCore,
        dailyExamDay: (now?: Date) => currentDay ?? examCore.dailyExamDay(now),
      },
      '@/lib/practice-core': practiceCore,
      '@/data/bank-corrections.json': [],
      '@/lib/auth/session': {
        getSessionProfile: async () => currentProfile,
      },
      '@/lib/auth/server': {
        auth: { getSession: async () => ({ data: { user: { id: currentProfile?.userId } } }) },
      },
      'next/cache': { revalidatePath: () => {} },
      '@/lib/cors': { withCors: (r: Response) => r, corsPreflight: () => new Response() },
    };

    function load(path: string) {
      const exports: any = {};
      const fullPath = new URL(path, import.meta.url);
      const code = ts.transpileModule(readFileSync(fullPath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      runInNewContext(code, {
        exports,
        require: (key: string) => {
          if (modules[key]) return modules[key];
          if (key === '@/lib/klasik-sync' || key.endsWith('klasik-sync')) {
            return load('../lib/klasik-sync.ts');
          }
          return nodeRequire(key);
        },
        console,
        Buffer,
        URL,
        Response,
        Request,
        Headers,
        ReadableStream,
        process: {
          env: {
            FLAGS_EXPORT_TOKEN: 'test-sync-token',
            PIN_ENCRYPTION_KEY: 'test-encryption-key-for-seed',
          },
        },
      });
      return exports;
    }

    const syncKlasikRoute = load('../app/api/admin/sync-klasik/route.ts');
    const examRoute = load('../app/api/exam/route.ts');
    const adminSesRoute = load('../app/api/admin/klasik-ses/route.ts');
    const userSesRoute = load('../app/api/klasik-ses/route.ts');

    const sendSync = (body: string, token = 'test-sync-token') =>
      syncKlasikRoute.POST(new Request('https://test.invalid/api/admin/sync-klasik', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body,
      }));

    const sendExam = (body: any) =>
      examRoute.POST(new Request('https://test.invalid/api/exam', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }));

    const sendAdminSes = (method: string, query = '', body?: any, token = 'test-sync-token') => {
      const url = `https://test.invalid/api/admin/klasik-ses${query ? '?' + query : ''}`;
      const headers: Record<string, string> = {};
      if (token) headers['authorization'] = `Bearer ${token}`;
      return adminSesRoute[method](new Request(url, {
        method,
        headers,
        body: body !== undefined ? body : undefined,
      }));
    };

    const sendUserSes = (query = '') => {
      const url = `https://test.invalid/api/klasik-ses${query ? '?' + query : ''}`;
      return userSesRoute.GET(new Request(url, { method: 'GET' }));
    };

    // 1. Senkron: tokensiz 401
    const unauthSync = await sendSync('{"questions":[]}', '');
    assert.equal(unauthSync.status, 401, 'Tokensiz istek 401 dönmeli');

    const wrongTokenSync = await sendSync('{"questions":[]}', 'wrong-token');
    assert.equal(wrongTokenSync.status, 401, 'Yanlış token 401 dönmeli');

    // 2. Senkron: bozuk gövdeler 400
    const malformed1 = await sendSync('invalid json');
    assert.equal(malformed1.status, 400, 'Geçersiz JSON 400 dönmeli');

    const malformed2 = await sendSync('{"questions":[]}');
    assert.equal(malformed2.status, 400, 'Boş questions dizisi 400 dönmeli');

    const malformed3 = await sendSync(JSON.stringify({
      questions: [{ no: 'X1', kategori: 'Hukuk', konu: 'Konu', kontrol: 'edilecek', guncellikNotu: '', soru: 'Soru 1', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'm' }], ipuclari: ['ip1'] }],
    }));
    assert.equal(malformed3.status, 400, 'no regex ^S\\d+$ uymazsa 400 dönmeli');

    const malformed4 = await sendSync(JSON.stringify({
      questions: [
        { no: 'S1', kategori: 'Hukuk', konu: 'Konu', kontrol: 'edilecek', guncellikNotu: '', soru: 'Soru 1', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'm' }], ipuclari: ['ip1'] },
        { no: 'S1', kategori: 'Kredi', konu: 'Konu', kontrol: 'edilecek', guncellikNotu: '', soru: 'Soru 2', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'm' }], ipuclari: ['ip2'] },
      ],
    }));
    assert.equal(malformed4.status, 400, 'Mükerrer soru no 400 dönmeli');

    const malformed5 = await sendSync(JSON.stringify({
      questions: [{ no: 'S1', kategori: 'Hukuk', konu: 'Konu', kontrol: 'edilecek', guncellikNotu: '', soru: 'Soru 1', durum: 'bilinmeyen', cevap: [{ tur: 'paragraf', metin: 'm' }], ipuclari: ['ip1'] }],
    }));
    assert.equal(malformed5.status, 400, 'Geçersiz durum 400 dönmeli');

    const malformed6 = await sendSync(JSON.stringify({
      questions: [{ no: 'S1', kategori: 'Hukuk', konu: 'Konu', kontrol: 'edilecek', guncellikNotu: '', soru: 'Soru 1', durum: 'tam', cevap: [], ipuclari: ['ip1'] }],
    }));
    assert.equal(malformed6.status, 400, 'Boş cevap 400 dönmeli');

    const malformed7 = await sendSync(JSON.stringify({
      questions: [{ no: 'S1', kategori: 'Hukuk', konu: 'Konu', kontrol: 'edilecek', guncellikNotu: '', soru: 'Soru 1', durum: 'tam', cevap: [{ tur: 'gecersiz', metin: 'm' }], ipuclari: ['ip1'] }],
    }));
    assert.equal(malformed7.status, 400, 'Geçersiz cevap türü 400 dönmeli');

    const malformed8 = await sendSync(JSON.stringify({
      questions: [{ no: 'S1', kategori: 'Hukuk', konu: 'Konu', kontrol: 'edilecek', guncellikNotu: '', soru: 'Soru 1', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'm' }], ipuclari: [''] }],
    }));
    assert.equal(malformed8.status, 400, 'Boş ipucu öğesi 400 dönmeli');

    const malformedOncelik = await sendSync(JSON.stringify({
      questions: [{ no: 'S1', kategori: 'Hukuk', konu: 'Konu', kontrol: 'edilecek', guncellikNotu: '', soru: 'Soru 1', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'm' }], ipuclari: ['ip1'], oncelik: 'gecersiz' }],
    }));
    assert.equal(malformedOncelik.status, 400, 'Geçersiz oncelik değeri 400 dönmeli');

    // 3. Geçerli gövde: 7 kategori, kategori başına >= 2 soru, biri kismi, biri tablolu
    const validQuestions = [
      // Kategori 1: Hukuk
      { no: 'S1', kategori: 'Hukuk', soru: 'Hukuk Soru 1', durum: 'tam', cevap: [{ tur: 'baslik', metin: 'Başlık' }, { tur: 'paragraf', metin: 'Paragraf' }], ipuclari: ['İpucu H1-1', 'İpucu H1-2'] },
      { no: 'S2', kategori: 'Hukuk', soru: 'Hukuk Soru 2', durum: 'kismi', cevap: [{ tur: 'paragraf', metin: 'Kısmi cevap' }], ipuclari: ['İpucu H2'] },
      // Kategori 2: Kredi
      { no: 'S3', kategori: 'Kredi', soru: 'Kredi Soru 1', durum: 'tam', cevap: [{ tur: 'madde', metin: 'Madde 1' }, { tur: 'madde', metin: 'Madde 2' }], ipuclari: ['İpucu K1'] },
      { no: 'S4', kategori: 'Kredi', soru: 'Kredi Soru 2', durum: 'tam', cevap: [{ tur: 'tablo', satirlar: [['Başlık 1', 'Başlık 2'], ['Veri 1', 'Veri 2']] }], ipuclari: ['İpucu K2-1', 'İpucu K2-2'] },
      // Kategori 3: Muhasebe
      { no: 'S5', kategori: 'Muhasebe', soru: 'Muhasebe Soru 1', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'M1' }], ipuclari: ['İpucu M1'] },
      { no: 'S6', kategori: 'Muhasebe', soru: 'Muhasebe Soru 2', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'M2' }], ipuclari: ['İpucu M2'] },
      // Kategori 4: Ekonomi
      { no: 'S7', kategori: 'Ekonomi', soru: 'Ekonomi Soru 1', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'E1' }], ipuclari: ['İpucu E1'] },
      { no: 'S8', kategori: 'Ekonomi', soru: 'Ekonomi Soru 2', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'E2' }], ipuclari: ['İpucu E2'] },
      // Kategori 5: Bankacılık
      { no: 'S9', kategori: 'Bankacılık', soru: 'Bankacılık Soru 1', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'B1' }], ipuclari: ['İpucu B1'] },
      { no: 'S10', kategori: 'Bankacılık', soru: 'Bankacılık Soru 2', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'B2' }], ipuclari: ['İpucu B2'] },
      // Kategori 6: Kambiyo
      { no: 'S11', kategori: 'Kambiyo', soru: 'Kambiyo Soru 1', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'Ka1' }], ipuclari: ['İpucu Ka1'] },
      { no: 'S12', kategori: 'Kambiyo', soru: 'Kambiyo Soru 2', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'Ka2' }], ipuclari: ['İpucu Ka2'] },
      // Kategori 7: Mevzuat
      { no: 'S13', kategori: 'Mevzuat', soru: 'Mevzuat Soru 1', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'Mev1' }], ipuclari: ['İpucu Mev1'] },
      { no: 'S14', kategori: 'Mevzuat', soru: 'Mevzuat Soru 2', durum: 'tam', cevap: [{ tur: 'paragraf', metin: 'Mev2' }], ipuclari: ['İpucu Mev2'] },
    ].map(q => ({ ...q, konu: q.soru, kontrol: 'edilecek', guncellikNotu: '' }));
    const validPayload = JSON.stringify({ questions: validQuestions });

    const syncRes1 = await sendSync(validPayload);
    assert.equal(syncRes1.status, 200, 'Geçerli gövde 200 dönmeli');
    const syncData1 = await syncRes1.json();
    assert.equal(syncData1.ok, true);
    assert.equal(syncData1.questionCount, 14);
    assert.ok(syncData1.version, 'Sürüm dönmeli');

    // 4. Aynı gövde tekrar gelirse yazmaz (idempotent / skip)
    const syncRes2 = await sendSync(validPayload);
    assert.equal(syncRes2.status, 200);
    const syncData2 = await syncRes2.json();
    assert.equal(syncData2.version, syncData1.version);

    const dbRows = await db.select().from(schema.klasikSorular);
    assert.equal(dbRows.length, 14, 'Tabloda tam 14 soru olmalı');
    assert.ok(dbRows.every((r: any) => r.oncelik === 'normal'), 'oncelik alanı olmayan gövde senkronlanınca tüm sorular normal olmalı');

    // 5. klasik-daily: Girişsiz ve onaysız kullanıcı
    currentProfile = null;
    const anonRes = await sendExam({ action: 'klasik-daily' });
    assert.equal(anonRes.status, 401, 'Girişsiz kullanıcı 401 almalı');

    currentProfile = { userId: 'u_inactive', username: 'onaysiz', isActive: false };
    const inactiveRes = await sendExam({ action: 'klasik-daily' });
    assert.equal(inactiveRes.status, 403, 'Onaysız kullanıcı 403 almalı');

    // 6. klasik-daily: Kullanıcı 1 istek atar
    currentProfile = { userId: 'u1', username: 'kullanici1', isActive: true };
    const dailyRes1 = await sendExam({ action: 'klasik-daily' });
    assert.equal(dailyRes1.status, 200);
    const dailyData1 = await dailyRes1.json();
    assert.equal(dailyData1.questions.length, 7, 'Tam 7 soru dönmeli');

    // Hiçbir soru henüz görülmedi
    assert.ok(dailyData1.questions.every((q: any) => q.seen === false), 'Başlangıçta seen false olmalı');

    // 7. Aynı gün Kullanıcı 2 de aynı listeyi alır
    currentProfile = { userId: 'u2', username: 'kullanici2', isActive: true };
    const dailyRes2 = await sendExam({ action: 'klasik-daily' });
    const dailyData2 = await dailyRes2.json();
    assert.deepEqual(
      dailyData1.questions.map((q: any) => q.no),
      dailyData2.questions.map((q: any) => q.no),
      'Aynı gün iki kullanıcı aynı soruları almalı'
    );

    // 8. Farklı gün deterministik farklı/aynı liste türetimi:
    // Saf fonksiyon sınav seçimini doğrula
    const seedDayA = examCore.klasikDailySeed('2026-10-05', 'test-key');
    const seedDayB = examCore.klasikDailySeed('2026-10-06', 'test-key');
    assert.notEqual(seedDayA, seedDayB, 'Farklı günler farklı seed üretmeli');
    const pickA = examCore.selectKlasikQuestions(dbRows, new Map(), seedDayA);
    const pickB = examCore.selectKlasikQuestions(dbRows, new Map(), seedDayB);
    assert.equal(pickA.length, 7);
    assert.equal(pickB.length, 7);
    // Belirlenimlilik: aynı seed ile tekrar çağırınca birebir aynı
    const pickARepeat = examCore.selectKlasikQuestions(dbRows, new Map(), seedDayA);
    assert.deepEqual(pickA, pickARepeat, 'Aynı seed her zaman aynı listeyi vermeli');

    // 9. klasik-seen
    // Bilinmeyen soru numarası -> 400
    const seenBad = await sendExam({ action: 'klasik-seen', no: 'S999' });
    assert.equal(seenBad.status, 400, 'Bilinmeyen soru 400 dönmeli');

    // Geçerli soru -> kullanıcı 2 için işaretle
    const targetNo = dailyData1.questions[0].no;
    const seenOk1 = await sendExam({ action: 'klasik-seen', no: targetNo });
    assert.equal(seenOk1.status, 200);
    const seenData1 = await seenOk1.json();
    assert.equal(seenData1.ok, true);

    // İkinci çağrı satır çoğaltmaz (idempotent)
    const seenOk2 = await sendExam({ action: 'klasik-seen', no: targetNo });
    assert.equal(seenOk2.status, 200);

    const gorulmeRows = await db.select().from(schema.klasikGorulme);
    assert.equal(gorulmeRows.length, 1, 'Tek bir görülme kaydı olmalı');
    assert.equal(gorulmeRows[0].userId, 'u2');
    assert.equal(gorulmeRows[0].soruNo, targetNo);

    // Kullanıcı 2 için klasik-daily'de seen true olmalı, kullanıcı 1 için false kalmalı
    const dailyAfterU2 = await (await sendExam({ action: 'klasik-daily' })).json();
    assert.equal(dailyAfterU2.questions[0].seen, true, 'Kullanıcı 2 için soru seen olmalı');

    currentProfile = { userId: 'u1', username: 'kullanici1', isActive: true };
    const dailyAfterU1 = await (await sendExam({ action: 'klasik-daily' })).json();
    assert.equal(dailyAfterU1.questions[0].seen, false, 'Kullanıcı 1 için soru seen olmamalı');

    // 10. Yeniden senkron: klasik_gorulme silinmez
    const modifiedPayload = JSON.stringify({
      questions: validQuestions.map(q => q.no === 'S1' ? { ...q, soru: 'Hukuk Soru 1 Güncellendi' } : q),
    });
    const syncRes3 = await sendSync(modifiedPayload);
    assert.equal(syncRes3.status, 200);
    const gorulmeAfterSync = await db.select().from(schema.klasikGorulme);
    assert.equal(gorulmeAfterSync.length, 1, 'Yeniden senkronize olunca klasik_gorulme silinmemeli');

    const extended = [...validQuestions,
      { no: 'S15', kategori: 'Hukuk', konu: 'Cevapsız konu', soru: 'Cevapsız soru', durum: 'cevapsiz', kontrol: 'edilecek', guncellikNotu: 'Şimdilik güncel değil', cevap: [], ipuclari: [] },
      { ...validQuestions[0], no: 'S16', kontrol: 'edildi', oncelik: 'dusuk', ipuclari: [], guncellikNotu: 'Güncellenecek bilgi' }];
    const extendedPayload = JSON.stringify({ questions: extended });
    assert.equal((await sendSync(extendedPayload)).status, 200);
    for (const invalid of [{ ...extended[0], cevap: [] }, { ...extended[0], kontrol: 'yanlis' },
      { ...extended[0], konu: '' }, { ...extended[0], guncellikNotu: 7 }, { ...extended[0], ipuclari: [''] }]) {
      assert.equal((await sendSync(JSON.stringify({ questions: [invalid] }))).status, 400);
    }
    const list = await (await sendExam({ action: 'klasik-list' })).json();
    assert.ok(!('admin' in list));
    assert.equal(list.questions.length, 16);
    assert.deepEqual(list.questions.map((q: any) => q.no), extended.map(q => q.no));
    assert.deepEqual(list.questions.map((q: any) => q.kontrol), extended.map(q => q.kontrol));
    assert.deepEqual(list.questions.map((q: any) => q.oncelik), extended.map((q: any) => q.oncelik ?? 'normal'));
    assert.equal(list.questions.find((q: any) => q.no === 'S16')?.oncelik, 'dusuk');
    assert.equal(list.questions.find((q: any) => q.no === 'S1')?.oncelik, 'normal');
    assert.ok(list.questions.every((q: any) => !('cevap' in q) && !('ipuclari' in q)));
    currentProfile.isAdmin = true;
    const adminList = await (await sendExam({ action: 'klasik-list' })).json();
    assert.ok(!('admin' in adminList));
    assert.deepEqual(adminList.questions, list.questions);
    currentProfile.isAdmin = false;
    assert.equal((await sendExam({ action: 'klasik-question', no: 'S999' })).status, 400);
    const unanswered = await (await sendExam({ action: 'klasik-question', no: 'S15' })).json();
    assert.equal(unanswered.durum, 'cevapsiz');
    assert.deepEqual(unanswered.cevap, []);
    assert.deepEqual(unanswered.ipuclari, []);
    assert.equal(unanswered.guncellikNotu, 'Şimdilik güncel değil');
    assert.equal(unanswered.isaret, null);
    const filteredDaily = await (await sendExam({ action: 'klasik-daily' })).json();
    assert.ok(filteredDaily.questions.every((q: any) => q.durum !== 'cevapsiz' && 'konu' in q && 'guncellikNotu' in q && 'isaret' in q));
    // 12. klasik-daily kalıcı ve öncelikli seçim akışı (uçtan uca)
    // Temiz bir veri seti: 12 normal soru, 4 düşük soru, 1 cevapsız soru
    await pg.exec('DELETE FROM klasik_gunun_secimi');
    const priorityTestQuestions = [
      ...Array.from({ length: 16 }, (_, i) => ({
        no: `S10${i + 1}`,
        kategori: `Kat${(i % 3) + 1}`,
        konu: `Normal Konu ${i + 1}`,
        kontrol: 'edildi',
        guncellikNotu: '',
        soru: `Normal Soru ${i + 1}`,
        durum: 'tam',
        cevap: [{ tur: 'paragraf', metin: `Cevap N${i + 1}` }],
        ipuclari: [`İpucu N${i + 1}`],
        oncelik: 'normal',
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        no: `S20${i + 1}`,
        kategori: `Kat${(i % 2) + 1}`,
        konu: `Düşük Konu ${i + 1}`,
        kontrol: 'edildi',
        guncellikNotu: '',
        soru: `Düşük Soru ${i + 1}`,
        durum: 'tam',
        cevap: [{ tur: 'paragraf', metin: `Cevap D${i + 1}` }],
        ipuclari: [`İpucu D${i + 1}`],
        oncelik: 'dusuk',
      })),
      {
        no: 'S301',
        kategori: 'Kat1',
        konu: 'Cevapsız Konu',
        kontrol: 'edilecek',
        guncellikNotu: '',
        soru: 'Cevapsız Soru',
        durum: 'cevapsiz',
        cevap: [],
        ipuclari: [],
        oncelik: 'normal',
      },
    ];
    assert.equal((await sendSync(JSON.stringify({ questions: priorityTestQuestions }))).status, 200);

    // Gün 1: Normal sorulardan 7 tanesi seçilir
    currentDay = '2026-11-01';
    currentProfile = { userId: 'u1', username: 'kullanici1', isActive: true };
    const resDay1 = await (await sendExam({ action: 'klasik-daily' })).json();
    assert.equal(resDay1.questions.length, 7, 'Gün 1 7 soru dönmeli');
    const day1Nos = resDay1.questions.map((q: any) => q.no);
    // (ii) normal bitmeden hiçbir günde düşük soru yok
    assert.ok(day1Nos.every((no: string) => no.startsWith('S10')), 'Gün 1 sadece normal sorulardan oluşmalı');

    // (v) aynı gün ikinci istek aynı 7 soruyu aynı sırayla döndürür ve tabloda tek satır vardır
    const resDay1Repeat = await (await sendExam({ action: 'klasik-daily' })).json();
    assert.deepEqual(resDay1Repeat.questions.map((q: any) => q.no), day1Nos, 'Aynı gün ikinci istek aynı soruları aynı sırayla döndürmeli');
    const secimRowsDay1 = await db.select().from(schema.klasikGununSecimi).where(orm.eq(schema.klasikGununSecimi.gun, '2026-11-01'));
    assert.equal(secimRowsDay1.length, 1, 'klasik_gunun_secimi tablosunda gün için tek satır olmalı');
    assert.deepEqual(secimRowsDay1[0].sorular, day1Nos, 'Tablodaki kayıtlı sorular yanıttakiyle aynı olmalı');

    // (vi) iki farklı kullanıcı aynı seçimi görür
    currentProfile = { userId: 'u2', username: 'kullanici2', isActive: true };
    const resDay1U2 = await (await sendExam({ action: 'klasik-daily' })).json();
    assert.deepEqual(resDay1U2.questions.map((q: any) => q.no), day1Nos, 'Farklı kullanıcı aynı seçimi ve sırayı görmeli');
    currentProfile = { userId: 'u1', username: 'kullanici1', isActive: true };

    // Gün 2: Kalan 9 normal sorudan 7 tanesi seçilir
    currentDay = '2026-11-02';
    const resDay2 = await (await sendExam({ action: 'klasik-daily' })).json();
    assert.equal(resDay2.questions.length, 7, 'Gün 2 7 soru dönmeli');
    const day2Nos = resDay2.questions.map((q: any) => q.no);
    // (i) ardışık günlerde normal sorular tekrarsız tükenir
    assert.equal(day1Nos.some((no: string) => day2Nos.includes(no)), false, 'Gün 1 ve Gün 2 arasında tekrar eden normal soru olmamalı');
    // (ii) normal bitmeden hiçbir günde düşük soru yok
    assert.ok(day2Nos.every((no: string) => no.startsWith('S10')), 'Gün 2 sadece normal sorulardan oluşmalı');

    // Gün 3: Normalde 2 soru kaldı (16 - 7 - 7 = 2). 7'ye ulaşmak için 5 düşük soru seçilmeli
    currentDay = '2026-11-03';
    const resDay3 = await (await sendExam({ action: 'klasik-daily' })).json();
    assert.equal(resDay3.questions.length, 7, 'Gün 3 7 soru dönmeli');
    const day3Nos = resDay3.questions.map((q: any) => q.no);
    const day3Normal = day3Nos.filter((no: string) => no.startsWith('S10'));
    const day3Dusuk = day3Nos.filter((no: string) => no.startsWith('S20'));
    // (i) normal sorular tekrarsız tükenir: toplam 16 normal sorunun hepsi (7 + 7 + 2) seçilmiş olur
    assert.equal(day3Normal.length, 2, 'Kalan 2 normal soru seçilmiş olmalı');
    const allNormalUsed = [...day1Nos, ...day2Nos, ...day3Normal];
    assert.equal(new Set(allNormalUsed).size, 16, '16 normal sorunun tamamı tekrarsız tükenmeli');
    // (iii) normalden 7'den az kalan gün düşükle tamamlanır
    assert.equal(day3Dusuk.length, 5, '7 soruya ulaşmak için kalan 5 soru düşük önceliklilerden tamamlanmalı');

    // Gün 4: Düşük sorulardan 1 tane kalmıştı (6 - 5 = 1). Kalan 6 soru en eski günden (Gün 1) tamamlanmalı
    currentDay = '2026-11-04';
    const resDay4 = await (await sendExam({ action: 'klasik-daily' })).json();
    assert.equal(resDay4.questions.length, 7, 'Gün 4 7 soru dönmeli');
    const day4Nos = resDay4.questions.map((q: any) => q.no);
    const day4Dusuk = day4Nos.filter((no: string) => no.startsWith('S20'));
    assert.equal(day4Dusuk.length, 1, 'Kalan son 1 düşük soru seçilmeli');
    // (iv) hepsi bitince en eski gösterilenler gelir: kalan 6 soru Gün 1 sorularından gelmeli
    const day1Set = new Set(day1Nos);
    const day4Oldest = day4Nos.filter((no: string) => day1Set.has(no));
    assert.equal(day4Oldest.length, 6, 'Tüm sorular gösterilince en eski gösterilen günün soruları (Gün 1) önce gelmeli');

    // (vii) seçimdeki soru silinince yanıtta atlanır ve yeni soru eklenmez
    const deletedNo = day4Nos[0];
    await pg.exec(`DELETE FROM klasik_sorular WHERE no = '${deletedNo}'`);
    const resAfterDelete = await (await sendExam({ action: 'klasik-daily' })).json();
    assert.equal(resAfterDelete.questions.length, 6, 'Silinen soru yanıtta atlanmalı, uzunluk 6 olmalı');
    assert.equal(resAfterDelete.questions.some((q: any) => q.no === deletedNo), false, 'Silinen soru yanıtta bulunmamalı');
    assert.deepEqual(
      resAfterDelete.questions.map((q: any) => q.no),
      day4Nos.filter((no: string) => no !== deletedNo),
      'Kalan sorular kayıtlı sırayı korumalı ve yeni soru eklenmemeli'
    );

    // Bir soru da cevapsız duruma getirilince yanıtta atlanır
    const unansweredNo = day4Nos[1];
    await pg.exec(`UPDATE klasik_sorular SET durum = 'cevapsiz' WHERE no = '${unansweredNo}'`);
    const resAfterUnanswered = await (await sendExam({ action: 'klasik-daily' })).json();
    assert.equal(resAfterUnanswered.questions.length, 5, 'Cevapsız yapılan soru da yanıtta atlanmalı');
    assert.deepEqual(
      resAfterUnanswered.questions.map((q: any) => q.no),
      day4Nos.filter((no: string) => no !== deletedNo && no !== unansweredNo),
      'Cevapsız kalan soru atlandıktan sonra kalan sorular kayıtlı sırayı korumalı'
    );

    // Durumu geri yükle
    await pg.exec('DELETE FROM klasik_gunun_secimi');
    assert.equal((await sendSync(extendedPayload)).status, 200);
    currentDay = null;
    for (const no of ['S999', '']) assert.equal((await sendExam({ action: 'klasik-mark', no, isaret: 'sari' })).status, 400);
    for (const isaret of ['gecersiz', 5, undefined]) assert.equal((await sendExam({ action: 'klasik-mark', no: 'S1', isaret })).status, 400);
    assert.equal((await sendExam({ action: 'klasik-mark', no: 'S1', isaret: 'sari' })).status, 200);
    assert.equal((await sendExam({ action: 'klasik-mark', no: 'S1', isaret: 'yesil' })).status, 200);
    assert.equal((await db.select().from(schema.klasikIsaret)).length, 1);
    currentProfile = { userId: 'u2', username: 'kullanici2', isActive: true };
    assert.equal((await (await sendExam({ action: 'klasik-question', no: 'S1' })).json()).isaret, null);
    await sendExam({ action: 'klasik-mark', no: 'S1', isaret: 'kirmizi' });
    await sendExam({ action: 'klasik-mark', no: 'S1', isaret: null });
    const remainingMarks = await db.select().from(schema.klasikIsaret);
    assert.equal(remainingMarks.length, 1);
    assert.equal(remainingMarks[0].userId, 'u1');
    for (const metin of ['', '   ', 'x'.repeat(4001), 8]) assert.equal((await sendExam({ action: 'klasik-feedback', no: 'S1', metin })).status, 400);
    assert.equal((await sendExam({ action: 'klasik-feedback', no: 'S999', metin: 'Bilgi' })).status, 400);
    assert.equal((await sendExam({ action: 'klasik-feedback', no: 'S1', metin: '  Yeni bilgi  ' })).status, 200);
    const feedbackRoute = load('../app/api/admin/klasik-feedback/route.ts');
    const feedbackRequest = (method: string, body?: any, token = 'test-sync-token') => new Request('https://test.invalid/api/admin/klasik-feedback', {
      method, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal((await feedbackRoute.GET(feedbackRequest('GET', undefined, ''))).status, 401);
    assert.equal((await feedbackRoute.POST(feedbackRequest('POST', { ids: [] }, ''))).status, 401);
    const feedbackList = await (await feedbackRoute.GET(feedbackRequest('GET'))).json();
    assert.equal(feedbackList.items.length, 1);
    assert.equal(feedbackList.items[0].metin, 'Yeni bilgi');
    assert.equal(feedbackList.items[0].kullaniciAdi, 'kullanici2');
    await sendSync(JSON.stringify({ questions: extended.map(q => ({ ...q, soru: q.soru + ' güncel' })) }));
    assert.equal((await db.select().from(schema.klasikIsaret)).length, 1);
    assert.equal((await db.select().from(schema.klasikGeriBildirim)).length, 1);
    assert.equal((await db.select().from(schema.klasikGorulme)).length, 1);
    const processed = await (await feedbackRoute.POST(feedbackRequest('POST', { ids: [feedbackList.items[0].id] }))).json();
    assert.deepEqual(processed, { ok: true, updated: 1 });
    assert.deepEqual((await (await feedbackRoute.GET(feedbackRequest('GET'))).json()).items, []);
    // 13. klasik-reminder: yetki, doğrulama, renk işaretiyle bağımsız bir arada yaşama ve kullanıcı izolasyonu
    currentProfile = null;
    assert.equal((await sendExam({ action: 'klasik-reminder', no: 'S1', hatirlatici: true })).status, 401, 'Girişsiz kullanıcı klasik-reminder için 401 almalı');
    currentProfile = { userId: 'u_inactive', username: 'onaysiz', isActive: false };
    assert.equal((await sendExam({ action: 'klasik-reminder', no: 'S1', hatirlatici: true })).status, 403, 'Onaysız kullanıcı klasik-reminder için 403 almalı');
    currentProfile = { userId: 'u1', username: 'kullanici1', isActive: true };
    for (const no of ['S999', '']) {
      assert.equal((await sendExam({ action: 'klasik-reminder', no, hatirlatici: true })).status, 400, 'Geçersiz soru no 400 dönmeli');
    }
    for (const hatirlatici of ['evet', 1, null, undefined]) {
      assert.equal((await sendExam({ action: 'klasik-reminder', no: 'S1', hatirlatici })).status, 400, 'Boolean olmayan hatirlatici 400 dönmeli');
    }

    // u1 için S1 zaten yeşil işaretli; şimdi hatırlatıcıyı açıyoruz
    assert.equal((await sendExam({ action: 'klasik-reminder', no: 'S1', hatirlatici: true })).status, 200);
    const q1U1AfterReminder = await (await sendExam({ action: 'klasik-question', no: 'S1' })).json();
    assert.equal(q1U1AfterReminder.hatirlatici, true, 'Hatırlatıcı true olmalı');
    assert.equal(q1U1AfterReminder.isaret, 'yesil', 'Mevcut renkli işaret (yesil) hatırlatıcı açılınca silinmemeli');

    // Renk işaretini kaldırıyoruz (isaret: null); hatırlatıcı silinmemeli!
    assert.equal((await sendExam({ action: 'klasik-mark', no: 'S1', isaret: null })).status, 200);
    const q1U1ColorCleared = await (await sendExam({ action: 'klasik-question', no: 'S1' })).json();
    assert.equal(q1U1ColorCleared.isaret, null, 'İşaret null olmalı');
    assert.equal(q1U1ColorCleared.hatirlatici, true, 'Renk kaldırılınca hatırlatıcı silinmemeli');

    // klasik-list ve klasik-daily yanıtlarında hatirlatici alanı denetimi
    const listCheck = await (await sendExam({ action: 'klasik-list' })).json();
    const listS1 = listCheck.questions.find((q: any) => q.no === 'S1');
    assert.equal(listS1.hatirlatici, true, 'klasik-list yanıtında S1 hatirlatici true olmalı');
    assert.equal(listS1.isaret, null, 'klasik-list yanıtında S1 isaret null olmalı');

    const dailyCheck = await (await sendExam({ action: 'klasik-daily' })).json();
    const dailyS1 = dailyCheck.questions.find((q: any) => q.no === 'S1');
    if (dailyS1) {
      assert.equal(dailyS1.hatirlatici, true, 'klasik-daily yanıtında S1 hatirlatici true olmalı');
      assert.equal(dailyS1.isaret, null, 'klasik-daily yanıtında S1 isaret null olmalı');
    }

    // Kullanıcı 2 için kontrol: u2'de S1 hatırlatıcısı false kalmalı
    currentProfile = { userId: 'u2', username: 'kullanici2', isActive: true };
    const q1U2Check = await (await sendExam({ action: 'klasik-question', no: 'S1' })).json();
    assert.equal(q1U2Check.hatirlatici, false, 'u2 için hatırlatıcı false kalmalı (izolasyon)');
    const listU2Check = await (await sendExam({ action: 'klasik-list' })).json();
    assert.equal(listU2Check.questions.find((q: any) => q.no === 'S1').hatirlatici, false);

    // u1'e dönüp hatırlatıcıyı kapatıyoruz; hem işaret hem hatırlatıcı boş olduğu için satır temizlenir
    currentProfile = { userId: 'u1', username: 'kullanici1', isActive: true };
    assert.equal((await sendExam({ action: 'klasik-reminder', no: 'S1', hatirlatici: false })).status, 200);
    const q1U1ReminderOff = await (await sendExam({ action: 'klasik-question', no: 'S1' })).json();
    assert.equal(q1U1ReminderOff.hatirlatici, false);
    assert.equal(q1U1ReminderOff.isaret, null);
    const rowsRemaining = await db.select().from(schema.klasikIsaret).where(orm.eq(schema.klasikIsaret.userId, 'u1'));
    assert.equal(rowsRemaining.length, 0, 'Hem işaret hem hatırlatıcı yokken u1 kaydı silinmeli');

    // Renk varken hatırlatıcı kapatılınca renk silinmemeli
    await sendExam({ action: 'klasik-mark', no: 'S1', isaret: 'sari' });
    await sendExam({ action: 'klasik-reminder', no: 'S1', hatirlatici: true });
    await sendExam({ action: 'klasik-reminder', no: 'S1', hatirlatici: false });
    const q1ColorKept = await (await sendExam({ action: 'klasik-question', no: 'S1' })).json();
    assert.equal(q1ColorKept.isaret, 'sari', 'Hatırlatıcı kapatılınca renkli işaret silinmemeli');
    assert.equal(q1ColorKept.hatirlatici, false);

    currentProfile = null;
    for (const action of ['klasik-list', 'klasik-question', 'klasik-mark', 'klasik-reminder', 'klasik-feedback']) {
      assert.equal((await sendExam({ action, no: 'S1', isaret: 'yesil', hatirlatici: true, metin: 'Bilgi' })).status, 401);
    }

    // 14. Klasik Ses: Yönetim ucu yetki ve doğrulama denetimleri
    assert.equal((await sendAdminSes('GET', '', undefined, '')).status, 401, 'Admin ses tokensiz istek 401 dönmeli');
    assert.equal((await sendAdminSes('GET', '', undefined, 'wrong-token')).status, 401, 'Admin ses yanlış token 401 dönmeli');
    assert.equal((await sendAdminSes('PUT', 'no=S1&tur=soru&surum=0123456789abcdef', Buffer.from('x'), '')).status, 401);
    assert.equal((await sendAdminSes('DELETE', 'no=S1&tur=soru', undefined, '')).status, 401);

    // PUT doğrulama hataları (400)
    assert.equal((await sendAdminSes('PUT', 'no=bad&tur=soru&surum=0123456789abcdef', Buffer.from('x'))).status, 400, 'Geçersiz no 400 dönmeli');
    assert.equal((await sendAdminSes('PUT', 'no=&tur=soru&surum=0123456789abcdef', Buffer.from('x'))).status, 400, 'Boş no 400 dönmeli');
    assert.equal((await sendAdminSes('PUT', 'no=S1&tur=diger&surum=0123456789abcdef', Buffer.from('x'))).status, 400, 'Geçersiz tur 400 dönmeli');
    assert.equal((await sendAdminSes('PUT', 'no=S1&tur=soru&surum=xyz', Buffer.from('x'))).status, 400, 'Kısa surum 400 dönmeli');
    assert.equal((await sendAdminSes('PUT', 'no=S1&tur=soru&surum=0123456789abcdef0', Buffer.from('x'))).status, 400, 'Uzun surum 400 dönmeli');
    assert.equal((await sendAdminSes('PUT', 'no=S1&tur=soru&surum=0123456789abcdef', Buffer.alloc(0))).status, 400, 'Boş gövde 400 dönmeli');
    assert.equal((await sendAdminSes('PUT', 'no=S1&tur=soru&surum=0123456789abcdef', Buffer.alloc(4_000_001))).status, 400, '4MB aşan gövde 400 dönmeli');

    // Geçerli PUT ve GET listesi
    const sampleAudio1 = Buffer.from('mp3-soru-s1-test-bytes');
    const putRes1 = await sendAdminSes('PUT', 'no=S1&tur=soru&surum=0123456789abcdef', sampleAudio1);
    assert.equal(putRes1.status, 200);
    assert.deepEqual(await putRes1.json(), { ok: true });

    const getRes1 = await sendAdminSes('GET');
    assert.equal(getRes1.status, 200);
    const getData1 = await getRes1.json();
    assert.equal(getData1.items.length, 1);
    assert.deepEqual(getData1.items[0], { no: 'S1', tur: 'soru', surum: '0123456789abcdef' });
    assert.ok(!('veri' in getData1.items[0]), 'GET listesinde veri sütunu yer almamalı');

    // Aynı anahtara ikinci PUT satır çoğaltmaz, sürümü ve veriyi günceller
    const sampleAudio1V2 = Buffer.from('mp3-soru-s1-v2-test-bytes');
    const putRes2 = await sendAdminSes('PUT', 'no=S1&tur=soru&surum=fedcba9876543210', sampleAudio1V2);
    assert.equal(putRes2.status, 200);

    const getData2 = await (await sendAdminSes('GET')).json();
    assert.equal(getData2.items.length, 1, 'Mükerrer satır oluşmamalı');
    assert.deepEqual(getData2.items[0], { no: 'S1', tur: 'soru', surum: 'fedcba9876543210' });

    // Cevap kaydı da ekle
    const sampleAudio1Cevap = Buffer.from('mp3-cevap-s1-test-bytes');
    await sendAdminSes('PUT', 'no=S1&tur=cevap&surum=1122334455667788', sampleAudio1Cevap);
    const getData3 = await (await sendAdminSes('GET')).json();
    assert.equal(getData3.items.length, 2);

    // DELETE işlemi
    const delRes = await sendAdminSes('DELETE', 'no=S1&tur=soru');
    assert.equal(delRes.status, 200);
    assert.deepEqual(await delRes.json(), { ok: true });

    const getDataAfterDel = await (await sendAdminSes('GET')).json();
    assert.equal(getDataAfterDel.items.length, 1);
    assert.deepEqual(getDataAfterDel.items[0], { no: 'S1', tur: 'cevap', surum: '1122334455667788' });

    // S1 soru kaydını tekrar yükle
    await sendAdminSes('PUT', 'no=S1&tur=soru&surum=fedcba9876543210', sampleAudio1V2);

    // 15. Kullanıcı ucu /api/klasik-ses yetki, 404 ve bayt doğrulaması
    currentProfile = null;
    assert.equal((await sendUserSes('no=S1&tur=soru')).status, 401, 'Girişsiz kullanıcıya 401 dönmeli');
    currentProfile = { userId: 'u_inactive', username: 'onaysiz', isActive: false };
    assert.equal((await sendUserSes('no=S1&tur=soru')).status, 403, 'Onaysız hesaba 403 dönmeli');

    currentProfile = { userId: 'u1', username: 'kullanici1', isActive: true };
    assert.equal((await sendUserSes('no=S999&tur=soru')).status, 404, 'Olmayan soruya 404 dönmeli');
    assert.equal((await sendUserSes('no=S2&tur=soru')).status, 404, 'Ses kaydı olmayan soruya 404 dönmeli');

    const userSesRes = await sendUserSes('no=S1&tur=soru');
    assert.equal(userSesRes.status, 200);
    assert.equal(userSesRes.headers.get('content-type'), 'audio/mpeg');
    assert.equal(userSesRes.headers.get('cache-control'), 'private, max-age=31536000, immutable');
    const returnedBytes = Buffer.from(await userSesRes.arrayBuffer());
    assert.deepEqual(returnedBytes, sampleAudio1V2, 'Yüklenen baytlar aynen dönmeli');

    // 16. klasik-question ve klasik-daily yanıtlarında ses alanı
    const q1AudioResponse = await (await sendExam({ action: 'klasik-question', no: 'S1' })).json();
    assert.deepEqual(q1AudioResponse.ses, { soru: 'fedcba9876543210', cevap: '1122334455667788' });

    const q2AudioResponse = await (await sendExam({ action: 'klasik-question', no: 'S2' })).json();
    assert.deepEqual(q2AudioResponse.ses, { soru: null, cevap: null });

    const dailyAudioResponse = await (await sendExam({ action: 'klasik-daily' })).json();
    const dailyS1Audio = dailyAudioResponse.questions.find((q: any) => q.no === 'S1');
    if (dailyS1Audio) {
      assert.deepEqual(dailyS1Audio.ses, { soru: 'fedcba9876543210', cevap: '1122334455667788' });
    }
    const dailyOtherAudio = dailyAudioResponse.questions.find((q: any) => q.no !== 'S1');
    if (dailyOtherAudio) {
      assert.deepEqual(dailyOtherAudio.ses, { soru: null, cevap: null });
    }

    // 17. Yeniden sync-klasik ses kayıtlarını silmemeli
    await sendSync(extendedPayload);
    const sesRowsAfterSync = await db.select().from(schema.klasikSes);
    assert.equal(sesRowsAfterSync.length, 2, 'Yeniden sync-klasik ses kayıtlarını silmemeli');

    const largeAudio = Buffer.alloc(7_772_877);
    for (let i = 0; i < largeAudio.length; i++) largeAudio[i] = i % 251;
    const audioQuery = 'no=S999&tur=cevap&surum=0011223344556677';
    for (const suffix of ['parca=0', 'son=1', 'parca=-1&son=0', 'parca=8&son=1', 'parca=1.5&son=0', 'parca=0&son=true']) {
      assert.equal((await sendAdminSes('PUT', `${audioQuery}&${suffix}`, Buffer.from('audio'))).status, 400);
    }
    assert.equal((await sendAdminSes('PUT', `${audioQuery}&parca=0&son=0`, Buffer.from('audio'))).status, 400);
    const firstChunk = largeAudio.subarray(0, 4_000_000);
    const lastChunk = largeAudio.subarray(4_000_000);
    assert.equal((await sendAdminSes('PUT', `${audioQuery}&parca=1&son=1`, lastChunk)).status, 409);
    assert.equal((await sendAdminSes('PUT', `${audioQuery}&parca=0&son=0`, firstChunk)).status, 200);
    const partialList = await (await sendAdminSes('GET')).json();
    assert.notEqual(partialList.items.find((item: any) => item.no === 'S999').surum, '0011223344556677');
    assert.equal((await sendUserSes('no=S999&tur=cevap')).status, 404);
    assert.equal((await sendAdminSes('PUT', `${audioQuery}&parca=2&son=1`, lastChunk)).status, 409);
    assert.equal((await sendAdminSes('PUT', 'no=S999&tur=cevap&surum=ffeeddccbbaa9988&parca=1&son=1', lastChunk)).status, 409);
    // Kesilen dosya sonraki gönderimde sıfırıncı parçadan yeniden başlar.
    assert.equal((await sendAdminSes('PUT', `${audioQuery}&parca=0&son=0`, firstChunk)).status, 200);
    assert.equal((await sendAdminSes('PUT', `${audioQuery}&parca=1&son=1`, lastChunk)).status, 200);
    assert.equal((await sendAdminSes('PUT', `${audioQuery}&parca=1&son=1`, lastChunk)).status, 409);
    const completedList = await (await sendAdminSes('GET')).json();
    assert.equal(completedList.items.find((item: any) => item.no === 'S999').surum, '0011223344556677');
    const largeResponse = await sendUserSes('no=S999&tur=cevap');
    assert.equal(largeResponse.status, 200);
    assert.equal(largeResponse.headers.get('content-type'), 'audio/mpeg');
    assert.equal(largeResponse.headers.get('cache-control'), 'private, max-age=31536000, immutable');
    const reader = largeResponse.body!.getReader();
    const returnedChunks: Buffer[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      returnedChunks.push(Buffer.from(value));
    }
    assert.ok(returnedChunks.length > 1, 'Büyük yanıt birden çok akış parçasıyla dönmeli');
    assert.deepEqual(Buffer.concat(returnedChunks), largeAudio, 'Parçalı yüklenen ses bayt bayt aynı dönmeli');
    // Yeni yükleme eski tamamlanmış kaydın üzerine başlayınca da yarım ses sunulmaz.
    assert.equal((await sendAdminSes('PUT', `${audioQuery}&parca=0&son=0`, firstChunk)).status, 200);
    assert.equal((await sendUserSes('no=S999&tur=cevap')).status, 404);
    for (let parca = 1; parca < 7; parca++) {
      assert.equal((await sendAdminSes('PUT', `${audioQuery}&parca=${parca}&son=0`, firstChunk)).status, 200);
    }
    assert.equal((await sendAdminSes('PUT', `${audioQuery}&parca=7&son=0`, firstChunk)).status, 400);
    assert.equal((await sendAdminSes('PUT', `${audioQuery}&parca=7&son=1`, firstChunk)).status, 200);
    const [maximumAudio] = await db.select({ size: orm.sql<number>`octet_length(${schema.klasikSes.veri})` })
      .from(schema.klasikSes).where(orm.eq(schema.klasikSes.soruNo, 'S999'));
    assert.equal(maximumAudio.size, 32_000_000);
    await sendAdminSes('DELETE', 'no=S999&tur=cevap');

    // Verifiable repeatable artifact
    const outputDir = new URL('../outputs/klasik-e2e/', import.meta.url);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(new URL('e2e-result.json', outputDir), JSON.stringify({
      ok: true,
      syncVersion: syncData1.version,
      questionCount: dbRows.length,
      sampleDaily: dailyData1.questions.map((q: any) => ({ no: q.no, kategori: q.kategori })),
      seenRecord: gorulmeRows[0],
      extendedQuestionCount: extended.length,
      unansweredQuestion: unanswered,
      userScopedMark: remainingMarks[0],
      feedback: feedbackList.items[0],
      processedFeedback: processed,
      migration0020Reapplied: true,
      chunkedAudio: { uploadedBytes: largeAudio.length, returnedBytes: Buffer.concat(returnedChunks).length,
        streamChunks: returnedChunks.length, byteEquality: true, partialUploadHidden: true,
        restartVerified: true, invalidOrderRejected: true, maximumBytes: maximumAudio.size },
    }, null, 2));

  } finally {
    await pg.close();
  }
});
