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
      remoteAuth = { checked: true, authenticated: true, isActive: true, disclaimerAccepted: true, username: 'klasik_user', isAdmin: false };

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

      var seenRequests = [];
      remoteFetch = function (path, method, body) {
        if (body.action === 'klasik-daily') {
          return Promise.resolve({
            ok: true,
            data: { day: '2026-10-05', questions: mockDailyQuestions }
          });
        }
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
      check(document.querySelector('.card').textContent.includes('Soru 1 / 5'), 'İlk soru "Soru 1 / 5" olmalı');
      check(document.querySelector('.card').textContent.includes('Hukuk'), 'İlk sorunun kategorisi Hukuk olmalı');
      check(document.querySelector('.card').textContent.includes('Ticaret Kanununa göre'), 'İlk sorunun metni görünmeli');

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

      // Yatay taşma kontrolü
      check(document.documentElement.scrollWidth <= innerWidth, 'Yatay taşma olmamalı');

      var result = document.createElement('pre');
      result.id = 'browser-result';
      result.textContent = JSON.stringify({ ok: true, viewport: innerWidth, checks: checks });
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
