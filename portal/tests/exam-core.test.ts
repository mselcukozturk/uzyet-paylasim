import assert from 'node:assert/strict';
import test from 'node:test';
import * as examCore from '../lib/exam-core.ts';
import type { BankQuestion } from '../lib/exam-core.ts';

const {
  OFFICIAL_DISTRIBUTION, examCode, parseExamCode, selectExamQuestions,
  shuffleQuestionOptions, mulberry32,
} = examCore;

function bank(): BankQuestion[] {
  return Object.entries(OFFICIAL_DISTRIBUTION).flatMap(([topic, count]) =>
    Array.from({ length: count + 3 }, (_, index) => ({
      id: `${topic}-${index}`,
      guid: `${topic}-${index}`,
      topic,
      prompt: `${topic} ${index}`,
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 2,
      explanation: '',
    })));
}

void test('resmî dağılım 50 sorudur', () => {
  assert.equal(Object.values(OFFICIAL_DISTRIBUTION).reduce((sum, value) => sum + value, 0), 50);
  const selected = selectExamQuestions(bank(), [], 'rastgele', 42).questions;
  assert.equal(selected.length, 50);
  for (const [topic, count] of Object.entries(OFFICIAL_DISTRIBUTION)) {
    assert.equal(selected.filter((question) => question.topic === topic).length, count);
  }
});

void test('aynı seed aynı sınavı üretir', () => {
  const first = selectExamQuestions(bank(), [], 'rastgele', 987654).questions.map((item) => item.guid);
  const second = selectExamQuestions(bank(), [], 'rastgele', 987654).questions.map((item) => item.guid);
  assert.deepEqual(first, second);
});

void test('deneme kodu çift yönlüdür', () => {
  const code = examCode('azgorulen', 1234567890);
  assert.deepEqual(parseExamCode(code), { mode: 'azgorulen', seed: 1234567890 });
  assert.equal(parseExamCode('geçersiz'), null);
});

void test('şık karıştırma doğru cevap indeksini korur', () => {
  const question = bank()[0];
  const shuffled = shuffleQuestionOptions(question, mulberry32(7));
  assert.equal(shuffled.options[shuffled.correctIndex], question.options[question.correctIndex]);
});

void test('yanlışlar modu yanlış geçmişli soruları önceliklendirir', () => {
  const questions = bank();
  const wrongGuids = Object.keys(OFFICIAL_DISTRIBUTION).map((topic) => `${topic}-0`);
  const selected = selectExamQuestions(
    questions,
    wrongGuids.map((questionGuid) => ({ questionGuid, shownCount: 1, wrongCount: 1, lastResult: false })),
    'yanlislar',
    91,
  ).questions.map((item) => item.guid);
  for (const guid of wrongGuids) assert.ok(selected.includes(guid), `${guid} seçilmeliydi`);
});

void test('az görülenler modu çok görülen soruları geri plana atar', () => {
  const questions = bank();
  const overSeen = Object.keys(OFFICIAL_DISTRIBUTION).map((topic) => `${topic}-0`);
  const selected = selectExamQuestions(
    questions,
    overSeen.map((questionGuid) => ({ questionGuid, shownCount: 999, wrongCount: 0, lastResult: true })),
    'azgorulen',
    13,
  ).questions.map((item) => item.guid);
  for (const guid of overSeen) assert.ok(!selected.includes(guid), `${guid} seçilmemeliydi`);
});

void test('zor modu en çok yanlış yapılan soruları önceliklendirir', () => {
  const questions = bank();
  const hardGuids = Object.keys(OFFICIAL_DISTRIBUTION).map((topic) => `${topic}-0`);
  const selected = selectExamQuestions(
    questions,
    hardGuids.map((questionGuid) => ({ questionGuid, shownCount: 5, wrongCount: 5, lastResult: false })),
    'zor',
    77,
  ).questions.map((item) => item.guid);
  for (const guid of hardGuids) assert.ok(selected.includes(guid), `${guid} seçilmeliydi`);
});

void test('soru veya şık değişince istatistik sıfırlanır, yalnız açıklama değişince korunur', () => {
  assert.equal(typeof examCore.shouldResetQuestionStats, 'function');
  const once = { soru: 'Soru', a: 'A', b: 'B', c: 'C', d: 'D', cevap_harf: 'A', cevap_metni: 'A', aciklama: 'eski' };
  assert.equal(examCore.shouldResetQuestionStats(once, { ...once, d: 'Yeni D' }), true);
  assert.equal(examCore.shouldResetQuestionStats(once, { ...once, cevap_harf: 'B', cevap_metni: 'B' }), true);
  assert.equal(examCore.shouldResetQuestionStats(once, { ...once, aciklama: 'yeni' }), false);
});

void test('eski banka sürümünden tamamlanan deneme güncel soru istatistiğine yazılmaz', () => {
  assert.equal(typeof examCore.shouldApplyAttemptStats, 'function');
  assert.equal(examCore.shouldApplyAttemptStats('eski-bank', 'aktif-bank'), false);
  assert.equal(examCore.shouldApplyAttemptStats('aktif-bank', 'aktif-bank'), true);
});

void test('istatistik sıfırlama GUID başlığı tekilleştirilir ve geçersiz değeri reddeder', () => {
  assert.equal(typeof examCore.parseResetQuestionGuids, 'function');
  assert.deepEqual(examCore.parseResetQuestionGuids('abc123,def456,abc123,bozuk!'), ['abc123', 'def456']);
  assert.deepEqual(examCore.parseResetQuestionGuids(null), []);
});

test('takvimGunuBaslangici: son N gün bugün dahil İstanbul gece yarısından sayılır', () => {
  // 24 Eyl 01:30 İstanbul (23 Eyl 22:30 UTC): "son 3 gün" 22 Eyl 00:00 İstanbul'dan başlar.
  const gece = new Date('2026-09-23T22:30:00Z');
  assert.equal(examCore.takvimGunuBaslangici(3, gece).toISOString(), '2026-09-21T21:00:00.000Z');
  assert.equal(examCore.takvimGunuBaslangici(1, gece).toISOString(), '2026-09-23T21:00:00.000Z');
  // 24 Eyl 23:59 İstanbul: aynı gün, sınır değişmez; "son 7 gün" 18 Eyl 00:00'dan.
  const aksam = new Date('2026-09-24T20:59:00Z');
  assert.equal(examCore.takvimGunuBaslangici(3, aksam).toISOString(), '2026-09-21T21:00:00.000Z');
  assert.equal(examCore.takvimGunuBaslangici(7, aksam).toISOString(), '2026-09-17T21:00:00.000Z');
});
