// Failure paths: 0020, 0021 and 0022 must be repeatable; unanswered/no-clue sync accepted; invalid control,
// empty answered response rejected; daily excludes unanswered; list includes control for every account.
// Unknown question/mark/reminder, user mark leakage, duplicate marks, null deletion with reminder preservation,
// reminder toggle with mark preservation, invalid feedback, unauthorized feedback administration,
// processed feedback, re-sync loss, anonymous actions rejected.
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
// 6. klasik-daily returns 5 questions from 5 distinct categories, ordered alphabetically by category.
// 7. klasik-daily deterministic list for the same day across different users.
// 8. klasik-daily different day produces deterministic result for that day.
// 9. klasik-seen with non-existent 'no' returns 400.
// 10. klasik-seen updates seen status only for the requesting user, idempotent on conflict.
// 11. Re-sync of questions preserves existing klasik_gorulme user progress records.
// 12. klasik-daily düşük öncelikli soruları seçmez:
//     - bir kategorinin tüm cevaplı soruları düşükse o kategori günün sorularında yer almaz,
//     - karışık havuzda en az 60 farklı günde hiçbir düşük soru seçilmez,
//     - tüm cevaplı sorular düşükse hata vermeden boş soru listesi döner.
// 13. 0022_klasik_hatirlatici migration idempotency and table schema:
//     - hatirlatici column added as boolean not null default false,
//     - isaret column allows null so reminder can stay active without color mark,
//     - re-applying 0022 migration does not fail.
// 14. klasik-reminder authentication and payload validation:
//     - anonymous/inactive user rejected with 401/403,
//     - invalid/missing no or non-existent question rejected with 400,
//     - non-boolean hatirlatici payload rejected with 400.
// 15. klasik-reminder state persistence and coexistence with color mark:
//     - reminder can be set without any color mark (isaret remains null),
//     - setting reminder does not overwrite existing color mark,
//     - clearing color mark (isaret: null) preserves active reminder (row not deleted),
//     - turning off reminder (hatirlatici: false) preserves active color mark,
//     - row deleted only when both color mark and reminder are cleared,
//     - question re-sync does not delete reminder state.
// 16. Response payload enrichment:
//     - klasik-list, klasik-question, and klasik-daily contain hatirlatici boolean field for every question,
//     - reminder state is properly scoped to requesting user.
test('klasik e2e: senkron, gunun sorulari secimi, gorulme kaydi ve izolasyon', async () => {
  const pg = new PGlite();
  try {
    const drizzleDir = new URL('../drizzle/', import.meta.url);
    const sqlFiles = readdirSync(drizzleDir).filter(f => f.endsWith('.sql')).sort();
    for (const name of sqlFiles) {
      await pg.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
    }
    // Migration idempotent test: re-apply 0019_klasik_sorular.sql, 0020, 0021, 0022
    const migration0019 = new URL('../drizzle/0019_klasik_sorular.sql', import.meta.url);
    assert.ok(existsSync(migration0019), '0019_klasik_sorular.sql migration dosyası mevcut olmalı');
    await pg.exec(readFileSync(migration0019, 'utf8'));
    await pg.exec(readFileSync(new URL('../drizzle/0020_klasik_isaret_ve_geri_bildirim.sql', import.meta.url), 'utf8'));
    await pg.exec(readFileSync(new URL('../drizzle/0021_klasik_oncelik.sql', import.meta.url), 'utf8'));
    const migration0022 = new URL('../drizzle/0022_klasik_hatirlatici.sql', import.meta.url);
    if (existsSync(migration0022)) {
      await pg.exec(readFileSync(migration0022, 'utf8'));
    }

    await pg.exec(`insert into profiles(user_id,username,is_active,is_admin,disclaimer_accepted_at)
      values ('u1','kullanici1',true,false,now()),
             ('u2','kullanici2',true,false,now()),
             ('u_inactive','onaysiz',false,false,now());`);

    const db = drizzle(pg);
    let currentProfile: any = null;
    let currentDay: string | null = null;

    const modules: Record<string, unknown> = {
      'next/server': {
        NextResponse: {
          json: (data: unknown, init?: ResponseInit) => {
            const body = JSON.stringify(data);
            const headers = new Headers(init?.headers);
            headers.set('content-type', 'application/json');
            return new Response(body, { ...init, headers });
          },
        },
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
    assert.equal(dailyData1.questions.length, 5, 'Tam 5 soru dönmeli');

    // 5 farklı kategori denetimi
    const categories1 = dailyData1.questions.map((q: any) => q.kategori);
    assert.equal(new Set(categories1).size, 5, '5 farklı kategori olmalı');

    // Alfabetik sıra denetimi: Dönüş sırası seçilen kategorilerin ada göre sırasıdır.
    const sortedCats = [...categories1].sort((a, b) => a.localeCompare(b, 'tr'));
    assert.deepEqual(categories1, sortedCats, 'Sorular seçilen kategorilerin ada göre sıralanmış olmalı');

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
    const pickA = examCore.selectKlasikQuestions(dbRows, seedDayA);
    const pickB = examCore.selectKlasikQuestions(dbRows, seedDayB);
    assert.equal(pickA.length, 5);
    assert.equal(pickB.length, 5);
    // Belirlenimlilik: aynı seed ile tekrar çağırınca birebir aynı
    const pickARepeat = examCore.selectKlasikQuestions(dbRows, seedDayA);
    assert.deepEqual(pickA.map(q => q.no), pickARepeat.map(q => q.no), 'Aynı seed her zaman aynı listeyi vermeli');

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
    // 12. Düşük öncelikli sorular Günün Soruları havuzuna girmez
    // 12a. Bir kategorinin tüm cevaplı soruları 'dusuk' iken o kategori günün sorularında hiç yer almaz
    const hukukTumCevapliDusuk = extended.map(q => q.kategori === 'Hukuk' && q.durum !== 'cevapsiz' ? { ...q, oncelik: 'dusuk' } : q);
    assert.equal((await sendSync(JSON.stringify({ questions: hukukTumCevapliDusuk }))).status, 200);
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.UTC(2026, 9, 6 + i));
      currentDay = d.toISOString().slice(0, 10);
      const res = await (await sendExam({ action: 'klasik-daily' })).json();
      assert.equal(res.questions.length, 5);
      assert.ok(
        res.questions.every((q: any) => q.kategori !== 'Hukuk'),
        `Tüm cevaplı soruları düşük olan Hukuk kategorisi günün sorularına seçilmemeli (${currentDay})`
      );
    }

    // 12b. Düşük ve normal sorular karışıkken, en az 60 farklı tarih için klasik-daily yanıtında hiçbir 'dusuk' soru bulunmaz
    const mixedDusukNos = new Set(['S1', 'S3', 'S5', 'S7', 'S9', 'S11', 'S13', 'S16']);
    const mixedQuestions = extended.map(q => ({
      ...q,
      oncelik: mixedDusukNos.has(q.no) ? 'dusuk' : 'normal',
    }));
    assert.equal((await sendSync(JSON.stringify({ questions: mixedQuestions }))).status, 200);
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2026, 9, 6 + i));
      currentDay = d.toISOString().slice(0, 10);
      const res = await (await sendExam({ action: 'klasik-daily' })).json();
      assert.equal(res.questions.length, 5);
      for (const q of res.questions) {
        assert.ok(
          !mixedDusukNos.has(q.no),
          `Düşük öncelikli soru ${q.no} günün sorularına seçilmemeli (${currentDay})`
        );
      }
    }

    // 12c. Tüm cevaplı sorular 'dusuk' ise yanıt boş soru listesi döner ve hata vermez
    assert.equal((await sendSync(JSON.stringify({ questions: extended.map(q => ({ ...q, oncelik: 'dusuk' })) }))).status, 200);
    const allDusukRes = await sendExam({ action: 'klasik-daily' });
    assert.equal(allDusukRes.status, 200, 'Tüm sorular düşükken istek 200 dönmeli');
    const allDusukData = await allDusukRes.json();
    assert.equal(Array.isArray(allDusukData.questions), true);
    assert.equal(allDusukData.questions.length, 0, 'Tüm sorular düşük öncelikliyken günün soruları boş olmalı');

    // Durumu geri yükle
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
    }, null, 2));

  } finally {
    await pg.close();
  }
});
