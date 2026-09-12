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

void test('ders altındaki Karışık: Rastgele Soru havuzu yalnız o ders (Arşiv\'de o arşiv dersi)', () => {
  const context: Record<string, unknown> = {
    PRATIK_TUM_MODULLER: '__TUMU__', ARSIV_KONU: 'Arşiv', ARSIV_DERSLERI: { Kredi: ['K1'] },
    STATE: {
      flags: { x: { kapsamDisi: true } },
      bank: [],
      practiceBank: [
        { guid: 'k', konu: 'Kredi', modul: 'M1' }, { guid: 'x', konu: 'Kredi', modul: 'M1' },
        { guid: 'h', konu: 'Hukuk', modul: 'M1' },
        { guid: 'a1', konu: 'Arşiv', modul: 'K1' }, { guid: 'a2', konu: 'Arşiv', modul: 'H9' },
      ],
    },
  };
  vm.createContext(context);
  vm.runInContext([grab('pratikKapsamDisiMi'), grab('pratikHavuz'), grab('flashHavuzu')].join('\n'), context);
  const fh = vm.runInContext('flashHavuzu', context) as (k: string, f: string | null) => Soru[];
  const guids = (f: string | null) => fh('practice', f).map((q) => q.guid);
  assert.deepEqual(guids('Kredi'), ['k']);
  assert.deepEqual(guids('__TUMU__@Kredi'), ['a1']);
  assert.deepEqual(guids(null), ['k', 'h', 'a1', 'a2']);
});

void test('pratik oturumu: canlıdan kalkan soru, oturum kopyasında dursa bile bulunmaz', () => {
  const context: Record<string, unknown> = {
    STATE: { practiceBank: [{ guid: 'canli' }] },
    currentPratik: { soruKayitlari: { canli: { guid: 'canli' }, silinmis: { guid: 'silinmis' } } },
  };
  vm.createContext(context);
  vm.runInContext([grab('oturumSorusu'), grab('pratikCanliMi'), grab('pratikSoruBul')].join('\n'), context);
  const bul = vm.runInContext('pratikSoruBul', context) as (g: string) => Soru | undefined;
  assert.equal(bul('canli')?.guid, 'canli');
  assert.equal(bul('silinmis'), undefined);
  // Banka henüz yüklenmemişse kopyaya düşülür; yarım oturum boşalmaz.
  (context.STATE as { practiceBank: Soru[] }).practiceBank = [];
  assert.equal(bul('silinmis')?.guid, 'silinmis');
});

void test('Rastgele Soru özeti: ders içi Karışık modül bazında kırılır', () => {
  const context: Record<string, unknown> = {};
  vm.createContext(context);
  vm.runInContext(grab('flashSonucKirilimi'), context);
  const kirilim = vm.runInContext('flashSonucKirilimi', context) as (o: object[], alan?: string) => Record<string, { konu: string; dogru: number; yanlis: number }>;
  const oturum = [
    { konu: 'Kredi', modul: 'K10', dogru: true }, { konu: 'Kredi', modul: 'K2', dogru: false },
    { konu: 'Kredi', modul: 'K2', dogru: true }, { konu: 'Hukuk', modul: 'H1', dogru: true },
  ];
  const modul = kirilim(oturum, 'modul');
  assert.deepEqual({ ...modul.K2 }, { konu: 'Kredi', dogru: 1, yanlis: 1 });
  assert.deepEqual(Object.keys(modul).sort((a, b) => a.localeCompare(b, 'tr', { numeric: true })), ['H1', 'K2', 'K10']);
  // Varsayılan hâlâ ders bazında.
  assert.deepEqual({ ...kirilim(oturum).Kredi }, { konu: 'Kredi', dogru: 2, yanlis: 1 });
});

void test('oturum içinde gösterilenler (haric) öncelikli havuzdan da elenir', () => {
  const stats: Record<string, Stat> = {};
  for (let i = 0; i < 18; i += 1) stats[`q${i}`] = { sonSonucDogruMu: true };
  // Öncelikli havuz yalnız q18 ve q19; q18 bu oturumda zaten gösterilmiş.
  const sec = kur(stats);
  for (let i = 0; i < 50; i += 1) assert.equal(sec(havuz, ['q18']).guid, 'q19');
});
