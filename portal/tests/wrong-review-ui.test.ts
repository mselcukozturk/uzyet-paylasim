import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script id="app-script">([\s\S]*?)<\/script>/);
const stateMatch = html.match(/<script id="app-state" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(scriptMatch);
assert.ok(stateMatch);
const script = scriptMatch[1];
const state = JSON.parse(stateMatch[1]);

void test('üretilen deneme kabuğunun JavaScript sözdizimi geçerlidir ve soru taşımaz', () => {
  assert.doesNotThrow(() => new vm.Script(script));
  assert.deepEqual(state.bank, []);
  assert.deepEqual(state.practiceBank, []);
});

void test('tekrar testi karışık başlar ve doğru cevap hatırlatıcı işaretini kaldırmaz', () => {
  const start = script.match(/function startTekrarTest\(tur, havuz\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const select = script.match(/function selectTekrarOption\(idx\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  assert.match(start, /sampleRandom\(guids, guids\.length\)/);
  assert.match(start, /shuffleSiklarInPlace/);
  assert.doesNotMatch(select, /remoteReminderGuids|remoteFlagSync/);
});

void test('tekrar testi Rastgele Soru mekaniğini kullanır: ileri/geri gezinme ve Testi Bitir', () => {
  const render = script.match(/function renderTekrarTest\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  // Rastgele Soru ile aynı düzen: üstte Testi Bitir, altta Önceki/Sonraki Soru.
  assert.match(render, /data-action="finish-tekrar-test"/);
  assert.match(render, /data-action="prev-tekrar-soru"/);
  assert.match(render, /data-action="next-tekrar-soru"/);
  assert.match(render, /sticky-next-bar/);
  assert.match(render, /data-action="tekrar-cik"/);
  assert.doesNotMatch(render, /\(cevaplanan\s*\?[\s\S]*data-action="finish-tekrar-test"[\s\S]*data-action="tekrar-cik"/,
    'çık ve testi bitir aynı anda görünmeli');
  // Geri dönünce verilen cevap korunur: cevap kuyruk kaydında tutulur, tek tek sıfırlanmaz.
  const next = script.match(/function nextTekrarSoru\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const prev = script.match(/function prevTekrarSoru\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  assert.doesNotMatch(next, /secilen = null/);
  assert.match(prev, /currentTekrar\.konum--/);
  // 🔖 Hatırlatıcı / 🚩 hatalı bildirimi her iki tekrar turunda da, cevaplamadan önce
  // de görünür — hatırlatıcı turu salt gözden geçirme olduğu için işaret kaldırılabilmeli.
  assert.match(render, /flagBarHtml\(kayit\.guid\)/);
  assert.doesNotMatch(render, /answered \? flagBarHtml/);
  // Oturum, Rastgele Soru gibi ders kırılımlı bir özetle biter.
  const finish = script.match(/function finishTekrarTest\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  assert.match(finish, /VIEW = "tekrarSonuc"/);
  assert.match(script, /function renderTekrarSonuc\(\)[\s\S]*?flashSonucKirilimi\(oturum\)/);
  // Her iki tekrar turu da aynı motoru kullanır.
  assert.match(script, /action === "start-hatirlatici-test"\) startTekrarTest\("hatirlatici",/);
  assert.match(script, /action === "start-yanlis-tekrar-test"\) startTekrarTest\("yanlis",/);
});

void test('yanlış sorular hatırlatıcıların altında gösterilir ve cevap sunucuya kaydedilir', () => {
  const menu = script.match(/function renderMenuDeneme\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  assert.ok(menu.indexOf('hatirlaticiBolumHtml("deneme")') < menu.indexOf('yanlisSorularBolumHtml("deneme")'));
  assert.match(script, /action: "wrong-questions"/);
  assert.match(script, /action: "wrong-question-answer", questionGuid: kayit\.guid, selectedAnswer: q\.siklar\[kayit\.secilen\]/);
  assert.match(script, /if \(r\.data && r\.data\.guids\) remoteWrongGuids = r\.data\.guids/);
  // Sunucuya yalnız yanlış turu yazar; hatırlatıcı turu salt gözden geçirmedir.
  const turler = script.match(/var TEKRAR_TUR = \{[\s\S]*?^  \};/m)?.[0] ?? '';
  assert.match(turler, /hatirlatici: \{[\s\S]*?kaydeder: false/);
  assert.match(turler, /yanlis: \{[\s\S]*?kaydeder: true/);
});

void test('resmî istatistiği değiştiren işlemler Konu Konu Bak geçmişini yeniler', () => {
  const finish = script.match(/function finishExamRemote\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const remove = script.match(/function confirmDeleteGecmis\(id\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const wrong = script.match(/function tekrarCevapKaydet\(kayit\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  assert.match(finish, /remoteRefreshStudyStats\(\)/);
  assert.match(remove, /remoteRefreshStudyStats\(\)/);
  assert.match(wrong, /remoteRefreshStudyStats\(\)/);
});

void test('Rastgele Soru üstünde çıkış ve testi bitirme ayrı kontrollerdir', () => {
  const render = script.match(/function renderFlash\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  assert.match(render, /data-action="finish-flash"/);
  assert.doesNotMatch(render, /\(currentFlash\.oturum\.length\s*\?[\s\S]*data-action="finish-flash"[\s\S]*data-action="' \+ geriAction/,
    'çıkış cevaptan sonra kaybolmamalı');
});

void test('Deneme ve AI kartları aynı motoru ayrı havuzlarla kullanır', () => {
  const denemeMenu = script.match(/function renderMenuDeneme\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const aiMenu = script.match(/function renderMenuTest\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const start = script.match(/function startTekrarTest\(tur, havuz\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const finishAi = script.match(/function finishAiExam\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const kaydet = script.match(/function tekrarCevapKaydet\(kayit\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const flagBar = script.match(/function flagBarHtml\(guid, showPratikExtras\) \{[\s\S]*?^  \}/m)?.[0] ?? '';

  assert.match(denemeMenu, /hatirlaticiBolumHtml\("deneme"\)[\s\S]*yanlisSorularBolumHtml\("deneme"\)/);
  assert.match(aiMenu, /hatirlaticiBolumHtml\("ai"\)[\s\S]*yanlisSorularBolumHtml\("ai"\)/);
  assert.match(start, /currentTekrar = \{[\s\S]*havuz: havuz/);
  assert.match(script, /startTekrarTest\("hatirlatici", t\.getAttribute\("data-havuz"\)\)/);
  assert.match(script, /startTekrarTest\("yanlis", t\.getAttribute\("data-havuz"\)\)/);
  assert.match(finishAi, /recordPratikStat\(guid, dogru/);
  assert.doesNotMatch(finishAi, /if \(pratikGuid\[guid\]\) recordPratikStat/);
  assert.match(kaydet, /currentTekrar\.havuz === "ai"/);
  // Geçmişten açılan AI denemesinde aiModu kapalıdır; işaret yine AI ad alanına yazılır.
  assert.match(flagBar, /var aiKaydi = aiModu \|\| \(VIEW === "result" && lastResult && lastResult\.ai\)/);
  assert.match(flagBar, /aiKaydi \? aiHatirlaticiAnahtari\(guid\) : guid/);
  assert.match(flagBar, /data-guid="' \+ hatirlaticiGuid \+ '" data-kind="hatirlatici"/);
});

void test('Deneme ve AI hatırlatıcı/yanlış listeleri birbirine karışmaz', () => {
  const ctx: Record<string, unknown> = {
    STATE: {
      bank: [{ guid: 'official' }, { guid: 'fallback' }],
      practiceBank: [{ guid: 'ai_question' }, { guid: 'legacy_ai' }],
      flags: {},
      pStats: {
        ai_question: { sonSonucDogruMu: false },
        fallback: { sonSonucDogruMu: false },
      },
      aiYanlisGuidler: ['legacy_ai'],
    },
    remoteReminderGuids: ['official', 'legacy_ai', 'ai:fallback'],
    remoteWrongGuids: ['official'],
    String,
  };
  vm.createContext(ctx);
  vm.runInContext([
    script.match(/function hatirlaticiSoruBul\(guid\) \{[\s\S]*?^  \}/m)?.[0],
    script.match(/function pratikGuidMi\(guid\) \{.*\}/)?.[0],
    script.match(/function aiFlagGuidCoz\(guid\) \{.*\}/)?.[0],
    script.match(/function aiFlagMi\(guid\) \{.*\}/)?.[0],
    script.match(/function aiHatirlaticiAnahtari\(guid\) \{[\s\S]*?^  \}/m)?.[0],
    script.match(/function guidBirlestir\(uzak, yerel\) \{[\s\S]*?^  \}/m)?.[0],
    script.match(/function denemeHatirlaticiGuidListesi\(\) \{[\s\S]*?^  \}/m)?.[0],
    script.match(/function aiHatirlaticiGuidListesi\(\) \{[\s\S]*?^  \}/m)?.[0],
    script.match(/function denemeYanlisGuidListesi\(\) \{[\s\S]*?^  \}/m)?.[0],
    script.match(/function aiYanlisGuidListesi\(\) \{[\s\S]*?^  \}/m)?.[0],
  ].join('\n'), ctx);

  const list = (expression: string) => Array.from(vm.runInContext(expression, ctx) as string[]).sort().join(',');
  assert.equal(list('denemeHatirlaticiGuidListesi()'), 'official');
  assert.equal(list('aiHatirlaticiGuidListesi()'), 'fallback,legacy_ai');
  assert.equal(list('denemeYanlisGuidListesi()'), 'official');
  assert.equal(list('aiYanlisGuidListesi()'), 'ai_question,fallback,legacy_ai');
  assert.equal(vm.runInContext("aiHatirlaticiAnahtari('fallback')", ctx), 'ai:fallback');
});
