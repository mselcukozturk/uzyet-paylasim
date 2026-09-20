import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)![1];
function parca(ad: string) {
  const bas = script.indexOf('function ' + ad + '(');
  assert.notEqual(bas, -1, ad + ' bulunamadı');
  const son = script.indexOf('\n  }', bas);
  return script.slice(bas, son + 4);
}

// Geçmiş ekranındaki "Konu bazlı ortalama" kartı gerçekten çalıştırılarak denenir:
// son 3 gün, son 7 gün ve tüm zamanlar ayrı sütunlarda, virgüllü ve tek ondalıklı.
function kartCiz(remoteDash: unknown) {
  const sandbox: Record<string, unknown> = {
    remoteDash,
    escapeHtml: (s: string) => s,
    konuDotHtml: () => '<i></i>',
  };
  vm.createContext(sandbox);
  vm.runInContext(parca('fmtOrt') + '\n' + parca('konuOrtalamaKartiHtml') + '\nvar out = konuOrtalamaKartiHtml();', sandbox);
  return sandbox.out as string;
}

function gecmisCiz(examStats: unknown) {
  const sandbox: Record<string, unknown> = {
    remoteGecmis: { attempts: [], total: 0, page: 0, pageSize: 20 },
    remoteDash: { examStats },
    konuOrtalamaKartiHtml: () => '',
    ustBarHtml: () => '',
    fmtSure: (seconds: number) => seconds + ' sn',
  };
  vm.createContext(sandbox);
  vm.runInContext(parca('fmtOrt') + '\n' + parca('renderGecmisUzak') + '\nvar out = renderGecmisUzak();', sandbox);
  return sandbox.out as string;
}

void test('Geçmiş: konu bazlı ortalama kartı 3 gün, 7 gün ve tüm zamanları sırayla karşılaştırır', () => {
  const out = kartCiz({
    examTopicStats: [
      { topic: 'Kredi', avgAsked: 8, avgCorrect: 6, percent: 75, weekAvgAsked: 8, weekAvgCorrect: 6.4, weekPercent: 80, threeDayAvgAsked: 8, threeDayAvgCorrect: 7.2, threeDayPercent: 90 },
      { topic: 'Mali Analiz', avgAsked: 5, avgCorrect: 1.6, percent: 32, weekAvgAsked: 4, weekAvgCorrect: 1.2, weekPercent: 30, threeDayAvgAsked: 4, threeDayAvgCorrect: 1, threeDayPercent: 25 },
      { topic: 'Hukuk', avgAsked: 4, avgCorrect: 2, percent: 50, weekAvgAsked: 4, weekAvgCorrect: 2, weekPercent: 50, threeDayAvgAsked: 4, threeDayAvgCorrect: 2, threeDayPercent: 50 },
    ],
  });
  assert.match(out, /Konu bazlı ortalama/);
  assert.match(out, /Son 3 gün[\s\S]*?Son 7 gün[\s\S]*?Tüm zamanlar/);
  assert.match(out, /Kredi<\/span>[\s\S]*?7,2 \/ 8,0[\s\S]*?color:var\(--good\)[\s\S]*?>↑<\/span>[\s\S]*?6,4 \/ 8,0[\s\S]*?color:var\(--good\)[\s\S]*?>↑<\/span>[\s\S]*?6,0 \/ 8,0/);
  assert.match(out, /Mali Analiz<\/span>[\s\S]*?1,0 \/ 4,0[\s\S]*?color:var\(--bad\)[\s\S]*?>↓<\/span>[\s\S]*?1,2 \/ 4,0[\s\S]*?color:var\(--bad\)[\s\S]*?>↓<\/span>[\s\S]*?1,6 \/ 5,0/);
  assert.match(out, /Hukuk<\/span>[\s\S]*?2,0 \/ 4,0[\s\S]*?color:var\(--text-muted\)[\s\S]*?>→<\/span>[\s\S]*?2,0 \/ 4,0[\s\S]*?color:var\(--text-muted\)[\s\S]*?>→<\/span>[\s\S]*?2,0 \/ 4,0/);
  assert.doesNotMatch(out, /bar-track|bar-fill|%75/);
  assert.match(out, /class="konu-ortalama-satir"/);
});

