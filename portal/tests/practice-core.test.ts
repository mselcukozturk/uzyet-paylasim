import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePracticeAnswer } from '../lib/practice-core.ts';

const question = { options: ['Yanlış', 'Doğru'], correctIndex: 1 };
test('practice answers use option text even when the client shuffles choices', () => {
  assert.equal(validatePracticeAnswer(question, 'Doğru'), true);
  assert.equal(validatePracticeAnswer(question, 'Yanlış'), false);
});
test('unknown question and answer text outside the options are rejected', () => {
  assert.throws(() => validatePracticeAnswer(undefined, 'Doğru'));
  for (const answer of ['yok', 1, null, undefined, {}, ['Doğru']]) {
    assert.throws(() => validatePracticeAnswer(question, answer));
  }
});
