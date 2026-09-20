import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
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
// deneme başına ortalama doğru / ortalama soru, virgüllü ve tek ondalıklı.
function kartCiz(remoteDash: unknown) {
  const sandbox: Record<string, unknown> = {
    remoteDash,
    escapeHtml: (s: string) => s,
    konuDotHtml: () => '<i></i>',
    renkEsigi: (p: number) => (p >= 70 ? 'var(--good)' : p >= 40 ? 'var(--warn)' : 'var(--bad)'),
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

void test('Geçmiş: konu bazlı ortalama kartı ortalama doğru/soru ve yüzdeyi basar', () => {
  const out = kartCiz({
    examTopicStats: [
      { topic: 'Kredi', asked: 16, correct: 12, avgAsked: 8, avgCorrect: 6, percent: 75, weekPercent: 80 },
      { topic: 'Mali Analiz', asked: 10, correct: 3, avgAsked: 5, avgCorrect: 1.55, percent: 30, weekPercent: 20 },
      { topic: 'Hukuk', asked: 8, correct: 4, avgAsked: 4, avgCorrect: 2, percent: 50, weekPercent: 50 },
    ],
  });
  assert.match(out, /Konu bazlı ortalama/);
  assert.match(out, /Kredi<\/span>[\s\S]*?6,0 \/ 8,0/);
  assert.match(out, /Mali Analiz<\/span>[\s\S]*?1,6 \/ 5,0/);
  assert.match(out, /%75/);
  assert.match(out, /var\(--bad\)/);
  assert.match(out, /Kredi<\/span>[\s\S]*?color:var\(--good\)[\s\S]*?>↑<\/span>/);
  assert.match(out, /Mali Analiz<\/span>[\s\S]*?color:var\(--bad\)[\s\S]*?>↓<\/span>/);
  assert.match(out, /Hukuk<\/span>[\s\S]*?color:var\(--text-muted\)[\s\S]*?>→<\/span>/);
  // Uzun konu adında sağdaki sayılar kaymasın: kolonlar içeriğe bağlı (auto) değil, her satırda aynı.
  assert.match(out, /grid-template-columns:minmax\(0,2fr\) minmax\(0,1fr\) 9\.5ch 4\.5ch/);
  assert.doesNotMatch(out, /grid-template-columns:[^;"]*auto/);
});

void test('Geçmiş özeti genel ortalamanın yanında son 7 gün ortalamasını gösterir', () => {
  const out = gecmisCiz({
    count: 12, avgCorrect: 35.5, avgSeconds: 600, weekCount: 3, weekAvgCorrect: 38.25,
  });
  assert.match(out, /35,5\/50[\s\S]*?Tüm zamanlar · 12 deneme/);
  assert.match(out, /38,3\/50[\s\S]*?Son 7 gün · 3 deneme/);
});

void test('Geçmiş: son 7 günde ders verisi yoksa karşılaştırma oku göstermez', () => {
  const out = kartCiz({
    examTopicStats: [
      { topic: 'Kambiyo', asked: 8, correct: 4, avgAsked: 4, avgCorrect: 2, percent: 50, weekPercent: null },
    ],
  });
  assert.doesNotMatch(out, /[↑↓→]/);
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
