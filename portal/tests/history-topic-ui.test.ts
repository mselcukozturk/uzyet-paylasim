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

void test('Geçmiş: konu bazlı ortalama kartı ortalama doğru/soru ve yüzdeyi basar', () => {
  const out = kartCiz({
    examTopicStats: [
      { topic: 'Kredi', asked: 16, correct: 12, avgAsked: 8, avgCorrect: 6, percent: 75 },
      { topic: 'Mali Analiz', asked: 10, correct: 3, avgAsked: 5, avgCorrect: 1.55, percent: 30 },
    ],
  });
  assert.match(out, /Konu bazlı ortalama/);
  assert.match(out, /Kredi<\/span>[\s\S]*?6,0 \/ 8,0/);
  assert.match(out, /Mali Analiz<\/span>[\s\S]*?1,6 \/ 5,0/);
  assert.match(out, /%75/);
  assert.match(out, /var\(--bad\)/);
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
