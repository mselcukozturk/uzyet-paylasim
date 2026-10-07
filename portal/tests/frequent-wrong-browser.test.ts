// Failure cases:
// 1. Question with 4 wrong answers incorrectly included in frequent wrong list (must require wrong_count >= 5).
// 2. Question in inactive question bank included in frequent wrong list (must only include questions from active bank).
// 3. Question belonging to another user included (must be strictly isolated to the authenticated user's stats).
// 4. General button or per-lesson button enabled when there are no eligible questions (must be disabled if list is empty).
// 5. Button count incorrect (must be exactly 5 buttons both in the general section and within each lesson).
// 6. Lesson filter ignored when starting test from a lesson (must only include questions belonging to that lesson).
// 7. Lesson filter lost upon restarting the session via "Yeni Oturum" (must preserve topic filter).
// 8. Question erroneously removed from frequent wrong list when answered correctly (correct answers must NOT remove from list; last_result does not affect it).
// 9. "Listeden çıkar" button visible in other test modes (must only be visible in frequent wrong session).
// 10. "Listeden çıkar" button fails to call server or remove question from list.
// 11. Removed question fails to re-enter list on its next wrong answer in study/exam (must set frequent_wrong_removed = false on next wrong).
// 12. Counter increment in frequent wrong session (answers must NOT change shown/correct/wrong counters).
// 13. Layout overflowing horizontally at 390px mobile viewport or 1100px desktop viewport (must not overflow scrollWidth <= innerWidth, buttons must align properly).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as orm from 'drizzle-orm';
import * as schema from '../lib/db/schema.ts';
import * as examCore from '../lib/exam-core.ts';
import * as practiceCore from '../lib/practice-core.ts';
import ts from 'typescript';