void test('Geçmiş: konu ortalaması sütun başlıkları değerlerle aynı eksende durur', (t) => {
  const chrome = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((yol): yol is string => Boolean(yol && existsSync(yol)));
  if (!chrome) return t.skip('Yerleşim testi için Chrome/Chromium bulunamadı');

  const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)![1];
  const gecici = mkdtempSync(join(tmpdir(), 'konu-ortalama-'));
  const dosya = join(gecici, 'index.html');
  writeFileSync(dosya, `<!doctype html><style>${css}</style><main style="width:800px">
    <div class="konu-ortalama-baslik"><span class="konu-ortalama-konu">Ders</span><span class="konu-ortalama-deger">Son 3 gün</span><span></span><span class="konu-ortalama-deger">Son 7 gün</span><span></span><span class="konu-ortalama-deger">Tüm zamanlar</span></div>
    <div class="konu-ortalama-satir"><span class="konu-ortalama-konu">Kredi</span><span class="konu-ortalama-deger">5,2 / 8,0</span><span class="konu-ortalama-ok">↓</span><span class="konu-ortalama-deger">6,0 / 8,0</span><span class="konu-ortalama-ok">↓</span><span class="konu-ortalama-deger">6,2 / 8,0</span></div>
    <script>const merkezler=s=>[...document.querySelectorAll(s)].map(e=>{const r=e.getBoundingClientRect();return r.x+r.width/2});const b=merkezler('.konu-ortalama-baslik .konu-ortalama-deger');const d=merkezler('.konu-ortalama-satir .konu-ortalama-deger');document.body.dataset.sapma=Math.max(...b.map((x,i)=>Math.abs(x-d[i]))).toFixed(2)</script>`);
  try {
    const sonuc = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--dump-dom', pathToFileURL(dosya).href], { encoding: 'utf8' });
    const sapma = Number(sonuc.match(/data-sapma="([\d.]+)"/)![1]);
    assert.ok(sapma < 0.5, `başlık ve değer eksenleri arasında ${sapma}px sapma var`);
  } finally {
    rmSync(gecici, { recursive: true, force: true });
  }
});

void test('Geçmiş özeti toplam kartı olmadan 3 gün, 7 gün ve tüm zamanları sırayla gösterir', () => {
  const out = gecmisCiz({
    count: 21, avgCorrect: 35.5, avgSeconds: 600, weekCount: 5, weekAvgCorrect: 38.25,
    threeDayCount: 2, threeDayAvgCorrect: 40.45,
  });
  assert.match(out, /40,5\/50[\s\S]*?Son 3 gün · 2 deneme[\s\S]*?38,3\/50[\s\S]*?Son 7 gün · 5 deneme[\s\S]*?35,5\/50[\s\S]*?Tüm zamanlar · 21 deneme/);
  assert.doesNotMatch(out, /Toplam deneme/);
  assert.match(out, /class="lbl tum-zamanlar-etiket">Tüm zamanlar · 21 deneme/);
});

void test('Geçmiş: dönem verisi yoksa tire gösterir ve karşılaştırma oku göstermez', () => {
  const out = kartCiz({
    examTopicStats: [
      { topic: 'Kambiyo', asked: 8, correct: 4, avgAsked: 4, avgCorrect: 2, percent: 50, weekPercent: null, threeDayPercent: null },
    ],
  });
  assert.doesNotMatch(out, /[↑↓→]/);
  assert.match(out, /Kambiyo<\/span>[\s\S]*?>—<\/span>[\s\S]*?>—<\/span>[\s\S]*?2,0 \/ 4,0/);
});

void test('Geçmiş ekranı ayrı geri düğmesi yerine ana ekranla aynı üst çubuğu kullanır', () => {
  const render = script.match(/function renderGecmisUzak\(\) \{[\s\S]*?^  \}/m)![0];
  assert.match(render, /return ustBarHtml\(\) \+/);
  assert.doesNotMatch(render, /data-action="open-menu-deneme"/);
});

void test('Geçmiş: deneme tarihçesi satırında puan yalnız doğru / toplam, yüzde yok', () => {
  const render = script.match(/function renderGecmisUzak\(\) \{[\s\S]*?^  \}/m)![0];
  assert.match(render, /var skorTxt = a\.score \? \(a\.score\.correct \+ " \/ " \+ toplam\) : "—";/);
  assert.doesNotMatch(render, /score\.percent/);
});

void test('Geçmiş: veri yokken konu kartı hiç basılmaz', () => {
  assert.equal(kartCiz({ examTopicStats: [] }), '');
  assert.equal(kartCiz(null), '');
});

void test('Geçmiş ekranı kartı özet ile deneme listesi arasına koyar', () => {
  const render = script.match(/function renderGecmisUzak\(\) \{[\s\S]*?^  \}/m)![0];
  assert.ok(render.indexOf('ozetHtml +') !== -1 && render.indexOf('konuHtml +') !== -1);
  assert.ok(render.indexOf('ozetHtml +') < render.indexOf('konuHtml +'));
  assert.ok(render.indexOf('konuHtml +') < render.indexOf('Henüz tamamlanmış resmi deneme yok'));
});
