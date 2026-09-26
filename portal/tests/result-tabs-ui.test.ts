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

function degisken(ad: string) {
  const re = new RegExp('var\\s+' + ad + '\\s*=[\\s\\S]*?;');
  const m = script.match(re);
  assert.ok(m, ad + ' bulunamadı');
  return m[0];
}

interface FakeQuestion {
  guid: string;
  konu: string;
  soru: string;
  siklar: string[];
  cevapIdx: number;
  aciklama?: string;
  kaynak?: string;
  dogrulanmis?: boolean;
}

function renderResultCalistir(lastResult: unknown, sonucSekmesi: string = 'yanlislar') {
  const sandbox: Record<string, unknown> = {
    lastResult,
    sonucSekmesi,
    STATE: {
      bank: [],
      sadeceDeneme: false,
    },
    KONU_SIRA: [
      'Ürünler',
      'Hukuk',
      'Temel İşlemler',
      'Kredi',
      'Genel Ekonomi',
      'Mali Analiz',
      'Kambiyo',
      'Sermaye Piyasaları ve Hazine',
      'İK Politikaları',
    ],
    remoteDash: null,
    aiGunun: null,
    escapeHtml: (s: string) => s,
    soruHtml: (s: string) => s,
    konuDotHtml: (konu: string) => `<i class="dot">${konu}</i>`,
    flagBarHtml: (guid: string) => `<div class="flags">${guid}</div>`,
    fmtSure: (s: number) => s + ' sn',
    renkEsigi: () => 'inherit',
    examKoduUret: () => 'KOD123',
    gununDenemesiOrtalamaHtml: () => '',
  };
  vm.createContext(sandbox);
  vm.runInContext(
    parca('oturumSorusu') + '\n' +
    parca('renderResult') + '\n' +
    'var out = renderResult();',
    sandbox
  );
  return sandbox.out as string;
}

void test('1. konuKisaAdi ve soruUstBlokHtml: kısa ad ve title özniteliği', () => {
  const sandbox: Record<string, unknown> = {
    escapeHtml: (s: string) => s,
    konuDotHtml: (k: string) => `<i>${k}</i>`,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    degisken('KONU_KISA_AD') + '\n' +
    parca('konuKisaAdi') + '\n' +
    parca('soruUstBlokHtml'),
    sandbox
  );

  const konuKisaAdi = sandbox.konuKisaAdi as (k: string) => string;
  assert.equal(konuKisaAdi('Sermaye Piyasaları ve Hazine'), 'Sermaye Piy.');
  assert.equal(konuKisaAdi('Temel İşlemler'), 'Temel İşl.');
  assert.equal(konuKisaAdi('İK Politikaları'), 'İK Pol.');
  assert.equal(konuKisaAdi('Genel Ekonomi'), 'Genel Ekon.');
  assert.equal(konuKisaAdi('Mali Analiz'), 'Mali Analiz');
  assert.equal(konuKisaAdi('Bilinmeyen Konu'), 'Bilinmeyen Konu');

  const soruUstBlokHtml = sandbox.soruUstBlokHtml as (
    konu: string,
    sayac: string,
    metaHtml: string,
    aksiyonHtml: string
  ) => string;
  const out = soruUstBlokHtml('Sermaye Piyasaları ve Hazine', '1 / 50', '', '');
  assert.match(out, /title="Sermaye Piyasaları ve Hazine"/);
  assert.match(out, />Sermaye Piy\.</);
  assert.match(out, /<span class="ust-sayac">1 \/ 50<\/span>/);
});