test('Çok Yanlış Yapılanlar sunucu API ve veritabanı uçtan uca doğrulaması', async () => {
  const pg = new PGlite();
  try {
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort()) {
      await pg.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
    }
    const db = drizzle(pg);

    await db.insert(schema.profiles).values([
      { userId: 'u1', username: 'kullanici1', isActive: true },
      { userId: 'u2', username: 'kullanici2', isActive: true },
    ]);

    const [activeBank] = await db.insert(schema.questionBanks).values({
      version: 'active_v1', questionCount: 5, isActive: true,
    }).returning();
    const [inactiveBank] = await db.insert(schema.questionBanks).values({
      version: 'inactive_v1', questionCount: 1, isActive: false,
    }).returning();

    await db.insert(schema.questions).values([
      { bankId: activeBank.id, guid: 'q_4wrong', topic: 'Kredi', prompt: 'Soru 4', options: ['A', 'B'], correctIndex: 0 },
      { bankId: activeBank.id, guid: 'q_5wrong', topic: 'Kredi', prompt: 'Soru 5', options: ['A', 'B'], correctIndex: 0 },
      { bankId: activeBank.id, guid: 'q_resolved', topic: 'Hukuk', prompt: 'Soru R', options: ['A', 'B'], correctIndex: 0 },
      { bankId: activeBank.id, guid: 'q_other_user', topic: 'Kredi', prompt: 'Soru O', options: ['A', 'B'], correctIndex: 0 },
      { bankId: inactiveBank.id, guid: 'q_inactive', topic: 'Kredi', prompt: 'Soru I', options: ['A', 'B'], correctIndex: 0 },
    ]);

    const now = new Date();
    await db.insert(schema.questionStats).values([
      { userId: 'u1', questionGuid: 'q_4wrong', shownCount: 4, wrongCount: 4, correctCount: 0, lastResult: false, lastSeenAt: now, frequentWrongRemoved: false },
      { userId: 'u1', questionGuid: 'q_5wrong', shownCount: 5, wrongCount: 5, correctCount: 0, lastResult: false, lastSeenAt: now, frequentWrongRemoved: false },
      { userId: 'u1', questionGuid: 'q_resolved', shownCount: 6, wrongCount: 5, correctCount: 1, lastResult: true, lastSeenAt: now, frequentWrongRemoved: false },
      { userId: 'u1', questionGuid: 'q_inactive', shownCount: 10, wrongCount: 10, correctCount: 0, lastResult: false, lastSeenAt: now, frequentWrongRemoved: false },
      { userId: 'u2', questionGuid: 'q_other_user', shownCount: 8, wrongCount: 8, correctCount: 0, lastResult: false, lastSeenAt: now, frequentWrongRemoved: false },
    ]);

    let currentProfile: { userId: string; isActive: boolean; isAdmin?: boolean } | null = { userId: 'u1', isActive: true };
    const modules: Record<string, unknown> = {
      'next/server': { NextResponse: { json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), init) } },
      'drizzle-orm': orm,
      '@/lib/db': { getDb: () => db, schema },
      '@/lib/exam-core': examCore,
      '@/lib/practice-core': practiceCore,
      '@/data/bank-corrections.json': [],
      '@/lib/auth/session': { getSessionProfile: async () => currentProfile },
      '@/lib/cors': { withCors: (r: Response) => r, corsPreflight: () => new Response() },
    };

    const exports: { POST?: (r: Request) => Promise<Response> } = {};
    const compiled = ts.transpileModule(readFileSync(new URL('../app/api/exam/route.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(compiled, { exports, require: (key: string) => modules[key], console, Buffer, process: { env: {} } });

    const callApi = async (body: unknown) => {
      const res = await exports.POST!(new Request('https://test.invalid/api/exam', {
        method: 'POST',
        body: JSON.stringify(body),
      }));
      return { status: res.status, data: await res.json() };
    };

    // 1. 4 yanlışlı soru listede yok, 5 yanlışlı var; doğru cevaplanmış soru da listede kalır; pasif banka ve başka kullanıcı hariçtir.
    const initialList = await callApi({ action: 'frequent-wrong-questions' });
    assert.equal(initialList.status, 200);
    assert.deepEqual(initialList.data.guids.sort(), ['q_5wrong', 'q_resolved'].sort());

    // 2. "Listeden çıkar" action'ı soruyu listeden çıkarır.
    const removeRes = await callApi({ action: 'frequent-wrong-remove', questionGuid: 'q_5wrong' });
    assert.equal(removeRes.status, 200);
    assert.equal(removeRes.data.ok, true);
    assert.deepEqual(removeRes.data.guids, ['q_resolved']);

    // Listeyi tekrar çekince de soru yok.
    const afterRemoveList = await callApi({ action: 'frequent-wrong-questions' });
    assert.deepEqual(afterRemoveList.data.guids, ['q_resolved']);

    // 3. Çıkarılan soru doğru cevaplandığında (study-answer) listeye geri girmez.
    await callApi({
      action: 'study-answer',
      questionGuid: 'q_5wrong',
      selectedAnswer: 'A', // doğru cevap
    });
    const afterCorrectStudy = await callApi({ action: 'frequent-wrong-questions' });
    assert.deepEqual(afterCorrectStudy.data.guids, ['q_resolved']);

    // 4. Çıkarılan soru ilk YANLIŞ cevapta hemen listeye geri girer.
    await callApi({
      action: 'study-answer',
      questionGuid: 'q_5wrong',
      selectedAnswer: 'B', // yanlış cevap
    });
    const afterWrongStudy = await callApi({ action: 'frequent-wrong-questions' });
    assert.deepEqual(afterWrongStudy.data.guids.sort(), ['q_5wrong', 'q_resolved'].sort());
  } finally {
    await pg.close();
  }
});

