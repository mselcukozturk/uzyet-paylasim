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
  assert.match(render, /data-action="finish-tekrar-test">✅ Testi Bitir/);
  assert.match(render, /data-action="prev-tekrar-soru"/);
  assert.match(render, /data-action="next-tekrar-soru"/);
  assert.match(render, /sticky-next-bar/);
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
