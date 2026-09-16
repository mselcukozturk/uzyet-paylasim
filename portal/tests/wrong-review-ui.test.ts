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
  const start = script.match(/function startTekrarTest\(tur\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
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
  assert.match(script, /action === "start-hatirlatici-test"\) startTekrarTest\("hatirlatici"\)/);
  assert.match(script, /action === "start-yanlis-tekrar-test"\) startTekrarTest\("yanlis"\)/);
});

void test('yanlış sorular hatırlatıcıların altında gösterilir ve cevap sunucuya kaydedilir', () => {
  const menu = script.match(/function renderMenuDeneme\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  assert.ok(menu.indexOf('hatirlaticiBolumHtml()') < menu.indexOf('yanlisSorularBolumHtml()'));
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

// AI denemesinde yapılan yanlışlar ve basılan 🔖 işaretleri de ana ekrandaki iki karta
// akar (kullanıcı isteği, 16 Eyl 2026). Zor yanı: o sorular pratik havuzundan gelebilir,
// question_flags/question_stats ise yalnız Deneme bankasına bağlıdır — bu yüzden liste
// sunucu + yerel birleşimidir ve kayıt yolu guid'in kaynağına göre ayrılır.
void test('AI denemesinin yanlışları ve hatırlatıcıları ana ekrandaki kartlara akar', () => {
  const hatirlaticiKart = script.match(/function hatirlaticiBolumHtml\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const yanlisKart = script.match(/function yanlisSorularBolumHtml\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const turler = script.match(/var TEKRAR_TUR = \{[\s\S]*?^  \};/m)?.[0] ?? '';
  const bul = script.match(/function hatirlaticiSoruBul\(guid\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const finishAi = script.match(/function finishAiExam\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const kaydet = script.match(/function tekrarCevapKaydet\(kayit\) \{[\s\S]*?^  \}/m)?.[0] ?? '';

  // Kartlar ve tekrar turları aynı birleşik havuzu okur — biri sunucu listesine düşerse
  // AI tarafı sessizce görünmez olur.
  assert.match(hatirlaticiKart, /hatirlaticiGuidListesi\(\)/);
  assert.match(yanlisKart, /yanlisGuidListesi\(\)/);
  assert.match(turler, /guidler: hatirlaticiGuidListesi/);
  assert.match(turler, /guidler: yanlisGuidListesi/);
  // Soru metni pratik havuzunda olabilir; yalnız STATE.bank'a bakan sürüm guid'i düşürürdü.
  assert.match(bul, /STATE\.practiceBank/);
  // AI denemesi bittiğinde yanlışlar yerel havuza yazılır, doğrular düşer.
  assert.match(finishAi, /aiYanlisKaydet\(guid, dogru\)/);
  assert.match(finishAi, /if \(pratikGuid\[guid\]\) recordPratikStat/);
  // Sunucudaki yanlış havuzunda olmayan guid wrong-question-answer'a gitmez (409 dönerdi).
  assert.match(kaydet, /if \(!remoteWrongGuids \|\| remoteWrongGuids\.indexOf\(kayit\.guid\) === -1\)/);
  assert.match(kaydet, /if \(pratikGuidMi\(kayit\.guid\)\) recordPratikStat/);
});

void test('guid birleştirme mükerrer yazmaz, bulunamayan soruyu eler; pratik guid\'i ayırt edilir', () => {
  const ctx: Record<string, unknown> = {
    STATE: { bank: [{ guid: 'aabbccddeeff' }], practiceBank: [{ guid: 'h_112233445566' }] },
    String,
  };
  vm.createContext(ctx);
  vm.runInContext([
    script.match(/function hatirlaticiSoruBul\(guid\) \{[\s\S]*?^  \}/m)?.[0],
    script.match(/function pratikGuidMi\(guid\) \{.*\}/)?.[0],
    script.match(/function guidBirlestir\(uzak, yerel\) \{[\s\S]*?^  \}/m)?.[0],
  ].join('\n'), ctx);

  const birlesik = vm.runInContext(
    "guidBirlestir(['aabbccddeeff'], ['aabbccddeeff', 'h_112233445566', 'yok'])", ctx,
  ) as string[];
  // vm ayrı realm döndürüyor; deepStrictEqual referansa takılıyor.
  assert.equal(Array.from(birlesik).join(','), 'aabbccddeeff,h_112233445566');
  assert.equal(vm.runInContext("pratikGuidMi('h_112233445566')", ctx), true);
  assert.equal(vm.runInContext("pratikGuidMi('aabbccddeeff')", ctx), false);
});
