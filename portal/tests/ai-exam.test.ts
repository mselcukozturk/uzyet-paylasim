import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// AI Denemesi (Yapay Zekâ Kaynakları) istemcide çalışır: sunucuda oturum açılmaz, kod
// soru listesini taşımaz — aynı seed aynı 50 soruyu yeniden ÜRETİR. Bu testler seçim
// fonksiyonlarını index.html'den çıkarıp gerçekten çalıştırır (kaynak metni eşleştirmek
// yerine), çünkü kırılırsa paylaşılan kod sessizce farklı deneme verir.

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)?.[1] ?? '';
assert.ok(script);

function grab(name: string) {
  const found = script.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  \\}`, 'm'))?.[0];
  assert.ok(found, `${name} bulunamadı`);
  return found;
}

const RESMI_DAGILIM = {
  'Ürünler': 8, 'Hukuk': 8, 'Temel İşlemler': 8, 'Kredi': 8, 'Genel Ekonomi': 5,
  'Mali Analiz': 5, 'Kambiyo': 3, 'Sermaye Piyasaları ve Hazine': 3, 'İK Politikaları': 2,
};

type Soru = { guid: string; konu: string; siklar: string[]; cevapIdx: number; cevapHarf?: string };

function kur() {
  const context: Record<string, unknown> = { Math, JSON, isFinite, parseInt, String };
  vm.createContext(context);
  vm.runInContext([
    grab('mulberry32'), grab('sampleRandom'), grab('aiGuidSirali'),
    grab('pickAiExamQuestions'), grab('aiKoduUret'), grab('aiKoduCoz'),
  ].join('\n'), context);
  return {
    pick: (practiceBank: Soru[], bank: Soru[], seed: number) =>
      vm.runInContext(
        'pickAiExamQuestions(P, B, D, mulberry32(S))',
        Object.assign(context, { P: practiceBank, B: bank, D: RESMI_DAGILIM, S: seed }),
      ) as { sorular: Soru[]; uyarilar: string[] },
    kodUret: () => vm.runInContext('aiKoduUret', context) as (s: number) => string | null,
    kodCoz: () => vm.runInContext('aiKoduCoz', context) as (k: unknown) => number | null,
  };
}

// Canlı havuzun şekli: Kambiyo ve Genel Ekonomi pratik havuzunda HİÇ soru taşımıyor
// (16 Eyl 2026 ölçümü), diğer yedi konu kotanın kat kat üstünde.
function havuzlar() {
  const practiceBank: Soru[] = [];
  const bank: Soru[] = [];
  for (const [konu, kota] of Object.entries(RESMI_DAGILIM)) {
    const pratikAdedi = konu === 'Kambiyo' || konu === 'Genel Ekonomi' ? 0 : kota * 6;
    for (let i = 0; i < pratikAdedi; i += 1) {
      practiceBank.push({ guid: `k_${konu}_${i}`, konu, siklar: ['a', 'b', 'c', 'd'], cevapIdx: 0 });
    }
    for (let i = 0; i < kota * 4; i += 1) {
      bank.push({ guid: `b_${konu}_${i}`, konu, siklar: ['a', 'b', 'c', 'd'], cevapIdx: 0 });
    }
  }
  return { practiceBank, bank };
}

void test('aynı kod aynı 50 soruyu verir; havuzun sırası değişse bile', () => {
  const { pick } = kur();
  const { practiceBank, bank } = havuzlar();
  const seed = 1234567;

  // vm bağlamından dönen diziler farklı realm'e ait — karşılaştırmadan önce kopyalanır.
  const guidler = (r: { sorular: Soru[] }) => [...r.sorular].map((q) => q.guid);

  const ilk = pick(practiceBank, bank, seed);
  assert.equal(ilk.sorular.length, 50);
  assert.equal(ilk.uyarilar.length, 0);

  // Sunucu "practice-bank"/"bank" uçlarını ORDER BY'sız döndürüyor: Postgres satır sırası
  // iki cihazda farklı gelebilir. pickAiExamQuestions guid'e göre sıraladığı için sonuç
  // değişmemeli — bu koruma kalkarsa paylaşılan kod bozulur.
  const karisik = pick([...practiceBank].reverse(), [...bank].reverse(), seed);
  assert.deepEqual(
    guidler(karisik),
    guidler(ilk),
    'havuz sırası değişince seçim de değişti — guid sıralaması kaybolmuş',
  );

  // Farklı seed farklı deneme vermeli, yoksa "yeni deneme" hep aynı olurdu.
  assert.notDeepEqual(guidler(pick(practiceBank, bank, seed + 1)), guidler(ilk));
});

void test('resmi dağılım tutar; pratikte sorusu olmayan konu bankadan tamamlanır', () => {
  const { pick } = kur();
  const { practiceBank, bank } = havuzlar();
  const { sorular } = pick(practiceBank, bank, 42);

  const sayim: Record<string, number> = {};
  for (const q of sorular) sayim[q.konu] = (sayim[q.konu] ?? 0) + 1;
  assert.deepEqual(sayim, RESMI_DAGILIM);

  // Kambiyo (3) ve Genel Ekonomi (5) yalnız bankadan, diğer her şey yalnız pratikten.
  const bankadan = sorular.filter((q) => q.guid.startsWith('b_'));
  assert.equal(bankadan.length, 8);
  assert.deepEqual(
    [...new Set(bankadan.map((q) => q.konu))].sort(),
    ['Genel Ekonomi', 'Kambiyo'],
  );

  // Mükerrer guid olmamalı: aynı guid iki havuzda da bulunabiliyor (ör. Sermaye Piyasaları
  // setleri Deneme bankasına GUID korunarak kopyalandı).
  assert.equal(new Set(sorular.map((q) => q.guid)).size, 50);
});

void test('bir konu hem pratikte hem bankada eksikse uyarı verilir, çakışan guid iki kez alınmaz', () => {
  const { pick } = kur();
  const practiceBank: Soru[] = [{ guid: 'ortak', konu: 'Kambiyo', siklar: ['a', 'b'], cevapIdx: 0 }];
  // Aynı guid bankada da var: top-up onu tekrar seçmemeli.
  const bank: Soru[] = [{ guid: 'ortak', konu: 'Kambiyo', siklar: ['a', 'b'], cevapIdx: 0 }];
  const { sorular, uyarilar } = pick(practiceBank, bank, 7);

  assert.equal(sorular.length, 1);
  assert.equal(new Set(sorular.map((q) => q.guid)).size, 1);
  assert.ok(uyarilar.some((u) => u.startsWith('Kambiyo:')), `uyarı bekleniyordu: ${uyarilar.join(' · ')}`);
});

void test('AI deneme kodu UZA- önekiyle gidip geri çözülür ve UZY- kodunu kabul etmez', () => {
  const ctx = kur();
  const uret = ctx.kodUret();
  const coz = ctx.kodCoz();

  for (const seed of [0, 1, 1234567, 0xFFFFFFFF]) {
    const kod = uret(seed);
    assert.ok(kod?.startsWith('UZA-'), `beklenen önek UZA-, gelen: ${kod}`);
    assert.equal(coz(kod), seed >>> 0);
    assert.equal(coz(` ${kod!.toLowerCase()} `), seed >>> 0, 'küçük harf/boşluklu yapıştırma çalışmalı');
  }

  // Resmi deneme kodu (UZY-R…) buraya girilirse sessizce yanlış bir denemeye dönüşmemeli.
  assert.equal(coz('UZY-R1K2M3'), null);
  assert.equal(coz(''), null);
  assert.equal(coz('UZA-'), null);
  assert.equal(coz('UZA-!!'), null);
});

void test('AI denemesi ekranları bağlı: Test menüsünde kart + kod, deneme sürerken çıkış yalnız onaylı', () => {
  const menuTest = script.match(/^  function renderMenuTest\(\)[\s\S]*?^  \}/m)?.[0];
  assert.ok(menuTest, 'renderMenuTest bulunamadı');
  assert.match(menuTest, /data-action="prepare-ai-exam"/);
  assert.match(menuTest, /id="ai-exam-code-input"/);
  assert.match(menuTest, /data-action="start-ai-exam-code"/);
  assert.ok(menuTest.includes('aiDenemeHtml +'), 'AI deneme kartı ekrana eklenmemiş');

  // Her data-action hem HTML'de basılıyor hem de tıklama dağıtıcısında karşılanıyor olmalı.
  for (const action of ['prepare-ai-exam', 'baslat-ai-exam-kod-onizleme', 'cancel-ai-exam-kod-onizleme',
    'start-ai-exam-code', 'ai-exam-vazgec']) {
    assert.equal(script.split(`"${action}"`).length - 1, 2, `${action}: basım + işleyici çifti eksik`);
  }

  // Deneme sürerken "Kaydet ve Çık" yerine iki adımlı Vazgeç çıkar (yarım kalan kaydı yok).
  const exam = script.match(/^  function renderExam\(\)[\s\S]*?^  \}/m)?.[0];
  assert.ok(exam, 'renderExam bulunamadı');
  assert.match(exam, /currentExam\.ai[\s\S]*?data-action="ai-exam-vazgec"/);
  assert.match(exam, /aiVazgecOnay \? "primary" : "ghost"/);

  // Üst çubuk (🏠/📊 → leaveAiSources) AI denemesi sürerken basılmamalı: yarım denemeyi
  // sessizce düşürürdü.
  const render = script.match(/^  function render\(\)[\s\S]*?^  \}/m)?.[0];
  assert.ok(render, 'render bulunamadı');
  assert.match(render, /aiModu && VIEW === "exam" && currentExam && currentExam\.ai/);

  // Sonuç ekranındaki kod açıklaması AI denemesinde Deneme sayfasını işaret etmemeli.
  const result = script.match(/^  function renderResult\(\)[\s\S]*?^  \}/m)?.[0];
  assert.ok(result, 'renderResult bulunamadı');
  assert.match(result, /var koduAciklama = r\.ai\s*\n\s*\? 'Bu kodu Yapay Zek/);
});

void test('AI denemesi istatistiği yalnız pratik havuzuna yazar, yarım kalan kaydı tutmaz', () => {
  const finish = script.match(/^  function finishAiExam\(\)[\s\S]*?^  \}/m)?.[0];
  assert.ok(finish, 'finishAiExam bulunamadı');

  // Bankadan tamamlanan sorular question_stats'a yazılsaydı resmi Deneme'nin genel
  // doğruluk oranı bozulurdu (portal/CLAUDE.md, "İki istatistik havuzu — neden ayrı").
  assert.ok(finish.includes('pratikGuid[guid]'), 'bankadan gelen sorular elenmiyor');
  assert.ok(finish.includes('recordPratikStat('), 'pratik istatistiği yazılmıyor');
  assert.match(finish, /STATE\.practiceBank\.forEach/);
  assert.ok(!finish.includes('STATE.stats'), 'finishAiExam question_stats tarafına yazıyor');
  assert.ok(!finish.includes('STATE.history'), 'AI denemesi geçmişe yazılmamalı');

  // Yarım kalan kaydı yok: AI denemesi STATE.pausedExam'a hiç dokunmamalı.
  const start = script.match(/^  function startAiExam\([\s\S]*?^  \}/m)?.[0];
  assert.ok(start, 'startAiExam bulunamadı');
  assert.ok(!start.includes('pausedExam'), 'startAiExam yarım kalan slotuna yazıyor');
  assert.ok(!finish.includes('pausedExam'), 'finishAiExam yarım kalan slotuna dokunuyor');

  // Kotalar kullanıcıya göre değişen STATE.settings.dagilim'dan değil sabit tablodan
  // okunmalı; aksi halde aynı kod iki hesapta farklı deneme üretir.
  assert.ok(start.includes('RESMI_DAGILIM_DEFAULT'), 'AI denemesi resmi dağılımı kullanmıyor');
  assert.ok(!start.includes('settings.dagilim'), 'AI denemesi kullanıcıya özel dağılımı kullanıyor');
});
