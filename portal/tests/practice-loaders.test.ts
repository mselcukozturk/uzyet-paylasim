import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const loaders = html.slice(html.indexOf('  var remotePracticeBankLoaded'), html.indexOf('  // Hatırlatıcı olarak işaretlenmiş'));
function setup(fetcher: (path: string, method: string, body: { action: string }) => Promise<unknown>, permitted = true) {
  const context = {
    STATE: { practiceBank: [], checkpoints: [], pStats: { stale: {} } },
    remoteAuth: { canSeeAiSources: permitted }, remoteGirisTamamMi: () => true,
    remoteFetch: fetcher, showBanner: () => {}, pratikSlotKey: (konu: string, modul: string) => konu + '::' + modul,
  };
  return runInNewContext(loaders + '\n({ remoteLoadPracticeBankIfNeeded, remoteLoadCheckpointsIfNeeded, remoteLoadPracticeStats, STATE })', context);
}
test('practice content is lazy, shares concurrent loads and is cached after success', async () => {
  let calls = 0;
  const api = setup(async () => { calls++; return { ok: true, data: { questions: [{ guid: 'q' }] } }; });
  assert.equal(calls, 0);
  await Promise.all([api.remoteLoadPracticeBankIfNeeded(), api.remoteLoadPracticeBankIfNeeded()]);
  await api.remoteLoadPracticeBankIfNeeded();
  assert.equal(calls, 1);
  assert.equal(api.STATE.practiceBank[0].guid, 'q');
});
test('permission denial performs no content request and failed loads can retry', async () => {
  const denied = setup(async () => { throw new Error('must not fetch'); }, false);
  assert.equal(await denied.remoteLoadPracticeBankIfNeeded(), false);
  let calls = 0;
  const api = setup(async () => ++calls === 1 ? { ok: false, data: { error: 'offline' } }
    : { ok: true, data: { checkpoints: [] } });
  assert.equal(await api.remoteLoadCheckpointsIfNeeded(), false);
  assert.equal(await api.remoteLoadCheckpointsIfNeeded(), true);
  assert.equal(calls, 2);
});
test('server practice stats replace local records', async () => {
  const api = setup(async () => ({ ok: true, data: { stats: { q: { dogru: 2 } }, sessions: [] } }));
  await api.remoteLoadPracticeStats();
  assert.equal(api.STATE.pStats.stale, undefined);
  assert.equal(api.STATE.pStats.q.dogru, 2);
});
