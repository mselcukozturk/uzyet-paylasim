import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const queueSource = html.slice(html.indexOf('  // ---- Hesaba bağlı,'), html.indexOf('  // Hatırlatıcı olarak işaretlenmiş'));
function setup(fetcher: (...args: any[]) => Promise<any>, storage = new Map<string, string>()) {
  const context = {
    STATE: { sadeceDeneme: true, pausedPratik: {}, pStats: {} },
    remoteAuth: { username: 'owner', canSeeAiSources: true }, remoteGirisTamamMi: () => true,
    remoteFetch: fetcher, showBanner: () => {}, bumpRev: () => {}, lsKaydet: () => {},
    crypto: { randomUUID }, window: { addEventListener: () => {} },
    setTimeout: () => 0, clearTimeout: () => {},
    localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) },
  };
  return runInNewContext(queueSource + '\n({remoteQueuePractice, remoteFlushPracticeQueue, remoteReadPracticeQueue, remoteInitPracticeOwner, remoteAuth, STATE})', context);
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('failed answer survives reload and retries with the same request ID', async () => {
  const storage = new Map<string, string>();
  const api = setup(async () => { throw new Error('offline'); }, storage);
  api.remoteQueuePractice({ action: 'practice-answer', questionGuid: 'q', selectedAnswer: 'A' }, true, false);
  await tick();
  const first = api.remoteReadPracticeQueue()[0];
  assert.ok(first.body.requestId);
  const second = setup(async (_path, _method, body) => {
    assert.equal(body.requestId, first.body.requestId);
    return { ok: true, data: { stat: { gosterim: 1, dogru: 1, yanlis: 0 } } };
  }, storage);
  await second.remoteFlushPracticeQueue();
  assert.equal(second.remoteReadPracticeQueue().length, 0);
  assert.equal(second.STATE.pStats.q.gosterim, 1);
});
test('session debounce coalesces snapshots and delete removes a pending save', async () => {
  let calls = 0;
  const api = setup(async () => { calls++; return { ok: true, data: {} }; });
  api.remoteQueuePractice({ action: 'practice-session-save', konu: 'K', modul: 'M', payload: { index: 0 } }, null, true);
  api.remoteQueuePractice({ action: 'practice-session-save', konu: 'K', modul: 'M', payload: { index: 3 } }, null, true);
  assert.equal(calls, 0);
  assert.equal(api.remoteReadPracticeQueue().length, 1);
  assert.equal(api.remoteReadPracticeQueue()[0].body.payload.index, 3);
  api.remoteQueuePractice({ action: 'practice-session-delete', konu: 'K', modul: 'M' }, null, false);
  await tick();
  assert.equal(calls, 1);
  assert.equal(api.remoteReadPracticeQueue().length, 0);
});
test('queue is capped at 50 and another account cannot replay it', async () => {
  const api = setup(async () => { throw new Error('offline'); });
  for (let i = 0; i < 60; i++) api.remoteQueuePractice({ action: 'practice-answer', questionGuid: 'q' + i, selectedAnswer: 'A' }, true, false);
  await tick();
  assert.equal(api.remoteReadPracticeQueue().length, 50);
  api.remoteAuth.username = 'someone-else';
  assert.equal(api.remoteReadPracticeQueue().length, 0);
});
test('a 400-rejected answer is dropped once instead of retrying and blocking later entries', async () => {
  const seen: string[] = [];
  const api = setup(async (_path, _method, body) => {
    seen.push(body.questionGuid);
    return body.questionGuid === 'bad'
      ? { ok: false, status: 400, data: { error: 'Soru veya cevap geçersiz.' } }
      : { ok: true, status: 200, data: {} };
  });
  api.remoteQueuePractice({ action: 'practice-answer', questionGuid: 'bad', selectedAnswer: 'X' }, true, false);
  await tick();
  api.remoteQueuePractice({ action: 'practice-answer', questionGuid: 'ok', selectedAnswer: 'A' }, true, false);
  await tick();
  assert.deepEqual(seen, ['bad', 'ok']);
  assert.equal(api.remoteReadPracticeQueue().length, 0);
});
test('newer pending answers remain optimistic when an older response arrives', async () => {
  let finish: (value: unknown) => void = () => {};
  const api = setup(() => new Promise((resolve) => { finish = resolve; }));
  api.remoteQueuePractice({ action: 'practice-answer', questionGuid: 'q', selectedAnswer: 'A' }, true, false);
  api.remoteQueuePractice({ action: 'practice-answer', questionGuid: 'q', selectedAnswer: 'B' }, false, false);
  finish({ ok: true, data: { stat: { gosterim: 1, dogru: 1, yanlis: 0 } } });
  await tick();
  assert.equal(api.STATE.pStats.q.gosterim, 2);
  assert.equal(api.STATE.pStats.q.dogru, 1);
  assert.equal(api.STATE.pStats.q.yanlis, 1);
});
