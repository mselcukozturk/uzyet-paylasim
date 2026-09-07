import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OFFICIAL_DISTRIBUTION,
  examCode,
  parseExamCode,
  selectExamQuestions,
  shuffleQuestionOptions,
  mulberry32,
  type BankQuestion,
} from '../lib/exam-core.ts';

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
    wrongGuids.map((questionGuid) => ({ questionGuid, shownCount: 1, lastResult: false })),
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
    overSeen.map((questionGuid) => ({ questionGuid, shownCount: 999, lastResult: true })),
    'azgorulen',
    13,
  ).questions.map((item) => item.guid);
  for (const guid of overSeen) assert.ok(!selected.includes(guid), `${guid} seçilmemeliydi`);
});