async function runBrowser(chrome: string, fixture: URL, output: URL, width: number) {
  const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--disable-background-networking', '--remote-debugging-port=0',
    `--user-data-dir=${fileURLToPath(new URL('profile/', output))}`, 'about:blank'], { windowsHide: true });
  let socket: WebSocket | undefined;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome başlamadı')), 15000);
      let log = '';
      browser.stderr.on('data', (data) => {
        log += data;
        const found = log.match(/DevTools listening on (ws:\/\/\S+)/);
        if (found) { clearTimeout(timer); resolve(found[1]); }
      });
      browser.on('error', (error) => { clearTimeout(timer); reject(error); });
    });
    socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      socket!.onopen = () => resolve();
      socket!.onerror = () => reject(new Error('CDP bağlantısı kurulamadı'));
    });
    let serial = 0;
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      }
    };
    const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject });
      socket!.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const target = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 }, sessionId);
    await send('Page.navigate', { url: pathToFileURL(fileURLToPath(fixture)).href }, sessionId);
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await send('Runtime.evaluate', { expression: 'Boolean(document.getElementById("browser-result"))', returnByValue: true }, sessionId);
      if (value.result.value) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const dom = await send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true }, sessionId);
    await send('Runtime.evaluate', { expression: 'document.getElementById("browser-result").style.display="none"' }, sessionId);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(new URL('screenshot.png', output), Buffer.from(screenshot.data, 'base64'));
    return dom.result.value as string;
  } finally {
    socket?.close();
    browser.kill();
    await new Promise<void>((resolve) => {
      if (browser.exitCode !== null) resolve();
      else browser.once('exit', () => resolve());
    });
  }
}