void test('2. renderResult sekmeler: Yanlışlar vs Tüm Sorular (konu konu)', () => {
  const fakeQuestions: Record<string, FakeQuestion> = {
    q1: {
      guid: 'q1',
      konu: 'Mali Analiz',
      soru: 'Mali Analiz 1. soru metni',
      siklar: ['Cevap A', 'Cevap B'],
      cevapIdx: 0,
    },
    q2: {
      guid: 'q2',
      konu: 'Kredi',
      soru: 'Kredi 2. soru metni',
      siklar: ['Cevap A', 'Cevap B'],
      cevapIdx: 0,
    },
    q3: {
      guid: 'q3',
      konu: 'Kredi',
      soru: 'Kredi 3. soru metni',
      siklar: ['Cevap A', 'Cevap B'],
      cevapIdx: 1,
    },
  };

  const fakeResult = {
    id: 'test-attempt',
    examCode: 'TEST123',
    tip: 'rastgele',
    skor: { dogru: 1, yanlis: 1, bos: 1 },
    konuKirilim: {
      'Mali Analiz': { dogru: 1, yanlis: 0, bos: 0 },
      'Kredi': { dogru: 0, yanlis: 1, bos: 1 },
    },
    sorular: ['q1', 'q2', 'q3'],
    cevaplar: {
      q1: 0, // Doğru
      q2: 1, // Yanlış
      // q3 Boş
    },
    soruKayitlari: fakeQuestions,
    sureSaniye: 120,
  };

  // Varsayılan sekme: 'yanlislar'
  const outYanlislar = renderResultCalistir(fakeResult, 'yanlislar');
  assert.match(outYanlislar, /Yanlışlar \(2\)/);
  assert.match(outYanlislar, /Tüm Sorular \(3\)/);
  assert.doesNotMatch(outYanlislar, /Mali Analiz 1\. soru metni/);
  assert.match(outYanlislar, /Kredi 2\. soru metni/);
  assert.match(outYanlislar, /Kredi 3\. soru metni/);

  // 'tum' sekmesi
  const outTum = renderResultCalistir(fakeResult, 'tum');
  assert.match(outTum, /Mali Analiz 1\. soru metni/);
  assert.match(outTum, /Kredi 2\. soru metni/);
  assert.match(outTum, /Kredi 3\. soru metni/);

  // Konu başlıkları KONU_SIRA sırasıyla: Kredi Mali Analiz'den önce gelmeli
  const gozdenGecirKarti = outTum.slice(outTum.indexOf('Gözden geçir'));
  const krediPos = gozdenGecirKarti.indexOf('Kredi');
  const maliPos = gozdenGecirKarti.indexOf('Mali Analiz');
  assert.ok(krediPos !== -1 && maliPos !== -1 && krediPos < maliPos, 'Kredi Mali Analizden önce gelmeli');

  // Konu başlığında d doğru / t soru
  assert.match(outTum, /0 doğru \/ 2 soru/);
  assert.match(outTum, /1 doğru \/ 1 soru/);

  // Doğru soru pill good taşır
  assert.match(outTum, /class="pill good"[^>]*>Doğru<\/span>/);

  // Soru numarası denemedeki sırasını taşır
  assert.match(outTum, /Soru 1/);
  assert.match(outTum, /Soru 2/);
  assert.match(outTum, /Soru 3/);
});

void test('3. gecmistenAcildi:true iken sonuc-gecmise-don, yokken back-menu', () => {
  const baseResult = {
    id: 'test-attempt',
    examCode: 'TEST123',
    tip: 'rastgele',
    skor: { dogru: 1, yanlis: 0, bos: 0 },
    konuKirilim: {
      Kredi: { dogru: 1, yanlis: 0, bos: 0 },
    },
    sorular: ['q1'],
    cevaplar: { q1: 0 },
    soruKayitlari: {
      q1: {
        guid: 'q1',
        konu: 'Kredi',
        soru: 'Kredi sorusu',
        siklar: ['A', 'B'],
        cevapIdx: 0,
      },
    },
    sureSaniye: 60,
  };

  const outGecmis = renderResultCalistir({ ...baseResult, gecmistenAcildi: true });
  assert.match(outGecmis, /data-action="sonuc-gecmise-don"/);
  assert.match(outGecmis, /← Geçmişe Dön/);
  assert.doesNotMatch(outGecmis, /data-action="back-menu"/);

  const outYeni = renderResultCalistir({ ...baseResult, gecmistenAcildi: false });
  assert.match(outYeni, /data-action="back-menu"/);
  assert.doesNotMatch(outYeni, /data-action="sonuc-gecmise-don"/);
});

void test('4. index.html event handler ve geçmiş açılışları', () => {
  assert.match(script, /action === "sonuc-gecmise-don"/);
  assert.match(script, /lastResult = null;\s*VIEW = "gecmisUzak";\s*render\(\);/);
  assert.match(script, /action === "select-sonuc-sekmesi"/);
  assert.match(script, /lastResult\.gecmistenAcildi = true;/);
});
