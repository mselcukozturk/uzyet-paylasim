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

void test('ders altındaki Karışık: Rastgele Soru havuzu yalnız o ders', () => {
  const context: Record<string, unknown> = {
    PRATIK_TUM_MODULLER: '__TUMU__',
    STATE: {
      flags: { x: { kapsamDisi: true } },
      bank: [],
      practiceBank: [
        { guid: 'k', konu: 'Kredi', modul: 'M1' }, { guid: 'x', konu: 'Kredi', modul: 'M1' },
        { guid: 'h', konu: 'Hukuk', modul: 'M1' },
      ],
    },
  };
  vm.createContext(context);
  vm.runInContext([grab('pratikKapsamDisiMi'), grab('pratikHavuz'), grab('flashHavuzu')].join('\n'), context);
  const fh = vm.runInContext('flashHavuzu', context) as (k: string, f: string | null) => Soru[];
  const guids = (f: string | null) => fh('practice', f).map((q) => q.guid);
  assert.deepEqual(guids('Kredi'), ['k']);
  assert.deepEqual(guids(null), ['k', 'h']);
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

void test('Konu Konu Bak kuyruğu görülmemiş ve yanlışları öne alır, yakın zamanda görüleni geriye atar', () => {
  const context: Record<string, unknown> = {
    STATE: {
      stats: {
        eskiYanlis: { sonSonucDogruMu: false, sonGorulme: '2026-08-01T00:00:00Z' },
        yeniYanlis: { sonSonucDogruMu: false, sonGorulme: '2026-09-14T00:00:00Z' },
        eskiDogru: { sonSonucDogruMu: true, sonGorulme: '2026-07-01T00:00:00Z' },
        yeniDogru: { sonSonucDogruMu: true, sonGorulme: '2026-09-13T00:00:00Z' },
      },
      pStats: {},
    },
  };
  vm.createContext(context);
  vm.runInContext([grab('azGorulenSirala'), grab('flashKuyrukOlustur')].join('\n'), context);
  const olustur = vm.runInContext('flashKuyrukOlustur', context) as
    (h: Soru[], k: string, r: () => number) => Soru[];
  const sorular = ['yeniDogru', 'yeniYanlis', 'gorulmemis', 'eskiDogru', 'eskiYanlis'].map((guid) => ({ guid }));
  const sonuc = olustur(sorular, 'bank', () => 0.5).map((q) => q.guid);

  assert.deepEqual(sonuc, ['gorulmemis', 'eskiYanlis', 'yeniYanlis', 'eskiDogru', 'yeniDogru']);
  assert.equal(new Set(sonuc).size, sorular.length, 'bir konu kuyruğunda aynı soru tekrarlanmamalı');
});

void test('istatistik yenilenirken Konu Konu Bak testi eski sırayla başlamaz', () => {
  const start = grab('startFlash');
  assert.match(start, /!remoteBankLoaded/);
  assert.match(start, /remoteLoadBankIfNeeded/);
});

function setupFlashEnv(overrides: Record<string, unknown> = {}) {
  let bannerMsg: string | null = null;
  let bannerIsError = false;
  const context: Record<string, unknown> = {
    STATE: {
      sadeceDeneme: true,
      bank: [],
      practiceBank: [],
      stats: {},
      pStats: {},
    },
    remoteBankLoaded: true,
    remoteGirisTamamMi: () => true,
    remoteLoadBankIfNeeded: (_cb: (applied: boolean) => void) => {},
    showBanner: (msg: string, isError = false) => {
      bannerMsg = msg;
      bannerIsError = isError;
    },
    shuffleSiklarInPlace: (q: unknown) => q,
    render: () => {},
    currentFlash: null,
    VIEW: null,
    Math,
    Date,
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(
    [
      grab('azGorulenSirala'),
      grab('flashKuyrukOlustur'),
      grab('flashHavuzu'),
      grab('startFlash'),
    ].join('\n'),
    context
  );
  return {
    context,
    getBanner: () => ({ msg: bannerMsg, isError: bannerIsError }),
    startFlash: (kaynak: string, konuFiltre: string | null, yalnizYanlis?: boolean) => {
      const fn = vm.runInContext('startFlash', context) as (
        k: string,
        f: string | null,
        y?: boolean
      ) => void;
      return fn(kaynak, konuFiltre, yalnizYanlis);
    },
    getCurrentFlash: () => context.currentFlash as any,
    getView: () => context.VIEW,
  };
}

function setupFlashResultEnv(lastFlashResult: unknown) {
  const context: Record<string, unknown> = {
    lastFlashResult,
    KONU_SIRA: ['Kredi', 'Hukuk'],
    modulAdi: () => '',
    Math,
  };
  vm.createContext(context);
  vm.runInContext(
    [
      grab('escapeHtml'),
      grab('basariNoktaHtml'),
      grab('flashYuzdeHtml'),
      grab('flashSonucKirilimi'),
      grab('renderFlashResult'),
    ].join('\n'),
    context
  );
  return (vm.runInContext('renderFlashResult', context) as () => string)();
}

void test('(a) yalnız-yanlış havuzu yalnız sonSonucDogruMu === false soruları içerir; görülmemiş ve doğru çözülenler dışarıda kalır', () => {
  const env = setupFlashEnv();
  (env.context.STATE as any).bank = [
    { guid: 'yanlis1', konu: 'Kredi' },
    { guid: 'yanlis2', konu: 'Kredi' },
    { guid: 'dogru1', konu: 'Kredi' },
    { guid: 'gorulmemis', konu: 'Kredi' },
    { guid: 'nullStat', konu: 'Kredi' },
    { guid: 'baskaKonuYanlis', konu: 'Hukuk' },
  ];
  (env.context.STATE as any).stats = {
    yanlis1: { sonSonucDogruMu: false },
    yanlis2: { sonSonucDogruMu: false },
    dogru1: { sonSonucDogruMu: true },
    nullStat: { sonSonucDogruMu: null },
    baskaKonuYanlis: { sonSonucDogruMu: false },
  };

  env.startFlash('bank', 'Kredi', true);

  const cf = env.getCurrentFlash();
  assert.ok(cf, 'oturum başlamalı');
  assert.equal(cf.yalnizYanlis, true, 'yalnizYanlis bayrağı true olmalı');
  const guids = cf.gecmis.map((x: { guid: string }) => x.guid);
  assert.deepEqual(guids.sort(), ['yanlis1', 'yanlis2']);
  assert.equal(env.getView(), 'flash');
});

void test('(b) konudaki hiç yanlış yoksa oturum başlamaz, kullanıcıya "Bu konuda yanlış yaptığın soru yok." bannerı gösterilir', () => {
  const env = setupFlashEnv();
  (env.context.STATE as any).bank = [
    { guid: 'dogru1', konu: 'Kredi' },
    { guid: 'gorulmemis', konu: 'Kredi' },
  ];
  (env.context.STATE as any).stats = {
    dogru1: { sonSonucDogruMu: true },
  };

  env.startFlash('bank', 'Kredi', true);

  assert.equal(env.getCurrentFlash(), null, 'oturum başlamamalı');
  assert.notEqual(env.getView(), 'flash', 'görünüm flash olmamalı');
  assert.equal(env.getBanner().msg, 'Bu konuda yanlış yaptığın soru yok.');
  assert.equal(env.getBanner().isError, true);
});

void test('(c) startFlash bank kaynağı yüklenmeden (!remoteBankLoaded) yalnız-yanlış oturumu başlatmaz, istatistik sunucudan yenilenince başlar', () => {
  let loadCallback: ((applied: boolean) => void) | null = null;
  const env = setupFlashEnv({
    remoteBankLoaded: false,
    remoteLoadBankIfNeeded: (cb: (applied: boolean) => void) => {
      loadCallback = cb;
    },
  });
  (env.context.STATE as any).bank = [
    { guid: 'yanlis1', konu: 'Kredi' },
  ];
  (env.context.STATE as any).stats = {
    yanlis1: { sonSonucDogruMu: false },
  };

  env.startFlash('bank', 'Kredi', true);

  assert.equal(env.getCurrentFlash(), null, 'yükleme öncesi oturum başlamamalı');
  assert.equal(env.getBanner().msg, 'Soru geçmişin yenileniyor…');
  assert.ok(loadCallback, 'remoteLoadBankIfNeeded çağrılmış olmalı');

  (env.context as any).remoteBankLoaded = true;
  (loadCallback as (applied: boolean) => void)(true);

  const cf = env.getCurrentFlash();
  assert.ok(cf, 'yenileme sonrası oturum başlamalı');
  assert.equal(cf.yalnizYanlis, true, 'yalnizYanlis korunmalı');
  assert.deepEqual(cf.gecmis.map((x: { guid: string }) => x.guid), ['yanlis1']);
});

void test('(d) Bu Konuda Yeni Oturum düğmesi yalnız-yanlış modunu korur ve start-flash-again üçüncü öznitelik taşır', () => {
  const yanlisHtml = setupFlashResultEnv({
    kaynak: 'bank',
    konuFiltre: 'Kredi',
    yalnizYanlis: true,
    oturum: [{ konu: 'Kredi', dogru: true }],
  });

  assert.match(yanlisHtml, /data-action="start-flash-again"/);
  assert.match(yanlisHtml, /data-yanlis="1"/);
  assert.match(yanlisHtml, /Yanlışları Yeniden Çöz/);
  assert.match(yanlisHtml, /\(Konu Konu Bak — Kredi · yalnız yanlışlar\)/);

  const normalHtml = setupFlashResultEnv({
    kaynak: 'bank',
    konuFiltre: 'Kredi',
    yalnizYanlis: false,
    oturum: [{ konu: 'Kredi', dogru: true }],
  });

  assert.match(normalHtml, /data-action="start-flash-again"/);
  assert.doesNotMatch(normalHtml, /data-yanlis="1"/);
  assert.match(normalHtml, /Bu Konuda Yeni Oturum/);
  assert.match(normalHtml, /\(Konu Konu Bak — Kredi\)/);
  assert.doesNotMatch(normalHtml, /· yalnız yanlışlar/);

  const actionHandler = script.match(/else if \(action === "start-flash-again"\)[\s\S]*?;/)?.[0] ?? '';
  assert.match(actionHandler, /data-yanlis/);
});

void test('(e) mevcut Konu Konu Bak davranışı (yalnız-yanlış KAPALIYKEN tüm konu havuzu, flashKuyrukOlustur sırası) değişmez', () => {
  const env = setupFlashEnv();
  (env.context.STATE as any).bank = [
    { guid: 'yanlis1', konu: 'Kredi' },
    { guid: 'dogru1', konu: 'Kredi' },
    { guid: 'gorulmemis', konu: 'Kredi' },
  ];
  (env.context.STATE as any).stats = {
    yanlis1: { sonSonucDogruMu: false, sonGorulme: '2026-09-01T00:00:00Z' },
    dogru1: { sonSonucDogruMu: true, sonGorulme: '2026-09-02T00:00:00Z' },
  };

  env.startFlash('bank', 'Kredi');

  const cf = env.getCurrentFlash();
  assert.ok(cf);
  assert.equal(!cf.yalnizYanlis, true, 'yalnizYanlis kapalı olmalı');
  const guids = cf.gecmis.map((x: { guid: string }) => x.guid);
  assert.deepEqual(guids, ['gorulmemis', 'yanlis1', 'dogru1']);
});

void test('renderDenemeKonuSec: ders seçenekleri korunur, yanlış yoksa ilgili seçenek devre dışıdır', () => {
  const context: Record<string, unknown> = {
    anaSayfaSekmeleriHtml: () => '',
    tumBankaCalismaHtml: () => '',
    hatirlaticiGuidListesi: () => [],
    cokYanlisGuidListesi: () => [],
    konuTekrarDugmesiHtml: () => '',
    remoteAuth: { isAdmin: false },
    KONU_SIRA: ['Kredi', 'Hukuk'],
    STATE: {
      bank: [
        { guid: 'k1', konu: 'Kredi' },
        { guid: 'k2', konu: 'Kredi' },
        { guid: 'h1', konu: 'Hukuk' },
      ],
      stats: {
        k1: { sonSonucDogruMu: false },
        k2: { sonSonucDogruMu: true },
        h1: { sonSonucDogruMu: true },
      },
    },
    konuSeriIdx: () => 0,
    konuDotHtml: () => '<span class="dot"></span>',
  };
  vm.createContext(context);
  vm.runInContext([grab('escapeHtml'), grab('soruGorulmemisMi'), grab('konuSayaclariHtml'), grab('konuTekrarListesiHtml'), grab('renderDenemeKonuSec')].join('\n'), context);
  const html = (vm.runInContext('renderDenemeKonuSec', context) as () => string)();

  assert.match(html, /data-action="start-deneme-konu-yanlis"[^>]*data-konu="Kredi"/);
  assert.match(html, /data-count="wrong">1</);
  assert.match(html, /data-action="start-deneme-konu-yanlis"[^>]*data-konu="Hukuk" disabled/);
  assert.doesNotMatch(html, /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<button\b/);
});
