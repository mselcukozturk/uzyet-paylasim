import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

async function runBrowser(chrome: string, fixture: URL, output: URL, width: number) {
  const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--disable-background-networking', '--remote-debugging-port=0',
    `--user-data-dir=${fileURLToPath(new URL('profile/', output))}`, 'about:blank'], { windowsHide:true });
  let socket: WebSocket | undefined;
  try {
    const endpoint = await new Promise<string>((resolve,reject) => {
      const timer = setTimeout(()=>reject(new Error('Chrome başlamadı')),15000);
      let log = '';
      browser.stderr.on('data', data => {
        log += data;
        const found = log.match(/DevTools listening on (ws:\/\/\S+)/);
        if (found) { clearTimeout(timer); resolve(found[1]); }
      });
      browser.on('error',error=>{clearTimeout(timer);reject(error);});
    });
    socket = new WebSocket(endpoint);
    await new Promise<void>((resolve,reject)=>{socket!.onopen=()=>resolve();socket!.onerror=()=>reject(new Error('CDP bağlantısı kurulamadı'));});
    let serial = 0;
    const pending = new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      }
    };
    const send = (method:string,params:object={},sessionId?:string) => new Promise<any>((resolve,reject)=>{
      const id = ++serial; pending.set(id,{resolve,reject});
      socket!.send(JSON.stringify({id,method,params,sessionId}));
    });
    const target = await send('Target.createTarget',{url:'about:blank'});
    const {sessionId} = await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600},sessionId);
    await send('Page.navigate',{url:pathToFileURL(fileURLToPath(fixture)).href},sessionId);
    for (let attempt=0;attempt<100;attempt++) {
      const value = await send('Runtime.evaluate',{expression:'Boolean(document.getElementById("browser-result"))',returnByValue:true},sessionId);
      if (value.result.value) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const dom = await send('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true},sessionId);
    await send('Runtime.evaluate',{expression:'document.getElementById("browser-result").style.display="none"'},sessionId);
    const screenshot = await send('Page.captureScreenshot',{format:'png'},sessionId);
    writeFileSync(new URL('screenshot.png',output),Buffer.from(screenshot.data,'base64'));
    return dom.result.value as string;
  } finally {
    socket?.close();
    browser.kill();
    await new Promise<void>(resolve=>{if(browser.exitCode !== null) resolve(); else browser.once('exit',()=>resolve());});
  }
}

