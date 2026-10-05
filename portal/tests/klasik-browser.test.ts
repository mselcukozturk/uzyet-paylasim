// Failure paths: topic/control cards, collapsed categories and counters, study navigation/back,
// mark persistence/removal/rollback, reminder toggle/persistence/rollback, unanswered/no-clue rendering,
// freshness note, feedback empty/submission/error preservation, control grouping for every account,
// empty daily card, reset, standard top bar on all sub-screens, search input isolation to topic view,
// Turkish uppercase/multi-word search matching, empty search notice, category restoration on clear,
// search result study navigation, focus preservation across consecutive typing, mobile overflow,
// mark and reminder filter boxes isolation to topic view, mark and reminder count reflection,
// box toggle and category restoration, empty mark/reminder notice, combined search, mark and reminder filtering,
// study navigation within filtered list with live mark/reminder updates, low-priority question exclusion from
// topic view category groups, counters, search results, and filter boxes while preserving them in low-priority view,
// two-row study action button arrangement with clue/answer on row 1 and marks/reminder/feedback on row 2,
// category single card framing without nested borders, tabular aligned counters, and Turkish title case category formatting.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

async function runBrowser(chrome: string, fixture: URL, output: URL, width: number) {
  const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--disable-background-networking', '--remote-debugging-port=0',
    `--user-data-dir=${fileURLToPath(new URL('profile/', output))}`, 'about:blank'], { windowsHide: true });
  let socket: WebSocket | undefined;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome başlamadı')), 15000);
      let log = '';
      browser.stderr.on('data', data => {
        log += data;
        const found = log.match(/DevTools listening on (ws:\/\/\S+)/);
        if (found) { clearTimeout(timer); resolve(found[1]); }
      });
      browser.on('error', error => { clearTimeout(timer); reject(error); });
    });
    socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      socket!.onopen = () => resolve();
      socket!.onerror = () => reject(new Error('CDP bağlantısı kurulamadı'));
    });
    let serial = 0;
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    socket.onmessage = event => {
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
    await send('Network.enable', {}, sessionId);
    await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, sessionId);
    await send('Page.navigate', { url: pathToFileURL(fileURLToPath(fixture)).href }, sessionId);
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await send('Runtime.evaluate', { expression: 'Boolean(document.getElementById("browser-result"))', returnByValue: true }, sessionId);
      if (value.result.value) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const dom = await send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true }, sessionId);
    await send('Runtime.evaluate', { expression: 'document.getElementById("browser-result").style.display="none"' }, sessionId);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(new URL('screenshot.png', output), Buffer.from(screenshot.data, 'base64'));
    writeFileSync(new URL('dusuk-oncelik.png', output), Buffer.from(screenshot.data, 'base64'));

    await send('Runtime.evaluate', { expression: 'if (window.__showKonuArama) window.__showKonuArama(); document.getElementById("browser-result").style.display="none";' }, sessionId);
    const ssKonu = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(new URL('konu-arama.png', output), Buffer.from(ssKonu.data, 'base64'));

    await send('Runtime.evaluate', { expression: 'if (window.__showIsaretKutulari) window.__showIsaretKutulari(); document.getElementById("browser-result").style.display="none";' }, sessionId);
    const ssIsaret = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(new URL('isaret-kutulari.png', output), Buffer.from(ssIsaret.data, 'base64'));

    await send('Runtime.evaluate', { expression: 'if (window.__showSoruUstBar) window.__showSoruUstBar(); document.getElementById("browser-result").style.display="none";' }, sessionId);
    const ssSoru = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(new URL('soru-ust-bar.png', output), Buffer.from(ssSoru.data, 'base64'));

    await send('Runtime.evaluate', { expression: 'if (window.__showGrupAcik) window.__showGrupAcik(); document.getElementById("browser-result").style.display="none";' }, sessionId);
    const ssGrup = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(new URL('grup-acik.png', output), Buffer.from(ssGrup.data, 'base64'));

    await send('Runtime.evaluate', { expression: 'if (window.__showSoruDugmeler) window.__showSoruDugmeler(); document.getElementById("browser-result").style.display="none";' }, sessionId);
    const ssDugme = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(new URL('soru-dugmeler.png', output), Buffer.from(ssDugme.data, 'base64'));

    return dom.result.value as string;
  } finally {
    socket?.close();
    browser.kill();
    await new Promise<void>(resolve => { if (browser.exitCode !== null) resolve(); else browser.once('exit', () => resolve()); });
  }
}