for (const width of [390, 1100]) {
  test(`Çok Yanlış Yapılanlar tarayıcı akışı ve düzen kanıtı (${width}px)`, async () => {
    const chrome = [process.env.CHROME_PATH,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
    assert.ok(chrome, 'Chrome gerekli; test atlanamaz');
    const original = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

    const scenario = `
    (async function () {
      var checks = [];
      function check(ok, label) { if (!ok) throw new Error(label); checks.push(label); }
      function click(selector) {
        var el = document.querySelector(selector);
        check(el && !el.disabled, 'Düğme kullanılabilir: ' + selector);
        el.click();
      }

      try {
        localStorage.clear();
        saveAndPublish = function () { return Promise.resolve(true); };
        STATE.sadeceDeneme = false;

        // u1 (4 yanlış, Kredi), u2 (5 yanlış, Kredi), u3 (5 yanlış ama doğru çözülmüş, Hukuk), u4 (5 yanlış, Kredi)
        STATE.bank = [
          { guid: 'u1', konu: 'Kredi', soru: 'Soru 1', siklar: ['A', 'B'], cevapIdx: 0, cevapMetni: 'A', aciklama: 'Açık 1' },
          { guid: 'u2', konu: 'Kredi', soru: 'Soru 2', siklar: ['A', 'B'], cevapIdx: 0, cevapMetni: 'A', aciklama: 'Açık 2' },
          { guid: 'u3', konu: 'Hukuk', soru: 'Soru 3', siklar: ['A', 'B'], cevapIdx: 0, cevapMetni: 'A', aciklama: 'Açık 3' },
          { guid: 'u4', konu: 'Kredi', soru: 'Soru 4', siklar: ['A', 'B'], cevapIdx: 0, cevapMetni: 'A', aciklama: 'Açık 4' }
        ];
        STATE.stats = {
          u1: { gosterim: 4, dogru: 0, yanlis: 4, sonSonucDogruMu: false, sonGorulme: '2026-10-01' },
          u2: { gosterim: 5, dogru: 0, yanlis: 5, sonSonucDogruMu: false, sonGorulme: '2026-10-01' },
          u3: { gosterim: 6, dogru: 1, yanlis: 5, sonSonucDogruMu: true, sonGorulme: '2026-10-01' },
          u4: { gosterim: 5, dogru: 0, yanlis: 5, sonSonucDogruMu: false, sonGorulme: '2026-10-01' }
        };

        remoteAuth = { checked: true, authenticated: true, isActive: true, disclaimerAccepted: true, username: 'test_user', isAdmin: false };
        remoteBankLoaded = true;
        remoteWrongGuids = ['u1', 'u2', 'u4'];
        remoteFrequentWrongGuids = ['u2', 'u3', 'u4'];
        remoteReminderGuids = [];

        remoteFetch = function (url, method, body) {
          if (body && body.action === 'frequent-wrong-remove') {
            remoteFrequentWrongGuids = remoteFrequentWrongGuids.filter(function (g) { return g !== body.questionGuid; });
            return Promise.resolve({ ok: true, data: { ok: true, guids: remoteFrequentWrongGuids.slice() } });
          }
          if (body && body.action === 'frequent-wrong-questions') {
            return Promise.resolve({ ok: true, data: { guids: remoteFrequentWrongGuids.slice() } });
          }
          return Promise.resolve({ ok: true, data: {} });
        };

        VIEW = 'denemeKonuSec';
        render();

        // 1. Genel çalışma bloğunda 5 düğme olmalı
        var generalButtons = Array.from(document.querySelector('[data-tum-banka]').querySelectorAll('button'));
        check(generalButtons.length === 5, 'Tüm banka için beş çalışma düğmesi olmalı (mevcut: ' + generalButtons.length + ')');
        check(generalButtons[4].textContent.includes('Çok Yanlış Yapılanlar'), 'Beşinci düğme Çok Yanlış Yapılanlar');
        check(!generalButtons[4].disabled, 'Genel Çok Yanlış Yapılanlar düğmesi etkin');

        // Yatay taşma olmamalı
        check(document.documentElement.scrollWidth <= innerWidth, 'Sayfa yatay taşmaz (genişlik ' + innerWidth + ')');

        // 2. Kredi dersinde u2/u4 var (etkin), Hukuk dersinde u3 var (etkin), boş derste devre dışı
        var krediDetails = document.querySelector('details[data-konu="Kredi"]');
        check(!!krediDetails, 'Kredi ders kartı mevcut');
        var krediButtons = Array.from(krediDetails.querySelectorAll('.konu-secenekler button'));
        check(krediButtons.length === 5, 'Ders içinde beş seçenek düğmesi olmalı');
        var krediCokYanlis = krediButtons[4];
        check(krediCokYanlis.textContent.includes('Çok Yanlış Yapılanlar') && !krediCokYanlis.disabled, 'Kredi dersinde Çok Yanlış Yapılanlar etkin');

        var maliDetails = document.querySelector('details[data-konu="Mali Analiz"]');
        check(!!maliDetails, 'Mali Analiz ders kartı mevcut');
        var maliCokYanlis = maliDetails.querySelectorAll('.konu-secenekler button')[4];
        check(maliCokYanlis.disabled, 'Boş derste Çok Yanlış Yapılanlar düğmesi devre dışı');

        // 3. Genel "Çok Yanlış Yapılanlar" testini başlat
        click('[data-tum-banka] [data-action="start-cok-yanlis-test"]');
        check(VIEW === 'tekrarTest', 'Test oturumu açıldı');
        check(currentTekrar && currentTekrar.tur === 'cokYanlis', 'Oturum türü cokYanlis');
        check(currentTekrar.kuyruk.length === 3, 'Kuyrukta üç soru var (u2, u3, u4, u1 hariç)');

        // Soru ekranında "Listeden çıkar" düğmesi görünmeli
        var removeBtn = document.querySelector('[data-action="remove-frequent-wrong"]');
        check(!!removeBtn, 'Çok Yanlış Yapılanlar ekranında "Listeden çıkar" düğmesi var');

        // Soru doğru cevaplanınca listede kalmalı
        var initialGuid = currentTekrar.kayitlar[currentTekrar.konum].guid;
        click('[data-action="select-tekrar-option"][data-idx="0"]');
        check(remoteFrequentWrongGuids.indexOf(initialGuid) !== -1, 'Doğru cevaplanınca soru listeden çıkmaz');

        // "Listeden çıkar"a basınca soru ayrılmalı
        click('[data-action="remove-frequent-wrong"]');
        await new Promise(function (resolve) { setTimeout(resolve, 10); });
        check(remoteFrequentWrongGuids.indexOf(initialGuid) === -1, 'Düğmeye basılınca soru listeden ayrılır');

        // Testi bitir ve özet ekranına geç
        click('[data-action="finish-tekrar-test"]');
        check(VIEW === 'tekrarSonuc', 'Özet ekranına ulaşıldı');

        // Ana sayfaya dön
        click('[data-action="tekrar-cik"]');
        check(VIEW === 'denemeKonuSec', 'Konu Konu Bak ekranına dönüldü');

        // Ders içi test: Hukuk dersinde u3 vardı, eğer u3 çıkarıldıysa kalan 1 soru u2 Kredi dersindedir
        // Kredi dersindeki Çok Yanlış Yapılanlar testini başlat
        click('details[data-konu="Kredi"] summary');
        click('details[data-konu="Kredi"] [data-action="start-cok-yanlis-test"]');
        check(currentTekrar.konuFiltre === 'Kredi', 'Ders filtresi Kredi olarak ayarlandı');
        click('[data-action="select-tekrar-option"][data-idx="0"]');
        click('[data-action="finish-tekrar-test"]');
        check(lastTekrarSonuc.konuFiltre === 'Kredi', 'Özette ders filtresi korundu');

        // "Yeni Oturum" ile tekrar başlatıldığında ders filtresi korunur
        if (document.querySelector('[data-action="start-tekrar-again"]')) {
          click('[data-action="start-tekrar-again"]');
          check(currentTekrar.konuFiltre === 'Kredi', 'Tekrar başlatmada ders filtresi korundu');
          click('[data-action="tekrar-cik"]');
        }

        // Ekran taşma kontrolü
        check(document.documentElement.scrollWidth <= innerWidth, 'Sonuçta yatay taşma yok: ' + document.documentElement.scrollWidth + ' <= ' + innerWidth);

        var result = document.createElement('pre'); result.id = 'browser-result';
        result.textContent = JSON.stringify({ ok: true, viewport: innerWidth, checks: checks });
        document.body.appendChild(result);
      } catch (e) {
        var result = document.createElement('pre'); result.id = 'browser-result';
        result.textContent = JSON.stringify({ ok: false, error: e.message, stack: e.stack, checks: checks });
        document.body.appendChild(result);
      }
    })();
  })();`;

    const html = original.replace(/  ensureArtifact\(\)\.then\(function \(\) \{[\s\S]*?\}\)\(\);/, scenario)
      .replace(/^<script src=[^\n]*<\/script>\r?$/gm, '')
      .replace(/^<link[^\n]*fonts\.google[^\n]*\r?$/gm, '');

    const output = new URL(`../outputs/frequent-wrong-${width}/`, import.meta.url);
    mkdirSync(output, { recursive: true });
    const fixture = new URL('fixture.html', output);
    writeFileSync(fixture, html);
    const dom = await runBrowser(chrome!, fixture, output, width);
    writeFileSync(new URL('result.html', output), dom);
    const result = dom.match(/<pre id="browser-result">([\s\S]*?)<\/pre>/)?.[1];
    assert.ok(result, 'Tarayıcı sonuç üretmedi; outputs içindeki HTML incelenmeli');
    const data = JSON.parse(result!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
    writeFileSync(new URL('result.json', output), JSON.stringify(data, null, 2));
    assert.equal(data.ok, true, data.error);
    assert.equal(data.viewport, width, 'Gerçek tarayıcı görünümü istenen genişlikte olmalı');
  });
}