// Failures covered: premature session start, wrong topic/filter, unseen count
// changed by queue creation instead of display, answer counts changed by display,
// wrong answers not removed after correction, restart losing mode, empty pool,
// duplicate questions, mobile overflow. Runs the entire client and its click handlers.
for (const width of [390, 1100]) test(`Konu çalışma tarayıcı akışı (${width}px)`, async () => {
  const chrome = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
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
    function lesson() { return document.querySelector('details[data-konu="Kredi"]'); }
    function checkCounterLayout(container) {
      var box = container || lesson();
      var countEls = Array.from(box.querySelectorAll('.konu-sayaclar [data-count]'));
      var order = countEls.map(function(el) { return el.getAttribute('data-count'); });
      check(order.join(',') === 'total,repeat,wrong,unseen', 'Sayaç kutuları DOM sırası: total, repeat, wrong, unseen');
      var rTotal = box.querySelector('[data-count="total"]').parentElement.getBoundingClientRect();
      var rRepeat = box.querySelector('[data-count="repeat"]').parentElement.getBoundingClientRect();
      var rWrong = box.querySelector('[data-count="wrong"]').parentElement.getBoundingClientRect();
      var rUnseen = box.querySelector('[data-count="unseen"]').parentElement.getBoundingClientRect();
      if (innerWidth <= 600) {
        check(Math.abs(rTotal.top - rRepeat.top) < 1 && rTotal.right < rRepeat.left, 'Sayaç kutuları 2x2: total sol-üst ve repeat sağ-üst aynı satırda');
        check(Math.abs(rWrong.top - rUnseen.top) < 1 && rWrong.right < rUnseen.left, 'Sayaç kutuları 2x2: wrong sol-alt ve unseen sağ-alt aynı satırda');
        check(rTotal.bottom < rWrong.top && rRepeat.bottom < rUnseen.top, 'Sayaç kutuları 2x2: ikinci satır birincinin altında');
      } else {
        var tops = [rTotal.top, rRepeat.top, rWrong.top, rUnseen.top];
        check(Math.max.apply(null, tops) - Math.min.apply(null, tops) < 1, 'Dört sayaç kutusu aynı satırda');
        check(rTotal.right < rRepeat.left && rRepeat.right < rWrong.left && rWrong.right < rUnseen.left, 'Dört sayaç kutusu soldan sağa: total, repeat, wrong, unseen');
      }
    }
    function toplamKontrol() {
      var topBlock = document.querySelector('[data-toplam="1"]');
      check(!!topBlock, 'Toplam sayaç bloğu mevcut: [data-toplam="1"]');
      var countEls = Array.from(topBlock.querySelectorAll('.konu-sayaclar [data-count]'));
      var order = countEls.map(function(el) { return el.getAttribute('data-count'); });
      check(order.join(',') === 'total,repeat,wrong,unseen', 'Üst blok sayaç kutuları DOM sırası: total, repeat, wrong, unseen');
      var allLessons = Array.from(document.querySelectorAll('details.konu-calisma'));
      check(allLessons.length > 0, 'Ders kutuları mevcut');
      var sumTotal = 0, sumRepeat = 0, sumWrong = 0, sumUnseen = 0;
      allLessons.forEach(function(l) {
        sumTotal += parseInt(l.querySelector('[data-count="total"]').textContent, 10) || 0;
        sumRepeat += parseInt(l.querySelector('[data-count="repeat"]').textContent, 10) || 0;
        sumWrong += parseInt(l.querySelector('[data-count="wrong"]').textContent, 10) || 0;
        sumUnseen += parseInt(l.querySelector('[data-count="unseen"]').textContent, 10) || 0;
      });
      var topTotal = parseInt(topBlock.querySelector('[data-count="total"]').textContent, 10);
      var topRepeat = parseInt(topBlock.querySelector('[data-count="repeat"]').textContent, 10);
      var topWrong = parseInt(topBlock.querySelector('[data-count="wrong"]').textContent, 10);
      var topUnseen = parseInt(topBlock.querySelector('[data-count="unseen"]').textContent, 10);
      check(topTotal === sumTotal, 'Üst blok toplam soru derslerin toplamına eşit: ' + topTotal + ' === ' + sumTotal);
      check(topRepeat === sumRepeat, 'Üst blok toplam tekrar derslerin toplamına eşit: ' + topRepeat + ' === ' + sumRepeat);
      check(topWrong === sumWrong, 'Üst blok yanlış soru derslerin toplamına eşit: ' + topWrong + ' === ' + sumWrong);
      check(topUnseen === sumUnseen, 'Üst blok görülmemiş soru derslerin toplamına eşit: ' + topUnseen + ' === ' + sumUnseen);
      var firstDetails = document.querySelector('details.konu-calisma');
      check(topBlock.getBoundingClientRect().bottom <= firstDetails.getBoundingClientRect().top, 'Üst blok ders listesinden önce');
      checkCounterLayout(topBlock);
    }
    function counters(total, unseen, wrong, repeat) {
      var box = lesson();
      check(box.querySelector('[data-count="total"]').textContent === String(total), 'Toplam: ' + total);
      check(box.querySelector('[data-count="unseen"]').textContent === String(unseen), 'Görülmemiş: ' + unseen);
      check(box.querySelector('[data-count="wrong"]').textContent === String(wrong), 'Yanlış: ' + wrong);
      check(box.querySelector('[data-count="repeat"]').textContent === String(repeat), 'Toplam tekrar: ' + repeat);
      toplamKontrol();
    }
    function back() { click('[data-action="open-deneme-konu-sec"]'); }
    try {
      localStorage.clear();
      // Artifact publishing is external to this local browser fixture.
      saveAndPublish = function () { return Promise.resolve(true); };
      STATE.sadeceDeneme = false;
      STATE.bank = ['u1','u2','w1','c1','other'].map(function(g) {
        return {guid:g, konu:g === 'other' ? 'Hukuk' : 'Kredi', soru:'Soru ' + g,
          siklar:['Doğru','Yanlış','Başka','Son'], cevapIdx:0, cevapMetni:'Doğru', aciklama:'Açıklama'};
      });
      STATE.stats = {
        w1:{gosterim:1,dogru:0,yanlis:1,sonSonucDogruMu:false,sonGorulme:'2026-09-01'},
        c1:{gosterim:1,dogru:1,yanlis:0,sonSonucDogruMu:true,sonGorulme:'2026-09-01'},
        other:{gosterim:5,dogru:5,yanlis:0,sonSonucDogruMu:true,sonGorulme:'2026-09-01'}
      };
      STATE.flashOzet = {gosterim:0,dogru:0};
      VIEW = 'denemeKonuSec'; render();
      check(lesson() && !lesson().open && !currentFlash, 'Ders listesi oturum başlatmaz');
      function checkHeadingAlignment() {
        document.querySelectorAll('.konu-calisma summary').forEach(function(summary) {
          var parts = ['.konu-acma-isareti','.konu-dot','.konu-ders-adi'].map(function(selector) {
            var el = summary.querySelector(selector);
            check(!!el, 'Hizalanabilir başlık öğesi: ' + selector);
            return el.getBoundingClientRect();
          });
          var centers = parts.map(function(r) {return r.y+r.height/2;});
          check(Math.max.apply(null,centers)-Math.min.apply(null,centers)<1, 'Ok, nokta ve ders adı düşey merkezleri aynı');
          check(parts[0].right<parts[1].left && parts[1].right<parts[2].left, 'Başlık öğeleri aralıklı ve doğru sırada');
        });
      }
      document.documentElement.dataset.theme = 'light';
      checkHeadingAlignment();
      document.documentElement.dataset.theme = 'dark';
      checkHeadingAlignment();
      document.documentElement.dataset.theme = 'light';
      click('details[data-konu="Kredi"] summary');
      check(lesson().open, 'Derse basınca seçenekler açılır');
      render();
      check(lesson().open, 'Doğrudan render sonrası ders açık kalır');
      showBanner('deneme');
      check(lesson().open, 'showBanner sonrası ders açık kalır');
      bannerMsg = null; render();
      check(lesson().open, 'Banner kapanışı sonrası ders açık kalır');
      check(!document.querySelector('details[data-konu="Hukuk"]').open, 'Diğer ders kapalı kalır');
      click('details[data-konu="Kredi"] summary');
      check(!lesson().open, 'Ders kullanıcı tarafından kapatıldı');
      render();
      check(!lesson().open, 'Kullanıcı kapattıktan sonra render çağrılınca kapalı kalır');
      click('details[data-konu="Kredi"] summary');
      check(lesson().open, 'Derse tekrar basınca açılır');
      checkHeadingAlignment();
      check(document.querySelector('details[data-konu="Hukuk"] [data-count="repeat"]').textContent === '5', 'Başka dersin tekrar sayısı ayrık');
      counters(4,2,1,2);
      check(document.querySelector('[data-toplam="1"] [data-count="total"]').textContent === '5', 'Açık sayı üst blok toplam: 5');
      check(document.querySelector('[data-toplam="1"] [data-count="repeat"]').textContent === '7', 'Açık sayı üst blok toplam tekrar: 7');
      check(document.querySelector('[data-toplam="1"] [data-count="wrong"]').textContent === '1', 'Açık sayı üst blok yanlış: 1');
      check(document.querySelector('[data-toplam="1"] [data-count="unseen"]').textContent === '2', 'Açık sayı üst blok görülmemiş: 2');
      checkCounterLayout();
      check(lesson().querySelectorAll('button').length === 3, 'Üç seçenek');
      check(!lesson().querySelector('[data-action="start-deneme-konu-yanlis"]').textContent.match(/\\d/), 'Yanlış düğmesinde sayı yok');
      click('details[data-konu="Kredi"] [data-action="start-deneme-konu-gorulmemis"]');
      check(currentFlash.gecmis.length === 2 && new Set(currentFlash.gecmis.map(x=>x.guid)).size === 2, 'Görülmemiş kuyruğu tekrarsız');
      check(currentFlash.gecmis.every(x=>['u1','u2'].includes(x.guid)), 'Yalnız seçili dersin görülmemiş soruları');
      var first = currentFlash.guid;
      check(STATE.stats[first].sonGorulme && STATE.stats[first].gosterim === 0 && STATE.stats[first].sonSonucDogruMu === null, 'Görmek cevap istatistiğini değiştirmez');
      check(!STATE.stats[currentFlash.gecmis[1].guid], 'Kuyruğa girmek görülmüş sayılmaz');
      click('[data-action="bos-flash"]');
      back(); counters(4,1,1,2);
      click('details[data-konu="Kredi"] summary');
      click('details[data-konu="Kredi"] [data-action="start-deneme-konu-gorulmemis"]');
      check(currentFlash.gecmis.length === 1 && currentFlash.guid !== first, 'Görülen soru yeni kuyruktan çıkar');
      click('[data-action="select-flash-option"][data-idx="' + flashSoruBul(currentFlash).cevapIdx + '"]');
      click('[data-action="finish-flash"]');
      check(document.querySelector('[data-action="start-flash-again"]').dataset.gorulmemis === '1', 'Yeniden başlatma modu korunur');
      click('[data-action="start-flash-again"]');
      check(VIEW === 'flashResult', 'Boş görülmemiş havuz oturum açmaz');
      back(); counters(4,0,1,3);
      check(lesson().querySelector('[data-action="start-deneme-konu-gorulmemis"]').disabled, 'Görülmemiş seçenek sıfırda devre dışı');
      click('details[data-konu="Kredi"] summary');
      click('details[data-konu="Kredi"] [data-action="start-deneme-konu-yanlis"]');
      check(currentFlash.gecmis.length === 1 && currentFlash.guid === 'w1', 'Mevcut yanlışlar filtresi');
      click('[data-action="select-flash-option"][data-idx="' + flashSoruBul(currentFlash).cevapIdx + '"]');
      back(); counters(4,0,0,4);
      check(lesson().querySelector('[data-action="start-deneme-konu-yanlis"]').disabled, 'Yanlışlar sıfırda devre dışı');
      click('details[data-konu="Kredi"] summary');
      click('details[data-konu="Kredi"] [data-action="start-deneme-konu-flash"]');
      check(currentFlash.gecmis.length === 4 && currentFlash.gecmis.every(x=>x.guid !== 'other'), 'Rastgele tüm ders havuzunu korur');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      check(currentFlash.konum === 1, 'Ok ile sonraki soruya geçildi');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      check(currentFlash.konum === 0, 'Ok ile önceki soruya dönüldü');
      back(); bannerMsg = null; render(); click('details[data-konu="Kredi"] summary');
      counters(4,0,0,4);
      check(document.documentElement.scrollWidth <= innerWidth, 'Yatay taşma yok');
      check(!document.querySelector('[data-action="toggle-study-repeats"]'), 'Normal kullanıcı tekrar listesini göremez');
      remoteAuth.isAdmin = true; remoteAuth.username = 'yonetici'; render();
      var repeatRequests = 0;
      remoteFetch = function(path,method,body) {
        check(body.action === 'study-repeats', 'Tekrar listesi doğru API ile alınır');
        repeatRequests++;
        return Promise.resolve({ok:true,data:{users:[{name:'ikinci',totalRepeats:11},{name:'<script>',totalRepeats:7},{name:'yeni',totalRepeats:0}]}});
      };
      click('[data-action="toggle-study-repeats"]');
      check(document.querySelector('[data-study-repeats]').textContent.includes('Yükleniyor'), 'Liste yükleme durumu');
      await new Promise(resolve=>setTimeout(resolve,0));
      check(document.querySelector('[data-study-repeats] tbody').textContent.includes('ikinci'), 'Yönetici kullanıcı adını görür');
      check(document.querySelector('[data-study-repeats] tbody').textContent.includes('11'), 'Tekrar sayısı görünür');
      check(!document.querySelector('[data-study-repeats] script'), 'Kullanıcı adı HTML olarak çalışmaz');
      click('[data-action="toggle-study-repeats"]');
      check(!document.querySelector('[data-study-repeats] table'), 'Liste gizlenir');
      click('[data-action="toggle-study-repeats"]');
      await new Promise(resolve=>setTimeout(resolve,0));
      check(repeatRequests === 2, 'Yeniden açılınca güncel sayılar alınır');
      remoteFetch = function(){return Promise.resolve({ok:false,data:{error:'Liste alınamadı.'}});};
      click('[data-action="toggle-study-repeats"]'); click('[data-action="toggle-study-repeats"]');
      await new Promise(resolve=>setTimeout(resolve,0));
      check(document.querySelector('[data-study-repeats]').textContent.includes('Liste alınamadı'), 'Hata kullanıcıya gösterilir');
      click('[data-action="toggle-study-repeats"]');
      var finishRequest;
      remoteFetch = function(){return new Promise(resolve=>{finishRequest=resolve;});};
      click('[data-action="toggle-study-repeats"]');
      remoteAuth.isAdmin = false; remoteAuth.username = 'diger'; render();
      finishRequest({ok:true,data:{users:[{name:'gizli',totalRepeats:99}]}});
      await new Promise(resolve=>setTimeout(resolve,0));
      check(!document.querySelector('[data-study-repeats]') && !document.querySelector('.shell').textContent.includes('gizli'), 'Hesap değişince geciken yanıt gösterilmez');
      // Return to an administrator with a fresh view for the screenshot artifact.
      remoteAuth.isAdmin = true; remoteAuth.username = 'yonetici';
      konuTekrarListesi = {acik:false,yukleniyor:false,veri:null,hata:null};
      remoteFetch = function(){return Promise.resolve({ok:true,data:{users:[{name:'ikinci',totalRepeats:11},{name:'yonetici',totalRepeats:7},{name:'yeni',totalRepeats:0}]}});};
      render(); click('[data-action="toggle-study-repeats"]');
      await new Promise(resolve=>setTimeout(resolve,0));
      check(document.documentElement.scrollWidth <= innerWidth, 'Yönetici tablosu yatay taşmaz');
      var result = document.createElement('pre'); result.id = 'browser-result';
      result.textContent = JSON.stringify({ok:true,viewport:innerWidth,checks:checks}); document.body.appendChild(result);
    } catch (e) {
      var result = document.createElement('pre'); result.id = 'browser-result';
      result.textContent = JSON.stringify({ok:false,error:e.message,checks:checks}); document.body.appendChild(result);
    }
  })();
})();`;
  const html = original.replace(/  ensureArtifact\(\)\.then\(function \(\) \{[\s\S]*?\}\)\(\);/, scenario)
    .replace(/^<script src=[^\n]*<\/script>\r?$/gm, '')
    .replace(/^<link[^\n]*fonts\.google[^\n]*\r?$/gm, '');
  const output = new URL(`../outputs/topic-study-${width}/`, import.meta.url);
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
