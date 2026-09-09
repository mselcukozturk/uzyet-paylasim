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

void test('hatırlatıcı testi karışık başlar ve doğru cevap işareti kaldırmaz', () => {
  const start = script.match(/function startHatirlaticiTest\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  const select = script.match(/function selectHatirlaticiOption\(idx\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  assert.match(start, /sampleRandom\(guids, guids\.length\)/);
  assert.match(start, /shuffleSiklarInPlace/);
  assert.doesNotMatch(select, /remoteReminderGuids|remoteFlagSync/);
});

void test('yanlış sorular hatırlatıcıların altında gösterilir ve cevap sunucuya kaydedilir', () => {
  const menu = script.match(/function renderMenuDeneme\(\) \{[\s\S]*?^  \}/m)?.[0] ?? '';
  assert.ok(menu.indexOf('hatirlaticiBolumHtml()') < menu.indexOf('yanlisSorularBolumHtml()'));
  assert.match(script, /action: "wrong-questions"/);
  assert.match(script, /action: "wrong-question-answer", questionGuid: guid, selectedAnswer: q\.siklar/);
  assert.match(script, /if \(r\.data && r\.data\.guids\) remoteWrongGuids = r\.data\.guids/);
});
