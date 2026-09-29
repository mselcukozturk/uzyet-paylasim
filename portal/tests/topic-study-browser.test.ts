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
    function counters(total, unseen, wrong) {
      var box = lesson();
      check(box.querySelector('[data-count="total"]').textContent === String(total), 'Toplam: ' + total);
      check(box.querySelector('[data-count="unseen"]').textContent === String(unseen), 'Görülmemiş: ' + unseen);
      check(box.querySelector('[data-count="wrong"]').textContent === String(wrong), 'Yanlış: ' + wrong);
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
        c1:{gosterim:1,dogru:1,yanlis:0,sonSonucDogruMu:true,sonGorulme:'2026-09-01'}
      };
      STATE.flashOzet = {gosterim:0,dogru:0};
      VIEW = 'denemeKonuSec'; render();
      check(lesson() && !lesson().open && !currentFlash, 'Ders listesi oturum başlatmaz');
      click('details[data-konu="Kredi"] summary');
      check(lesson().open, 'Derse basınca seçenekler açılır');
      counters(4,2,1);
      check(lesson().querySelectorAll('button').length === 3, 'Üç seçenek');
      check(!lesson().querySelector('[data-action="start-deneme-konu-yanlis"]').textContent.match(/\\d/), 'Yanlış düğmesinde sayı yok');
      click('details[data-konu="Kredi"] [data-action="start-deneme-konu-gorulmemis"]');
      check(currentFlash.gecmis.length === 2 && new Set(currentFlash.gecmis.map(x=>x.guid)).size === 2, 'Görülmemiş kuyruğu tekrarsız');
      check(currentFlash.gecmis.every(x=>['u1','u2'].includes(x.guid)), 'Yalnız seçili dersin görülmemiş soruları');
      var first = currentFlash.guid;
      check(STATE.stats[first].sonGorulme && STATE.stats[first].gosterim === 0 && STATE.stats[first].sonSonucDogruMu === null, 'Görmek cevap istatistiğini değiştirmez');
      check(!STATE.stats[currentFlash.gecmis[1].guid], 'Kuyruğa girmek görülmüş sayılmaz');
      click('[data-action="bos-flash"]');
      back(); counters(4,1,1);
      click('details[data-konu="Kredi"] summary');
      click('details[data-konu="Kredi"] [data-action="start-deneme-konu-gorulmemis"]');
      check(currentFlash.gecmis.length === 1 && currentFlash.guid !== first, 'Görülen soru yeni kuyruktan çıkar');
      click('[data-action="select-flash-option"][data-idx="' + flashSoruBul(currentFlash).cevapIdx + '"]');
      click('[data-action="finish-flash"]');
      check(document.querySelector('[data-action="start-flash-again"]').dataset.gorulmemis === '1', 'Yeniden başlatma modu korunur');
      click('[data-action="start-flash-again"]');
      check(VIEW === 'flashResult', 'Boş görülmemiş havuz oturum açmaz');
      back(); counters(4,0,1);
      check(lesson().querySelector('[data-action="start-deneme-konu-gorulmemis"]').disabled, 'Görülmemiş seçenek sıfırda devre dışı');
      click('details[data-konu="Kredi"] summary');
      click('details[data-konu="Kredi"] [data-action="start-deneme-konu-yanlis"]');
      check(currentFlash.gecmis.length === 1 && currentFlash.guid === 'w1', 'Mevcut yanlışlar filtresi');
      click('[data-action="select-flash-option"][data-idx="' + flashSoruBul(currentFlash).cevapIdx + '"]');
      back(); counters(4,0,0);
      check(lesson().querySelector('[data-action="start-deneme-konu-yanlis"]').disabled, 'Yanlışlar sıfırda devre dışı');
      click('details[data-konu="Kredi"] summary');
      click('details[data-konu="Kredi"] [data-action="start-deneme-konu-flash"]');
      check(currentFlash.gecmis.length === 4 && currentFlash.gecmis.every(x=>x.guid !== 'other'), 'Rastgele tüm ders havuzunu korur');
      back(); bannerMsg = null; render(); click('details[data-konu="Kredi"] summary');
      check(document.documentElement.scrollWidth <= innerWidth, 'Yatay taşma yok');
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
