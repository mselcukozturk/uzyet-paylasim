import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)?.[1] ?? '';
assert.ok(script);

function grab(name: string) {
  const found = script.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  \\}`, 'm'))?.[0];
  assert.ok(found, `${name} bulunamadı`);
  return found;
}

type Stat = { sonSonucDogruMu: boolean | null };
type Soru = { guid: string };

// Rastgele Soru seçimini gerçekten çalıştırır (kaynak metni eşleştirmek yerine).
function kur(stats: Record<string, Stat>) {
  const context: Record<string, unknown> = { STATE: { pStats: stats, stats: {} }, Math };
  vm.createContext(context);
  vm.runInContext([grab('weightedOrder'), grab('soruAgirligi'), grab('flashSecimYap')].join('\n'), context);
  return (havuz: Soru[], haric: string[] = []) =>
    (vm.runInContext('flashSecimYap', context) as (h: Soru[], k: string, e: string[]) => Soru)(havuz, 'practice', haric);
}

const havuz: Soru[] = Array.from({ length: 20 }, (_, i) => ({ guid: `q${i}` }));

void test('doğru çözülmüş sorular, görülmemiş/yanlış havuzu tükenmeden gelmez', () => {
  const stats: Record<string, Stat> = {};
  // q0–q14 doğru çözülmüş, q15 yanlış, q16–q19 hiç görülmemiş.
  for (let i = 0; i < 15; i += 1) stats[`q${i}`] = { sonSonucDogruMu: true };
  stats.q15 = { sonSonucDogruMu: false };
  const sec = kur(stats);

  const gelenler = new Set<string>();
  for (let i = 0; i < 400; i += 1) gelenler.add(sec(havuz).guid);

  for (const guid of gelenler) {
    assert.notEqual(stats[guid]?.sonSonucDogruMu, true, `${guid} doğru çözülmüştü, öncelikli havuz doluyken gelmemeliydi`);
  }
  // Öncelikli havuzun tamamı erişilebilir kalır: yanlış olan da, hiç görülmemişler de.
  assert.ok(gelenler.has('q15'), 'yanlış yapılan soru öncelikli havuzda olmalı');
  assert.ok(['q16', 'q17', 'q18', 'q19'].every((g) => gelenler.has(g)), 'hiç görülmemişlerin hepsi gelebilmeli');
});

void test('öncelikli havuz tükenince doğru çözülmüşlere düşülür', () => {
  const stats: Record<string, Stat> = {};
  for (const q of havuz) stats[q.guid] = { sonSonucDogruMu: true };
  const secilen = kur(stats)(havuz);
  assert.ok(havuz.some((q) => q.guid === secilen.guid), 'havuz tamamen doğruyken de bir soru dönmeli');
});

void test('oturum içinde gösterilenler (haric) öncelikli havuzdan da elenir', () => {
  const stats: Record<string, Stat> = {};
  for (let i = 0; i < 18; i += 1) stats[`q${i}`] = { sonSonucDogruMu: true };
  // Öncelikli havuz yalnız q18 ve q19; q18 bu oturumda zaten gösterilmiş.
  const sec = kur(stats);
  for (let i = 0; i < 50; i += 1) assert.equal(sec(havuz, ['q18']).guid, 'q19');
});