// Failure cases covered:
// 1. Missing Klasik tab in main navigation or improper ARIA roles.
// 2. Failure to load or render Günün Klasik Soruları daily card.
// 3. "Başla" button not starting single-question study view.
// 4. Clue button reveals not showing items sequentially or wrong counter format (X / N).
// 5. Clue button not disabled after all clues are displayed.
// 6. "Cevabı göster" button not replacing itself with structured answer (baslik, paragraf, madde, tablo).
// 7. Missing or duplicate "klasik-seen" API network request when revealing answer.
// 8. In-memory state loss (revealed clues, visible answer) when navigating between questions with Prev/Next buttons.
// 9. Missing warning notice for incomplete questions (durum === 'kismi').
// 10. Daily card not reflecting updated seen count ("1 / 5 cevap görüldü") upon returning to tab.
// 11. Horizontal layout overflow in 390px mobile viewport or 1100px desktop viewport.
// 12. Standard top bar (home, history, logout buttons and username) missing or back button not integrated inside top bar in "Konu konu bak", "Soru Kontrolü", "Düşük Öncelikli", or question screens.
// 13. Search input appearing on screens other than "Konu konu bak" (e.g. Soru Kontrolü, Düşük Öncelikli, question view).
// 14. Turkish uppercase search (e.g. "İHRACAT") not matching lowercase question text, or multi-word search matching questions lacking any of the words.
// 15. "Eşleşen soru yok." missing when search produces zero matches, or category groups failing to reappear when search input is cleared.
// 16. Question opened from search result navigating outside search result set or losing search text on return.
// 17. Search input losing focus or dropping characters upon consecutive typing.
// 18. Mark filter boxes ("Öğrendim", "Tekrar bak", "Anlamadım") appearing on screens other than "Konu konu bak" (e.g. Soru Kontrolü, Düşük Öncelikli, question view).
// 19. Mark filter box counters not matching current counts of questions carrying each mark.
// 20. Clicking a mark filter box failing to list only questions with that mark, failing to restore category groups on second click, or failing to switch list on clicking another box.
// 21. "Bu işaretle soru yok." missing when a mark filter box with zero questions is selected.
// 22. Combined search and mark filter failing to list only questions matching both criteria.
// 23. Question opened from mark-filtered list navigating outside the filtered list, or returning from study view with outdated counts and list after mark change.
// 24. Low-priority questions leaking into "Konu konu bak" category groups, inflating category question counts or mark tallies, or rendering question rows.
// 25. Low-priority questions appearing in "Konu konu bak" search results instead of showing "Eşleşen soru yok.".
// 26. Marked low-priority questions inflating "Konu konu bak" mark filter box counts or appearing in mark filter lists, or failing to appear with their marks in the "Düşük Öncelikli" screen.
// 27. Soru ekranında "🔖 Hatırlatıcı" düğmesi (data-action="klasik-hatirlatici", aria-pressed) eksik, tıklamada iyimser güncelleme yapmıyor veya ağ hatasında önceki duruma geri almıyor.
// 28. Hatırlatıcılı sorunun liste satırında (klasikSatir) soru no yanında 🔖 (aria-label="Hatırlatıcı") görünmüyor.
// 29. Konu Konu Bak ekranında dördüncü filtre kutusu "🔖 Hatırlatıcı · N" (data-action="klasik-filtre-hatirlatici", aria-pressed) eksik, sayısı yanlış, renk ve aramayla VE mantığında daraltmıyor veya düşük öncelikli soruları dahil ediyor.
// 30. Soru ekranı düğme düzeni (renderKlasikCalisma): Satır 1 solda ipucu, sağda Cevabı göster; ipucu yokken sağda Cevabı göster; cevap açılınca Cevabı göster butonu yerine cevap; Satır 2 solda 3 renkli düğme, sağda Hatırlatıcı ve Cevap güncellenmeli; geri bildirim açılınca Satır 2'nin altında tam genişlikte.
// 31. Liste ekranı grupları (renderKlasikListe): dış kart kalırken başlık düğmesinin iç çerçevesi ve arka planı kalkmıyor, açık/kapalı ok simgesi (▸ / ▾) eksik, sayaçlar eşit aralıklı / tabular-nums / sağa dayalı değil, "N soru" sayaçlardan önce sağda değil, kategori adları Türkçe kurallı başlık düzeninde (klasikBaslikDuzeni, 've' küçük) gösterilmiyor, açılan grubun satırları sol dikey kılavuz çizgisi ve girintiyle vurgulanmıyor, açık grup kartı accent kenarlık almıyor.
// 32. 390px ve 1100px görünümünde grup-acik.png ve soru-dugmeler.png ekran görüntülerinin üretilmemesi.
// 33. 390 px'te satır 2'nin beş düğmesinin tek satırda olmaması, ortalanmaması, karttan taşması; Hatırlatıcı/Cevap güncellenmeli yazısının telefonda görünmesi veya 🔖/✏️ simgesinin görünmemesi; 1100 px'te yazıların görünmemesi, ✏️ simgesinin görünmesi veya sol/sağ düzenin bozulması.
for (const width of [390, 1100]) test(`Klasik tarayıcı akışı (${width}px)`, async () => {
  const chrome = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find(p => p && existsSync(p));
  assert.ok(chrome, 'Chrome gerekli; test atlanamaz');
  const original = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  const scenario = `
  (async function () {
    var checks = [], layoutMeasurements = [];
    function measureLayout(label) {
      var scrollWidth = document.documentElement.scrollWidth;
      layoutMeasurements.push({ screen: label, viewport: innerWidth, scrollWidth: scrollWidth });
      check(scrollWidth <= innerWidth, 'No horizontal overflow: ' + label);
    }
    function check(ok, label) { if (!ok) throw new Error(label); checks.push(label); }
    function click(selector) {
      var el = document.querySelector(selector);
      check(el && !el.disabled, 'Düğme kullanılabilir: ' + selector);
      el.click();
    }

    try {
      localStorage.clear();
      saveAndPublish = function () { return Promise.resolve(true); };
      STATE.sadeceDeneme = true;
      remoteAuth = { checked: true, authenticated: true, isActive: true, disclaimerAccepted: true, username: 'klasik_user', isAdmin: false };

      function checkUstBar(geriAction, geriTitle) {
        var bar = document.querySelector('.ust-bar');
        check(bar, 'Üst çubuk bulunmalı: ' + geriTitle);
        check(bar.querySelector('[data-action="go-home"]'), 'Ana sayfa düğmesi bulunmalı: ' + geriTitle);
        check(bar.querySelector('[data-action="open-history-remote"]'), 'Geçmiş düğmesi bulunmalı: ' + geriTitle);
        check(bar.querySelector('[data-action="deneme-cikis-yap"]'), 'Çıkış düğmesi bulunmalı: ' + geriTitle);
        check(bar.textContent.includes('klasik_user'), 'Kullanıcı adı görünmeli: ' + geriTitle);
        var geriBtn = bar.querySelector('[data-action="' + geriAction + '"]');
        check(geriBtn, 'Geri düğmesi üst çubukta bulunmalı: ' + geriAction + ' (' + geriTitle + ')');
        check(geriBtn.textContent.includes('⬅️'), 'Geri düğmesi simgesi ⬅️ olmalı: ' + geriTitle);
        check(geriBtn.getAttribute('title') === geriTitle, 'Geri düğmesi title ' + geriTitle + ' olmalı: ' + (geriBtn && geriBtn.getAttribute('title')));
        check(geriBtn.getAttribute('aria-label') === geriTitle, 'Geri düğmesi aria-label ' + geriTitle + ' olmalı: ' + (geriBtn && geriBtn.getAttribute('aria-label')));
      }

      var mockDailyQuestions = [
        {
          no: 'S1',
          kategori: 'Hukuk',
          soru: 'Ticaret Kanununa göre şirket türleri nelerdir?',
          durum: 'tam',
          cevap: [
            { tur: 'baslik', metin: 'Şirket Türleri' },
            { tur: 'paragraf', metin: 'TTK uyarınca ticaret şirketleri şunlardır:' },
            { tur: 'madde', metin: 'Anonim şirket' },
            { tur: 'madde', metin: 'Limited şirket' },
            { tur: 'madde', metin: 'Kolektif şirket' },
            { tur: 'tablo', satirlar: [['Tür', 'Asgari Sermaye'], ['A.Ş.', '250.000 TL'], ['Ltd. Şti.', '50.000 TL']] }
          ],
          ipuclari: ['Şahıs ve sermaye şirketleri ayrımını düşün.', 'Sermaye şirketlerinden en yaygın üçünü hatırla.'],
          seen: false
        },
        {
          no: 'S2',
          kategori: 'Kredi',
          soru: 'Kredi tahsis sürecinde dikkat edilmesi gereken temel ilkeler nelerdir?',
          durum: 'kismi',
          cevap: [
            { tur: 'paragraf', metin: 'Temel kredi analiz ilkeleri şunlardır:' },
            { tur: 'madde', metin: 'Karakter ve ahlaki durum' },
            { tur: 'madde', metin: 'Kapasite ve nakit akışı' }
          ],
          ipuclari: ['5C kuralını hatırla.', 'Nakit akışının önemini göz önünde bulundur.'],
          seen: false
        },
        {
          no: 'S3',
          kategori: 'Muhasebe',
          soru: 'Bilanço ve gelir tablosu arasındaki temel farklar nelerdir?',
          durum: 'tam',
          cevap: [{ tur: 'paragraf', metin: 'Bilanço belli bir andaki finansal durumu, gelir tablosu ise belli bir dönemin faaliyet sonucunu gösterir.' }],
          ipuclari: ['Stok ve akım kavramlarını düşün.'],
          seen: false
        },
        {
          no: 'S4',
          kategori: 'Ekonomi',
          soru: 'Enflasyon türleri ve nedenleri nelerdir?',
          durum: 'tam',
          cevap: [{ tur: 'paragraf', metin: 'Talep enflasyonu ve maliyet enflasyonu temel türlerdir.' }],
          ipuclari: ['Arz ve talep dengesini hatırla.'],
          seen: false
        },
        {
          no: 'S5',
          kategori: 'Bankacılık',
          soru: 'Mevduat türleri nelerdir?',
          durum: 'tam',
          cevap: [{ tur: 'paragraf', metin: 'Vadesiz, vadeli ve ihbarlı mevduat.' }],
          ipuclari: ['Vade yapısını düşün.'],
          seen: false
        }
      ];

      mockDailyQuestions.forEach(function(q) { q.konu = q.soru; q.isaret = null; q.hatirlatici = false; q.kontrol = 'edilecek'; q.guncellikNotu = ''; q.oncelik = 'normal'; });
      mockDailyQuestions[0].kontrol = 'edildi';
      var allQuestions = mockDailyQuestions.concat([
        { no: 'S6', kategori: 'Hukuk', konu: 'Cevapsız konu', soru: 'Cevapsız soru', durum: 'cevapsiz', kontrol: 'edilecek', guncellikNotu: 'Şimdilik güncel değil', cevap: [], ipuclari: [], seen: false, isaret: null, hatirlatici: false, oncelik: 'normal' },
        { no: 'S7', kategori: 'Hukuk', konu: 'Düşük öncelikli Hukuk 1', soru: 'Düşük soru 1', durum: 'tam', kontrol: 'edildi', guncellikNotu: '', cevap: [{ tur: 'paragraf', metin: 'Düşük cevap 1' }], ipuclari: [], seen: false, isaret: null, hatirlatici: false, oncelik: 'dusuk' },
        { no: 'S8', kategori: 'Hukuk', konu: 'Düşük öncelikli Hukuk 2', soru: 'Düşük soru 2', durum: 'tam', kontrol: 'edilecek', guncellikNotu: '', cevap: [{ tur: 'paragraf', metin: 'Düşük cevap 2' }], ipuclari: [], seen: false, isaret: null, hatirlatici: false, oncelik: 'dusuk' },
        { no: 'S9', kategori: 'Kambiyo', konu: 'İhracat rejim kararı', soru: 'ihracat işlemlerinde kullanılan gümrük beyannamesi şartları nelerdir?', durum: 'tam', kontrol: 'edildi', guncellikNotu: '', cevap: [{ tur: 'paragraf', metin: 'İhracat belgeleri' }], ipuclari: [], seen: false, isaret: null, hatirlatici: false, oncelik: 'normal' },
        { no: 'S10', kategori: 'Kredi', konu: 'İhracat kredi limitleri', soru: 'ihracat reeskont kredisi teminat şartları nelerdir?', durum: 'tam', kontrol: 'edildi', guncellikNotu: '', cevap: [{ tur: 'paragraf', metin: 'Reeskont kredisi' }], ipuclari: [], seen: false, isaret: null, hatirlatici: false, oncelik: 'normal' }
      ]);
      mockDailyQuestions[1].guncellikNotu = 'Güncellenecek bilgi';
      var feedbackRequests = [], markFailure = false, feedbackFailure = false, reminderFailure = false;
      var seenRequests = [];
      remoteFetch = function (path, method, body) {
        if (body.action === 'klasik-daily') {
          return Promise.resolve({
            ok: true,
            data: { day: '2026-10-05', questions: mockDailyQuestions }
          });
        }
        if (body.action === 'klasik-list') return Promise.resolve({ ok: true, data: { questions: allQuestions } });
        if (body.action === 'klasik-question') return Promise.resolve({ ok: true, data: Object.assign({}, allQuestions.find(q => q.no === body.no)) });
        if (body.action === 'klasik-mark') return Promise.resolve({ ok: !markFailure, data: {} });
        if (body.action === 'klasik-reminder') return Promise.resolve({ ok: !reminderFailure, data: {} });
        if (body.action === 'klasik-feedback') { feedbackRequests.push(body); return Promise.resolve({ ok: !feedbackFailure, data: {} }); }
        if (body.action === 'klasik-seen') {
          seenRequests.push(body.no);
          return Promise.resolve({ ok: true, data: { ok: true } });
        }
        return Promise.resolve({ ok: true, data: {} });
      };

      VIEW = 'menuDeneme';
      render();

      // 1. Ana sayfada 3 sekme kontrolü
      var homeTabs = document.querySelector('[role="tablist"][aria-label="Ana sayfa bölümleri"]');
      check(homeTabs && homeTabs.querySelectorAll('[role="tab"]').length === 3, 'Ana sayfada 3 sekme bulunmalı');
      var klasikTab = homeTabs.querySelector('[data-action="open-klasik"]');
      check(!!klasikTab, 'Klasik sekmesi butonu bulunmalı');

      // 2. Klasik sekmesine geç
      click('[data-action="open-klasik"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(VIEW === 'klasik', 'Görünüm klasik sekmesi olmalı');
      check(document.querySelector('[data-action="open-klasik"][aria-selected="true"]'), 'Klasik sekmesi seçili olmalı');

      // Başlık ve kart kontrolü
      var titleEl = document.querySelector('.section-title');
      check(titleEl && titleEl.textContent.includes('Klasik Sorular'), '✍️ Klasik Sorular başlığı görünmeli');
      var cardEl = document.querySelector('.card');
      check(cardEl && cardEl.textContent.includes('Günün Klasik Soruları'), 'Günün Klasik Soruları kartı görünmeli');
      check(cardEl.textContent.includes('5 soru · süre yok · cevabını kâğıda yaz, sonra karşılaştır'), 'Açıklama metni görünmeli');
      check(cardEl.textContent.includes('0 / 5 cevap görüldü'), 'Başlangıçta 0 / 5 cevap görüldü olmalı');

      // 3. Başla düğmesine bas
      click('[data-action="start-klasik"]');
      check(VIEW === 'klasikCalisma', 'Çalışma ekranına geçilmeli');
      checkUstBar('open-klasik', 'Klasik Sorular');
      check(!document.querySelector('input[type="search"][data-klasik-arama]'), 'Arama alanı soru ekranında olmamalı');
      check(document.querySelector('.card').textContent.includes('Soru 1 / 5'), 'İlk soru "Soru 1 / 5" olmalı');
      check(document.querySelector('.card').textContent.includes('Hukuk'), 'İlk sorunun kategorisi Hukuk olmalı');
      check(document.querySelector('.card').textContent.includes('Ticaret Kanununa göre'), 'İlk sorunun metni görünmeli');

      // Soru ekranı düğme düzeni kontrolleri
      var satir1 = document.querySelector('.klasik-aksiyon-satiri-1');
      var satir2 = document.querySelector('.klasik-aksiyon-satiri-2');
      check(satir1, 'Satır 1 düğme kapsayıcısı bulunmalı (.klasik-aksiyon-satiri-1)');
      check(satir2, 'Satır 2 düğme kapsayıcısı bulunmalı (.klasik-aksiyon-satiri-2)');
      check(satir1.querySelector('[data-action="klasik-ipucu-goster"]'), 'Satır 1 solda ipucu butonu olmalı');
      check(satir1.querySelector('[data-action="klasik-cevabi-goster"]'), 'Satır 1 sağda Cevabı göster butonu olmalı');
      check(satir2.querySelectorAll('[data-action="klasik-mark"]').length === 3, 'Satır 2 solda 3 renkli buton olmalı');
      var hatirlaticiBtn = satir2.querySelector('[data-action="klasik-hatirlatici"]');
      check(hatirlaticiBtn && hatirlaticiBtn.textContent.includes('Hatırlatıcı'), 'Satır 2 sağda Hatırlatıcı butonu bulunmalı');
      check(satir2.querySelector('[data-action="klasik-feedback-ac"]'), 'Satır 2 sağda Cevap güncellenmeli butonu bulunmalı');
      check(hatirlaticiBtn.getAttribute('aria-pressed') === 'false', 'Hatırlatıcı başlangıçta basılı olmamalı');

      if (innerWidth <= 480) {
        var s1Btns = Array.from(satir1.querySelectorAll('button'));
        check(s1Btns.length === 2, 'Satır 1 iki düğme içermeli');
        check(Math.abs(s1Btns[0].getBoundingClientRect().top - s1Btns[1].getBoundingClientRect().top) <= 2, 'Satır 1 düğmeleri tek satırda olmalı');
        var s1Rect = satir1.getBoundingClientRect();
        var s1InnerLeft = s1Rect.left + satir1.clientLeft;
        var s1InnerRight = s1InnerLeft + satir1.clientWidth;
        var s1Left = Math.min.apply(null, s1Btns.map(function (b) { return b.getBoundingClientRect().left; }));
        var s1Right = Math.max.apply(null, s1Btns.map(function (b) { return b.getBoundingClientRect().right; }));
        var s1SolBosluk = s1Left - s1InnerLeft;
        var s1SagBosluk = s1InnerRight - s1Right;
        check(Math.abs(s1SolBosluk - s1SagBosluk) <= 2, 'Satır 1 düğme satırı yatayda ortalanmalı (sol: ' + s1SolBosluk + ', sağ: ' + s1SagBosluk + ')');
        check(s1SolBosluk > 2, 'Satır 1 düğmeleri kenara dayalı değil, ortada toplanmış olmalı (sol boşluk: ' + s1SolBosluk + ')');

        var s2Btns = Array.from(satir2.querySelectorAll('button'));
        check(s2Btns.length === 5, 'Satır 2 beş düğme içermeli');
        var s2Tops = s2Btns.map(function (b) { return b.getBoundingClientRect().top; });
        check(Math.max.apply(null, s2Tops) - Math.min.apply(null, s2Tops) <= 2, 'Satır 2 beş düğmenin top değerleri tek satır olmalı (2 px tolerans)');

        var s2Rect = satir2.getBoundingClientRect();
        var s2InnerLeft = s2Rect.left + satir2.clientLeft;
        var s2InnerRight = s2InnerLeft + satir2.clientWidth;
        var s2Left = Math.min.apply(null, s2Btns.map(function (b) { return b.getBoundingClientRect().left; }));
        var s2Right = Math.max.apply(null, s2Btns.map(function (b) { return b.getBoundingClientRect().right; }));
        var s2SolBosluk = s2Left - s2InnerLeft;
        var s2SagBosluk = s2InnerRight - s2Right;
        check(Math.abs(s2SolBosluk - s2SagBosluk) <= 2, 'Satır 2 beşli grubun sol ve sağ boşluğu en fazla 2 px farklı olmalı (sol: ' + s2SolBosluk + ', sağ: ' + s2SagBosluk + ')');

        s2Btns.forEach(function (btn) {
          var rect = btn.getBoundingClientRect();
          check(rect.left >= s2InnerLeft - 0.5 && rect.right <= s2InnerRight + 0.5, 'Hiçbir düğme .klasik-aksiyon-satiri-2 kutusunun dışına çıkmamalı: ' + btn.textContent.trim());
        });

        var feedbackBtnMob = satir2.querySelector('[data-action="klasik-feedback-ac"]');
        var hatirlaticiMetin = hatirlaticiBtn.querySelector('.klasik-aksiyon-metin');
        var hatirlaticiSimge = hatirlaticiBtn.querySelector('.klasik-aksiyon-simge');
        var feedbackMetin = feedbackBtnMob ? feedbackBtnMob.querySelector('.klasik-aksiyon-metin') : null;
        var feedbackSimge = feedbackBtnMob ? feedbackBtnMob.querySelector('.klasik-aksiyon-simge') : null;

        check(hatirlaticiMetin && window.getComputedStyle(hatirlaticiMetin).display === 'none', 'Hatırlatıcı yazı öğesi getComputedStyle(...).display === "none" olmalı');
        check(hatirlaticiSimge && window.getComputedStyle(hatirlaticiSimge).display !== 'none', 'Hatırlatıcı simgesi görünür olmalı');
        check(feedbackMetin && window.getComputedStyle(feedbackMetin).display === 'none', 'Cevap güncellenmeli yazı öğesi getComputedStyle(...).display === "none" olmalı');
        check(feedbackSimge && window.getComputedStyle(feedbackSimge).display !== 'none', 'Cevap güncellenmeli ✏️ simgesi görünür olmalı');

        check(hatirlaticiBtn.getBoundingClientRect().width >= 36, 'Hatırlatıcı simge düğmesi genişliği ≥ 36 olmalı: ' + hatirlaticiBtn.getBoundingClientRect().width);
        check(feedbackBtnMob && feedbackBtnMob.getBoundingClientRect().width >= 36, 'Cevap güncellenmeli simge düğmesi genişliği ≥ 36 olmalı: ' + (feedbackBtnMob ? feedbackBtnMob.getBoundingClientRect().width : 0));
      } else {
        var s2RectWide = satir2.getBoundingClientRect();
        var s2InnerLeftWide = s2RectWide.left + satir2.clientLeft;
        var s2InnerRightWide = s2InnerLeftWide + satir2.clientWidth;
        var ilkRenkBtn = satir2.querySelector('[data-action="klasik-mark"]');
        check(ilkRenkBtn, 'İlk renk düğmesi bulunmalı');
        check(Math.abs(ilkRenkBtn.getBoundingClientRect().left - s2InnerLeftWide) <= 2, 'Geniş ekranda ilk renk düğmesi kapsayıcının soluna dayalı olmalı: sol farkı ' + (ilkRenkBtn.getBoundingClientRect().left - s2InnerLeftWide));
        var feedbackBtn = satir2.querySelector('[data-action="klasik-feedback-ac"]');
        check(feedbackBtn, 'Cevap güncellenmeli düğmesi bulunmalı');
        check(Math.abs(s2InnerRightWide - feedbackBtn.getBoundingClientRect().right) <= 2, 'Geniş ekranda Cevap güncellenmeli düğmesi kapsayıcının sağına dayalı olmalı: sağ farkı ' + (s2InnerRightWide - feedbackBtn.getBoundingClientRect().right));

        var hatirlaticiMetinG = hatirlaticiBtn.querySelector('.klasik-aksiyon-metin');
        var hatirlaticiSimgeG = hatirlaticiBtn.querySelector('.klasik-aksiyon-simge');
        var feedbackMetinG = feedbackBtn ? feedbackBtn.querySelector('.klasik-aksiyon-metin') : null;
        var feedbackSimgeG = feedbackBtn ? feedbackBtn.querySelector('.klasik-aksiyon-simge') : null;
        check(hatirlaticiMetinG && window.getComputedStyle(hatirlaticiMetinG).display !== 'none', 'Geniş ekranda Hatırlatıcı yazısı görünmeli');
        check(hatirlaticiSimgeG && window.getComputedStyle(hatirlaticiSimgeG).display !== 'none', 'Geniş ekranda Hatırlatıcı simgesi görünmeli');
        check(feedbackMetinG && window.getComputedStyle(feedbackMetinG).display !== 'none', 'Geniş ekranda Cevap güncellenmeli yazısı görünmeli');
        check(feedbackSimgeG && window.getComputedStyle(feedbackSimgeG).display === 'none', 'Geniş ekranda ✏️ simgesi display:none olmalı');
      }

      // Hatırlatıcı düğmesine bas (S1 için aç)
      click('[data-action="klasik-hatirlatici"]');
      hatirlaticiBtn = document.querySelector('[data-action="klasik-hatirlatici"]');
      check(hatirlaticiBtn && hatirlaticiBtn.getAttribute('aria-pressed') === 'true', 'Hatırlatıcı basılınca aria-pressed true olmalı (iyimser güncelleme)');

      // 4. İpucu göster düğmesine bas (2 ipucu var)
      var ipucuBtn = document.querySelector('[data-action="klasik-ipucu-goster"]');
      check(ipucuBtn && ipucuBtn.textContent.includes('0 / 2'), 'İpucu butonu başlangıçta 0 / 2 olmalı');

      click('[data-action="klasik-ipucu-goster"]');
      ipucuBtn = document.querySelector('[data-action="klasik-ipucu-goster"]');
      check(ipucuBtn && ipucuBtn.textContent.includes('1 / 2'), 'İlk basışta ipucu 1 / 2 olmalı');
      check(document.querySelector('.card').textContent.includes('Şahıs ve sermaye şirketleri'), 'İlk ipucu metni görünmeli');

      click('[data-action="klasik-ipucu-goster"]');
      ipucuBtn = document.querySelector('[data-action="klasik-ipucu-goster"]');
      check(ipucuBtn && ipucuBtn.disabled, 'İkinci basışta tüm ipuçları açılınca buton devre dışı kalmalı');
      check(document.querySelector('.card').textContent.includes('İpuçlarının tamamı açıldı'), 'Devre dışı ipucu metni görünmeli');
      check(document.querySelector('.card').textContent.includes('Sermaye şirketlerinden en yaygın'), 'İkinci ipucu metni görünmeli');

      // 5. Cevabı göster düğmesine bas
      check(!document.querySelector('.klasik-cevap') && !document.querySelector('.card').textContent.includes('TTK uyarınca ticaret şirketleri'), 'Cevap henüz görünmemeli');
      click('[data-action="klasik-cevabi-goster"]');
      check(seenRequests.length === 1 && seenRequests[0] === 'S1', 'klasik-seen S1 için bir kez gönderilmeli');

      // Cevap bileşenlerinin çizildiğini doğrula (başlık, paragraf, madde listesi, tablo)
      check(document.querySelector('.card').textContent.includes('Şirket Türleri'), 'Cevap başlığı çizilmeli');
      check(document.querySelector('.card').textContent.includes('TTK uyarınca ticaret şirketleri'), 'Cevap paragrafı çizilmeli');
      var ulList = document.querySelector('.klasik-cevap ul');
      check(ulList && ulList.querySelectorAll('li').length === 3, 'Madde listesi 3 maddeli ul olmalı');
      var tableEl = document.querySelector('.klasik-cevap table');
      check(tableEl && tableEl.querySelectorAll('tr').length === 3, 'Tablo ilk satır başlık olmak üzere 3 satır olmalı');
      check(!document.querySelector('[data-action="klasik-cevabi-goster"]'), 'Cevap açılınca düğme yerine cevap durmalı');

      measureLayout('daily-study');
      // 6. Sonraki soruya git (Soru 2)
      click('[data-action="klasik-sonraki"]');
      check(document.querySelector('.card').textContent.includes('Soru 2 / 5'), 'Soru 2 / 5 görünmeli');
      check(document.querySelector('.card').textContent.includes('Kredi'), 'Kategori Kredi olmalı');

      // S2 kısmi sorudur: eksik notu kontrolü
      check(document.querySelector('.card').textContent.includes('Bu sorunun cevabı eksik; mevcut kısım gösterilir'), 'Kısmi soru uyarısı görünmeli');

      // 7. Önceki soruya dön (Soru 1): açık ipuçları ve cevap korunmalı
      click('[data-action="klasik-onceki"]');
      check(document.querySelector('.card').textContent.includes('Soru 1 / 5'), 'Tekrar Soru 1 / 5');
      check(document.querySelector('.card').textContent.includes('İpuçlarının tamamı açıldı'), 'Soru 1 ipucu açık kalmalı');
      check(document.querySelector('.card').textContent.includes('Şirket Türleri'), 'Soru 1 cevabı açık kalmalı');

      // 8. Sekmeye geri dön: kartta "1 / 5 cevap görüldü" olmalı
      click('[data-action="open-klasik"]');
      check(VIEW === 'klasik', 'Tekrar klasik sekmesine dönüldü');
      cardEl = document.querySelector('.card');
      check(cardEl && cardEl.textContent.includes('1 / 5 cevap görüldü'), 'Kartta 1 / 5 cevap görüldü yazmalı');

      check(document.querySelector('[data-action="open-klasik-kontrol"]'), 'Non-admin control card visible');
      click('[data-action="open-klasik-konular"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(VIEW === 'klasikKonular', 'Görünüm klasikKonular olmalı');
      checkUstBar('open-klasik', 'Klasik Sorular');
      check(document.querySelector('input[type="search"][data-klasik-arama]'), 'Arama alanı yalnız Konu konu bak ekranında olmalı');

      var isaretKutulari = document.querySelectorAll('[data-action="klasik-filtre-isaret"]');
      check(isaretKutulari.length === 3, 'Konu konu bak ekranında 3 işaret kutusu bulunmalı');
      var hatirlaticiKutu = document.querySelector('[data-action="klasik-filtre-hatirlatici"]');
      check(hatirlaticiKutu && hatirlaticiKutu.textContent.includes('Hatırlatıcı · 1'), 'Hatırlatıcı kutusu 1 göstermeli');
      check(hatirlaticiKutu.getAttribute('aria-pressed') === 'false', 'Hatırlatıcı kutusu başlangıçta basılı olmamalı');
      var ogrendimKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="yesil"]');
      var tekrarKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="sari"]');
      var anlamadimKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="kirmizi"]');
      check(ogrendimKutu && ogrendimKutu.textContent.includes('Öğrendim · 0'), 'Öğrendim başlangıçta 0');
      check(tekrarKutu && tekrarKutu.textContent.includes('Tekrar bak · 0'), 'Tekrar bak başlangıçta 0');
      check(anlamadimKutu && anlamadimKutu.textContent.includes('Anlamadım · 0'), 'Anlamadım başlangıçta 0');

      // Arama testleri:
      // A1. Türkçe büyük harfli arama ("İHRACAT" -> küçük harfli "ihracat" ile eşleşir)
      var aramaInput = document.querySelector('input[type="search"][data-klasik-arama]');
      check(aramaInput, 'Arama alanı bulunmalı');
      aramaInput.value = 'İHRACAT';
      aramaInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      var sonuclar = document.querySelectorAll('[data-action="klasik-soru-ac"]');
      check(sonuclar.length === 2, 'İHRACAT araması 2 soru getirmeli (S9 ve S10)');
      check(document.body.textContent.includes('2 soru bulundu'), '"2 soru bulundu" satırı görünmeli');
      check(!document.querySelector('[data-action="klasik-grup"]'), 'Arama doluyken kategori grupları gizlenmeli');

      // A2. İki kelimelik arama (yalnız ikisini de içeren listelenir)
      aramaInput = document.querySelector('input[type="search"][data-klasik-arama]');
      aramaInput.value = 'İHRACAT BEYANNAME';
      aramaInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      sonuclar = document.querySelectorAll('[data-action="klasik-soru-ac"]');
      check(sonuclar.length === 1 && sonuclar[0].getAttribute('data-no') === 'S9', 'İki kelimelik arama yalnız ikisini de içeren S9 sorusunu getirmeli');
      check(document.body.textContent.includes('1 soru bulundu'), '"1 soru bulundu" satırı görünmeli');

      // A3. Eşleşme yokken "Eşleşen soru yok." görünür
      aramaInput = document.querySelector('input[type="search"][data-klasik-arama]');
      aramaInput.value = 'İHRACAT ENFLASYON';
      aramaInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.body.textContent.includes('Eşleşen soru yok.'), '"Eşleşen soru yok." görünmeli');
      check(document.querySelectorAll('[data-action="klasik-soru-ac"]').length === 0, 'Eşleşme yokken satır olmamalı');

      // A3-b. Düşük öncelikli soru metniyle aramada "Eşleşen soru yok." görünür
      aramaInput = document.querySelector('input[type="search"][data-klasik-arama]');
      aramaInput.value = 'Düşük soru';
      aramaInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.body.textContent.includes('Eşleşen soru yok.'), 'Düşük öncelikli soru metniyle aramada "Eşleşen soru yok." görünmeli');
      check(document.querySelectorAll('[data-action="klasik-soru-ac"]').length === 0, 'Düşük öncelikli soru arama sonuçlarında listelenmemeli');

      // A4. Arama silinince kategori grupları geri gelir
      aramaInput = document.querySelector('input[type="search"][data-klasik-arama]');
      aramaInput.value = '';
      aramaInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelectorAll('[data-action="klasik-grup"]').length > 0, 'Arama temizlenince kategori grupları geri gelmeli');

      // A5. Arama sonucundan açılan soruda ileri/geri yalnız sonuçlar arasında gezinir; geri dönüşte arama metni korunur
      aramaInput = document.querySelector('input[type="search"][data-klasik-arama]');
      aramaInput.value = 'İHRACAT';
      aramaInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      measureLayout('konu-arama');
      click('[data-action="klasik-soru-ac"][data-no="S9"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(VIEW === 'klasikCalisma', 'Arama sonucundan soru ekranı açılmalı');
      checkUstBar('klasik-geri', 'Konu Konu Bak');
      check(!document.querySelector('input[type="search"][data-klasik-arama]'), 'Soru ekranında arama alanı olmamalı');
      check(document.querySelector('.card').textContent.includes('Soru 1 / 2'), 'İki arama sonucu arasında gezinir: Soru 1 / 2');
      check(document.querySelector('[data-action="klasik-onceki"]').disabled, 'İlk sonuçta Önceki devre dışı');
      click('[data-action="klasik-sonraki"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('.card').textContent.includes('Soru 2 / 2'), 'İkinci sonuca geçer: Soru 2 / 2');
      check(document.querySelector('[data-action="klasik-sonraki"]').disabled, 'Son sonuçta Sonraki devre dışı');
      click('[data-action="klasik-geri"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(VIEW === 'klasikKonular', 'Geri dönüş Konu konu bak ekranına dönmeli');
      aramaInput = document.querySelector('input[type="search"][data-klasik-arama]');
      check(aramaInput && aramaInput.value === 'İHRACAT', 'Geri dönüşte arama metni korunmalı');
      check(document.querySelectorAll('[data-action="klasik-soru-ac"]').length === 2, 'Geri dönüşte arama sonuçları korunmalı');

      // A6. İki karakter art arda yazıldığında odak arama alanında kalır ve alanın değeri iki karakterdir
      aramaInput.focus();
      aramaInput.value = 'k';
      aramaInput.setSelectionRange(1, 1);
      aramaInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.activeElement && document.activeElement.matches('[data-klasik-arama]'), 'İlk harften sonra odak arama alanında kalmalı');
      var activeEl = document.activeElement;
      activeEl.value = 'kr';
      activeEl.setSelectionRange(2, 2);
      activeEl.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.activeElement && document.activeElement.matches('[data-klasik-arama]'), 'İkinci harften sonra odak arama alanında kalmalı');
      check(document.activeElement.value === 'kr', 'Arama alanının değeri iki karakter ("kr") olmalı');

      // Aramayı sıfırla ve kategori grubuna geç
      document.activeElement.value = '';
      document.activeElement.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));

      var group = document.querySelector('[data-grup="Hukuk"]');
      check(group && group.getAttribute('aria-expanded') === 'false', 'Category collapsed');
      check(group.textContent.includes('2 soru'), 'Category count (excludes dusuk in topic list: only S1 and S6)');
      click('[data-grup="Hukuk"]');
      group = document.querySelector('[data-grup="Hukuk"]');
      var s1Row = document.querySelector('[data-action="klasik-soru-ac"][data-no="S1"]');
      check(s1Row, 'Konu konu bak grubunda S1 bulunmalı');
      check(s1Row.querySelector('[aria-label="Hatırlatıcı"]'), 'S1 satırında hatırlatıcı rozeti görünmeli');
      check(document.querySelector('[data-action="klasik-soru-ac"][data-no="S6"]'), 'Konu konu bak grubunda S6 bulunmalı');
      check(!document.querySelector('[data-action="klasik-soru-ac"][data-no="S7"]'), 'Konu konu bak grubunda düşük öncelikli S7 satırı olmamalı');
      check(!document.querySelector('[data-action="klasik-soru-ac"][data-no="S8"]'), 'Konu konu bak grubunda düşük öncelikli S8 satırı olmamalı');
      var groupCard = group.closest('.card');
      check(groupCard && groupCard.classList.contains('klasik-grup-acik'), 'Açık grup kartı vurgulanmalı (.klasik-grup-acik)');
      var kilavuz = groupCard.querySelector('.klasik-satirlar-kilavuz');
      check(kilavuz, 'Açılan grubun satırları sol kılavuz çizgisi taşımalı (.klasik-satirlar-kilavuz)');

      click('[data-action="klasik-soru-ac"][data-no="S1"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('.klasik-cevap'), 'Shared study state');
      checkUstBar('klasik-geri', 'Konu Konu Bak');
      click('[data-action="klasik-mark"][data-isaret="sari"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('[data-isaret="sari"]').getAttribute('aria-pressed') === 'true', 'Yellow selected');
      click('[data-action="klasik-geri"]');
      group = document.querySelector('[data-grup="Hukuk"]');
      check(group.getAttribute('aria-expanded') === 'true', 'Open category preserved');
      check(group.querySelector('[data-sayac="sari"]').textContent.includes('1'), 'Yellow count 1');
      check(group.querySelector('[data-sayac="yok"]').textContent.includes('1'), 'Yok count 1 (düşük sorular sayaçta yok)');
      check(document.querySelector('[data-no="S1"]').getAttribute('data-isaret') === 'sari', 'Yellow row');
      measureLayout('topic-list');

      // Düşük öncelikli soru S7 işaretlendiğinde kutu onu saymaz ve kutu listesi onu içermez
      var s7Soru = allQuestions.find(function (q) { return q.no === 'S7'; });
      s7Soru.isaret = 'yesil';
      render();

      // İşaret kutuları testleri:
      // 1. Kutulardaki sayılar işaretli soru sayılarıyla eşittir (düşük öncelikli sorular sayılmaz)
      ogrendimKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="yesil"]');
      tekrarKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="sari"]');
      anlamadimKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="kirmizi"]');
      hatirlaticiKutu = document.querySelector('[data-action="klasik-filtre-hatirlatici"]');
      check(ogrendimKutu && ogrendimKutu.textContent.includes('Öğrendim · 0'), 'Düşük öncelikli S7 yeşil işaretliyken Öğrendim kutusu onu saymamalı (0 kalmalı)');
      check(tekrarKutu && tekrarKutu.textContent.includes('Tekrar bak · 1'), 'Tekrar bak kutusu 1 göstermeli');
      check(anlamadimKutu && anlamadimKutu.textContent.includes('Anlamadım · 0'), 'Anlamadım kutusu 0 göstermeli');
      check(hatirlaticiKutu && hatirlaticiKutu.textContent.includes('Hatırlatıcı · 1'), 'Hatırlatıcı kutusu 1 göstermeli');

      // 1-b. Öğrendim kutusuna basıldığında S7 listelenmemeli ve "Bu işaretle soru yok." görünmeli
      click('[data-action="klasik-filtre-isaret"][data-isaret="yesil"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.body.textContent.includes('Bu işaretle soru yok.'), 'Düşük soru yeşilken Konu konu bak Öğrendim kutusunda "Bu işaretle soru yok." görünmeli');
      check(!document.querySelector('[data-action="klasik-soru-ac"][data-no="S7"]'), 'Kutu listesi düşük öncelikli S7 sorusunu içermemeli');
      click('[data-action="klasik-filtre-isaret"][data-isaret="yesil"]');
      await new Promise(resolve => setTimeout(resolve, 0));

      // 1-c. Hatırlatıcı kutusuna basıldığında yalnız hatırlatıcılı sorular listelenir
      click('[data-action="klasik-filtre-hatirlatici"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      hatirlaticiKutu = document.querySelector('[data-action="klasik-filtre-hatirlatici"]');
      check(hatirlaticiKutu && hatirlaticiKutu.getAttribute('aria-pressed') === 'true', 'Hatırlatıcı kutusu aria-pressed true olmalı');
      check(!document.querySelector('[data-action="klasik-grup"]'), 'Hatırlatıcı seçiliyken kategori grupları gizlenmeli');
      var hatirlaticiSatirlari = document.querySelectorAll('[data-action="klasik-soru-ac"]');
      check(hatirlaticiSatirlari.length === 1 && hatirlaticiSatirlari[0].getAttribute('data-no') === 'S1', 'Yalnız hatırlatıcılı S1 listelenmeli');
      click('[data-action="klasik-filtre-hatirlatici"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelectorAll('[data-action="klasik-grup"]').length > 0, 'Hatırlatıcı kutusu kapanınca gruplar geri gelmeli');

      // 2. Kutuya tıklanınca yalnız o işareti taşıyan sorular listelenir
      click('[data-action="klasik-filtre-isaret"][data-isaret="sari"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      tekrarKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="sari"]');
      check(tekrarKutu && tekrarKutu.getAttribute('aria-pressed') === 'true', 'Seçili kutu aria-pressed="true" olmalı');
      check(!document.querySelector('[data-action="klasik-grup"]'), 'Kutu seçiliyken kategori grupları gizlenmeli');
      var filtreliSatirlar = document.querySelectorAll('[data-action="klasik-soru-ac"]');
      check(filtreliSatirlar.length === 1 && filtreliSatirlar[0].getAttribute('data-no') === 'S1', 'Yalnız sari işaretli S1 sorusu listelenmeli');
      check(document.body.textContent.includes('1 soru bulundu'), '"1 soru bulundu" satırı görünmeli');

      // 3. İkinci tıklamada gruplar geri gelir
      click('[data-action="klasik-filtre-isaret"][data-isaret="sari"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      tekrarKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="sari"]');
      check(tekrarKutu && tekrarKutu.getAttribute('aria-pressed') === 'false', 'İkinci tıklamada aria-pressed="false" olmalı');
      check(document.querySelectorAll('[data-action="klasik-grup"]').length > 0, 'İkinci tıklamada gruplar geri gelmeli');

      // 4. İşaretli soru yokken "Bu işaretle soru yok." görünür
      click('[data-action="klasik-filtre-isaret"][data-isaret="yesil"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      ogrendimKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="yesil"]');
      check(ogrendimKutu && ogrendimKutu.getAttribute('aria-pressed') === 'true', 'Öğrendim kutusu seçili olmalı');
      check(document.body.textContent.includes('Bu işaretle soru yok.'), '"Bu işaretle soru yok." metni görünmeli');
      check(document.querySelectorAll('[data-action="klasik-soru-ac"]').length === 0, 'İşaretli soru yokken satır olmamalı');

      // 5. Başka kutuya geçişte liste değişir (Öğrendim -> Tekrar bak)
      click('[data-action="klasik-filtre-isaret"][data-isaret="sari"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      ogrendimKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="yesil"]');
      tekrarKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="sari"]');
      check(ogrendimKutu && ogrendimKutu.getAttribute('aria-pressed') === 'false', 'Eski kutu seçimi kalkmalı');
      check(tekrarKutu && tekrarKutu.getAttribute('aria-pressed') === 'true', 'Yeni kutu seçili olmalı');
      filtreliSatirlar = document.querySelectorAll('[data-action="klasik-soru-ac"]');
      check(filtreliSatirlar.length === 1 && filtreliSatirlar[0].getAttribute('data-no') === 'S1', 'Yeni kutunun soruları listelenmeli');

      // 6. Arama ve kutu birlikteyken yalnız iki koşulu da sağlayan sorular listelenir
      aramaInput = document.querySelector('input[type="search"][data-klasik-arama]');
      aramaInput.value = 'Ticaret';
      aramaInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      filtreliSatirlar = document.querySelectorAll('[data-action="klasik-soru-ac"]');
      check(filtreliSatirlar.length === 1 && filtreliSatirlar[0].getAttribute('data-no') === 'S1', 'Arama ve kutu uyuşunca S1 listelenmeli');

      aramaInput = document.querySelector('input[type="search"][data-klasik-arama]');
      aramaInput.value = 'İHRACAT';
      aramaInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelectorAll('[data-action="klasik-soru-ac"]').length === 0, 'Arama kutuyla uyuşmayınca sonuç olmamalı');
      check(document.body.textContent.includes('Eşleşen soru yok.'), 'Arama filtresi varken eşleşme yoksa "Eşleşen soru yok." görünmeli');

      aramaInput = document.querySelector('input[type="search"][data-klasik-arama]');
      aramaInput.value = '';
      aramaInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelectorAll('[data-action="klasik-soru-ac"]').length === 1, 'Arama temizlenince sari kutudaki S1 tekrar listelenmeli');

      // 7. Listeden açılan soruda gezinme liste içinde kalır; soru ekranında işaret değiştirilip geri dönülünce sayılar ve liste güncellenmiştir
      measureLayout('isaret-kutulari');

      click('[data-action="klasik-soru-ac"][data-no="S1"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(VIEW === 'klasikCalisma', 'Filtreli listeden soru açılmalı');
      check(!document.querySelector('[data-action="klasik-filtre-isaret"]'), 'İşaret filtre kutuları soru ekranında olmamalı');
      check(document.querySelector('.card').textContent.includes('Soru 1 / 1'), 'Yalnız 1 soru arasında gezinir: Soru 1 / 1');
      check(document.querySelector('[data-action="klasik-onceki"]').disabled, 'Önceki devre dışı');
      check(document.querySelector('[data-action="klasik-sonraki"]').disabled, 'Sonraki devre dışı');

      // İşareti sari -> yesil yap
      click('[data-action="klasik-mark"][data-isaret="yesil"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('[data-isaret="yesil"]').getAttribute('aria-pressed') === 'true', 'Yeşil seçildi');

      // Geri dön
      click('[data-action="klasik-geri"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(VIEW === 'klasikKonular', 'Geri dönüş Konu konu bak ekranına dönmeli');
      tekrarKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="sari"]');
      ogrendimKutu = document.querySelector('[data-action="klasik-filtre-isaret"][data-isaret="yesil"]');
      check(tekrarKutu && tekrarKutu.getAttribute('aria-pressed') === 'true', 'Geri dönüşte seçili kutu korunmalı');
      check(tekrarKutu && tekrarKutu.textContent.includes('Tekrar bak · 0'), 'Sayı güncellenmeli: Tekrar bak 0');
      check(ogrendimKutu && ogrendimKutu.textContent.includes('Öğrendim · 1'), 'Sayı güncellenmeli: Öğrendim 1');
      check(document.body.textContent.includes('Bu işaretle soru yok.'), 'Tekrar bak işaretli soru kalmadığı için uyarı görünmeli');

      // Yesil kutuya geç
      click('[data-action="klasik-filtre-isaret"][data-isaret="yesil"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelectorAll('[data-action="klasik-soru-ac"]').length === 1, 'Yeşil kutuda S1 listelenmeli');

      // S1'i açıp tekrar sari yap (sonraki test adımlarının tutarlı kalması için)
      click('[data-action="klasik-soru-ac"][data-no="S1"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      click('[data-action="klasik-mark"][data-isaret="sari"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('[data-isaret="sari"]').getAttribute('aria-pressed') === 'true', 'Sari geri seçildi');
      click('[data-action="klasik-geri"]');
      await new Promise(resolve => setTimeout(resolve, 0));

      // Kutuyu kapatıp kategori gruplarına dön
      click('[data-action="klasik-filtre-isaret"][data-isaret="yesil"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      group = document.querySelector('[data-grup="Hukuk"]');
      if (group && group.getAttribute('aria-expanded') !== 'true') click('[data-grup="Hukuk"]');
      await new Promise(resolve => setTimeout(resolve, 0));

      click('[data-no="S1"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      markFailure = true;
      click('[data-action="klasik-mark"][data-isaret="yesil"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('[data-isaret="sari"]').getAttribute('aria-pressed') === 'true', 'Mark rollback');
      markFailure = false;
      reminderFailure = true;
      click('[data-action="klasik-hatirlatici"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('[data-action="klasik-hatirlatici"]').getAttribute('aria-pressed') === 'true', 'Reminder rollback maintains true state');
      reminderFailure = false;
      click('[data-action="klasik-mark"][data-isaret="sari"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('[data-isaret="sari"]').getAttribute('aria-pressed') === 'false', 'Mark cleared');
      click('[data-action="klasik-sonraki"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('.card').textContent.includes('Cevap henüz yazılmadı.'), 'Unanswered notice');
      check(!document.querySelector('[data-action="klasik-ipucu-goster"]'), 'No clue button');
      check(document.querySelector('.card').textContent.includes('⚠ Şimdilik güncel değil'), 'Unanswered freshness');
      click('[data-action="klasik-feedback-ac"]');
      check(document.querySelector('[data-action="klasik-feedback-gonder"]').disabled, 'Empty feedback disabled');
      var textarea = document.querySelector('[data-klasik-feedback]');
      textarea.value = 'Yeni bilgi'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
      feedbackFailure = true;
      click('[data-action="klasik-feedback-gonder"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('[data-klasik-feedback]').value === 'Yeni bilgi', 'Feedback failure preserves text');
      measureLayout('feedback');
      feedbackFailure = false; feedbackRequests = [];
      click('[data-action="klasik-feedback-gonder"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(feedbackRequests.length === 1, 'Single feedback request');
      check(document.querySelector('.card').textContent.includes('Bildiriminiz alındı.'), 'Feedback confirmation');
      click('[data-action="klasik-geri"]');
      click('[data-action="open-klasik"]');
      check(remoteAuth.isAdmin === false, 'Control opened by non-admin account');
      click('[data-action="open-klasik-kontrol"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(VIEW === 'klasikKontrol', 'Görünüm klasikKontrol olmalı');
      checkUstBar('open-klasik', 'Klasik Sorular');
      check(!document.querySelector('input[type="search"][data-klasik-arama]'), 'Arama alanı Soru Kontrolü ekranında olmamalı');
      check(!document.querySelector('[data-action="klasik-filtre-isaret"]'), 'İşaret kutuları Soru Kontrolü ekranında olmamalı');
      var groups = document.querySelectorAll('[data-action="klasik-grup"]');
      check(groups.length === 3, 'Three control sections');
      check(groups[0].textContent.includes('3 soru') && groups[1].textContent.includes('4 soru') && groups[2].textContent.includes('1 soru'), 'Control counts');
      click('[data-grup="edilecek"]');
      click('[data-no="S2"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(VIEW === 'klasikCalisma', 'Kontrol soru ekranı açılmalı');
      checkUstBar('klasik-geri', 'Soru Kontrolü');
      check(!document.querySelector('input[type="search"][data-klasik-arama]'), 'Arama alanı kontrol soru ekranında olmamalı');
      check(!document.querySelector('[data-action="klasik-filtre-isaret"]'), 'İşaret kutuları kontrol soru ekranında olmamalı');
      check(document.querySelector('.card').textContent.includes('⚠ Güncellenecek bilgi'), 'Answered freshness');
      click('[data-action="klasik-sonraki"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('.card').textContent.includes('Muhasebe'), 'Control section navigation');
      click('[data-action="klasik-geri"]');
      check(VIEW === 'klasikKontrol', 'Back to control');
      check(document.documentElement.scrollWidth <= innerWidth, 'Control width');
      var savedDaily = klasikVerisi;
      klasikVerisi = { day: '2026-10-05', questions: [] }; VIEW = 'klasik'; render();
      check(document.querySelector('.card').textContent.includes('Günün Klasik Soruları'), 'Empty daily retains title');
      check(document.querySelectorAll('[data-action="open-klasik-konular"]').length === 1, 'Topic card available without daily answers');
      klasikVerisi = savedDaily; VIEW = 'klasikKontrol';
      bannerMsg = null; render();
      measureLayout('control');

      // Düşük öncelikli bölümü testleri
      click('[data-action="open-klasik"]');
      check(document.querySelector('[data-action="open-klasik-dusuk-oncelik"]'), 'Düşük Öncelikli kartı görünmeli');
      click('[data-action="open-klasik-dusuk-oncelik"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(VIEW === 'klasikDusukOncelik', 'Görünüm klasikDusukOncelik olmalı');
      checkUstBar('open-klasik', 'Klasik Sorular');
      check(!document.querySelector('input[type="search"][data-klasik-arama]'), 'Arama alanı Düşük Öncelikli ekranında olmamalı');
      check(!document.querySelector('[data-action="klasik-filtre-isaret"]'), 'İşaret kutuları Düşük Öncelikli ekranında olmamalı');
      check(document.querySelector('.section-title').textContent.includes('Düşük Öncelikli'), 'Başlık Düşük Öncelikli olmalı');
      var dusukGruplar = document.querySelectorAll('[data-action="klasik-grup"]');
      check(dusukGruplar.length === 1, 'Sorusu kalmayan kategori grubu gösterilmez (yalnız Hukuk)');
      check(dusukGruplar[0].textContent.includes('2 soru'), 'Düşük öncelikli Hukuk 2 soru');
      check(dusukGruplar[0].querySelector('.klasik-sayaclar'), 'İşaret sayaçları görünmeli');
      check(dusukGruplar[0].querySelector('[data-sayac="yesil"]').textContent.includes('1'), 'Düşük öncelikli Hukuk grubu yeşil sayacı 1 olmalı');
      click('[data-grup="Hukuk"]');
      var dusukSatirlar = document.querySelectorAll('[data-action="klasik-soru-ac"]');
      check(dusukSatirlar.length === 2, 'Yalnız 2 soru satırı görünmeli');
      check(dusukSatirlar[0].getAttribute('data-no') === 'S7', 'İlk soru S7');
      check(dusukSatirlar[0].getAttribute('data-isaret') === 'yesil', 'S7 yeşil işaretiyle görünmeli');
      check(dusukSatirlar[0].textContent.includes('Öğrendim'), 'S7 Öğrendim metnini taşımalı');
      check(dusukSatirlar[1].getAttribute('data-no') === 'S8', 'İkinci soru S8');
      click('[data-action="klasik-soru-ac"][data-no="S7"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(VIEW === 'klasikCalisma', 'Çalışma ekranı açılmalı');
      checkUstBar('klasik-geri', 'Düşük Öncelikli');
      check(!document.querySelector('input[type="search"][data-klasik-arama]'), 'Arama alanı soru ekranında olmamalı');
      check(!document.querySelector('[data-action="klasik-filtre-isaret"]'), 'İşaret kutuları soru ekranında olmamalı');
      check(document.querySelector('.card').textContent.includes('Soru 1 / 2'), 'Yalnız düşük sorular arasında gezinir (Soru 1 / 2)');
      check(document.querySelector('.card').textContent.includes('Düşük soru 1'), 'S7 soru metni');
      click('[data-action="klasik-sonraki"]');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(document.querySelector('.card').textContent.includes('Soru 2 / 2'), 'Soru 2 / 2');
      check(document.querySelector('.card').textContent.includes('Düşük soru 2'), 'S8 soru metni');
      check(document.querySelector('[data-action="klasik-sonraki"]').disabled, 'Düşük soruların sonuncusunda Sonraki devre dışı');
      click('[data-action="klasik-geri"]');
      check(VIEW === 'klasikDusukOncelik', 'Geri dönüş Düşük Öncelikli ekranına döner');
      measureLayout('dusuk-oncelik');

      window.__showKonuArama = function () {
        VIEW = 'klasikKonular';
        klasikArama = 'İHRACAT';
        render();
      };
      window.__showIsaretKutulari = function () {
        VIEW = 'klasikKonular';
        klasikSeciliIsaret = 'sari';
        klasikArama = '';
        render();
      };
      window.__showSoruUstBar = function () {
        VIEW = 'klasikCalisma';
        klasikKaynak = 'konular';
        klasikSoruIndex = 0;
        klasikCalismaNos = ['S9', 'S10'];
        render();
      };
      window.__showGrupAcik = function () {
        VIEW = 'klasikKonular';
        klasikArama = '';
        klasikSeciliIsaret = null;
        klasikFiltreHatirlatici = false;
        klasikAcikGruplar = { konular: { 'Hukuk': true }, kontrol: {}, dusuk: {} };
        render();
      };
      window.__showSoruDugmeler = function () {
        VIEW = 'klasikCalisma';
        klasikKaynak = 'konular';
        klasikSoruIndex = 0;
        klasikCalismaNos = ['S9', 'S10'];
        klasikSoruDurumu['S9'] = { acilanIpuclari: 0, cevapAcik: false, seenSent: false };
        render();
      };

      // Ekran görüntüsü için Düşük öncelikli ekranı açık tutulur
      render();
      // Yatay taşma kontrolü
      check(document.documentElement.scrollWidth <= innerWidth, 'Yatay taşma olmamalı');

      var result = document.createElement('pre');
      result.id = 'browser-result';
      result.textContent = JSON.stringify({ ok: true, viewport: innerWidth, layoutMeasurements: layoutMeasurements, checks: checks });
      document.body.appendChild(result);
    } catch (e) {
      var result = document.createElement('pre');
      result.id = 'browser-result';
      result.textContent = JSON.stringify({ ok: false, error: e.message, checks: checks });
      document.body.appendChild(result);
    }
  })();
})();`;

  const html = original.replace(/  ensureArtifact\(\)\.then\(function \(\) \{[\s\S]*?\}\)\(\);/, scenario)
    .replace(/^<script src=[^\n]*<\/script>\r?$/gm, '')
    .replace(/^<link[^\n]*fonts\.google[^\n]*\r?$/gm, '');
  const output = new URL(`../outputs/klasik-${width}/`, import.meta.url);
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
