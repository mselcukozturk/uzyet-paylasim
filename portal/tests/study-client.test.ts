import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)?.[1] ?? '';

function grab(name: string) {
  const found = script.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  \\}`, 'm'))?.[0];
  assert.ok(found, `${name} bulunamadı`);
  return found;
}

const studySource = script.slice(script.indexOf('  var remoteBankLoaded'), script.indexOf('  var remotePracticeBankLoaded'));
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setupStudy(fetcher: (...args: any[]) => Promise<any>, storage = new Map<string, string>()) {
  const context = {
    STATE: { sadeceDeneme: true, bank: [], stats: {} },
    remoteAuth: { username: 'owner' }, remoteGirisTamamMi: () => true,
    remoteFetch: fetcher, bumpRev: () => {}, lsKaydet: () => {}, showBanner: () => {},
    crypto: { randomUUID }, setTimeout: () => 0, clearTimeout: () => {},
    localStorage: {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  };
  vm.createContext(context);
  vm.runInContext(studySource, context);
  return vm.runInContext('({remoteLoadBankIfNeeded, remoteRefreshStudyStats, remoteQueueStudyAnswer, remoteFlushStudyQueue, remoteReadStudyQueue, remoteInitStudyOwner, remoteAuth, STATE})', context) as any;
}

test('Konu Konu Bak bankayı açarken sunucudaki kişisel soru geçmişini kullanır', async () => {
  let saved = 0;
  const remoteStat = {
    q1: { gosterim: 4, dogru: 2, yanlis: 2, sonSonucDogruMu: false, sonGorulme: '2026-09-15T08:00:00Z' },
  };
  const context: Record<string, unknown> = {
    STATE: { sadeceDeneme: true, bank: [], stats: { yerel: { sonSonucDogruMu: true } } },
    remoteBankLoaded: false,
    remoteGirisTamamMi: () => true,
    remoteAuth: { username: 'owner' },
    remoteBankGeneration: 0,
    remoteStudyOwner: 'owner',
    remoteStudyConfirmedStats: {},
    remoteCloneStudyStat: (stat: any) => ({ ...stat }),
    remotePendingStudyStats: () => {},
    remoteFetch: async () => ({ ok: true, data: { questions: [{ guid: 'q1' }], stats: remoteStat } }),
    bumpRev: () => {},
    lsKaydet: () => { saved += 1; },
  };
  vm.createContext(context);
  vm.runInContext(grab('remoteLoadBankIfNeeded'), context);
  await new Promise<void>((resolve) => {
    (vm.runInContext('remoteLoadBankIfNeeded', context) as (cb: () => void) => void)(resolve);
  });

  assert.deepEqual(JSON.parse(JSON.stringify((context.STATE as { stats: unknown }).stats)), remoteStat);
  assert.equal(saved, 1, 'sunucudan gelen geçmiş yerel seçime de kaydedilmeli');
});

test('önceki hesabın geciken banka yanıtı yeni hesabın istatistiğini ezmez', async () => {
  const resolvers: Array<(value: unknown) => void> = [];
  const api = setupStudy(() => new Promise((resolve) => { resolvers.push(resolve); }));
  api.remoteInitStudyOwner();
  let firstApplied: boolean | undefined;
  let secondApplied: boolean | undefined;
  const first = new Promise<void>((resolve) => api.remoteLoadBankIfNeeded((applied: boolean) => { firstApplied = applied; resolve(); }));
  api.remoteAuth.username = 'other';
  api.remoteInitStudyOwner();
  const second = new Promise<void>((resolve) => api.remoteLoadBankIfNeeded((applied: boolean) => { secondApplied = applied; resolve(); }));
  resolvers[1]({ ok: true, data: { questions: [{ guid: 'b' }], stats: { b: { gosterim: 2 } } } });
  await second;
  resolvers[0]({ ok: true, data: { questions: [{ guid: 'a' }], stats: { a: { gosterim: 9 } } } });
  await first;
  assert.deepEqual(JSON.parse(JSON.stringify(api.STATE.bank)), [{ guid: 'b' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(api.STATE.stats)), {
    b: { gosterim: 2, dogru: 0, yanlis: 0, sonSonucDogruMu: null, sonGorulme: null },
  });
  assert.equal(firstApplied, false);
  assert.equal(secondApplied, true);
});

test('çevrimdışı Konu Konu Bak cevabı aynı istek kimliğiyle tekrar gönderilir', async () => {
  const storage = new Map<string, string>();
  const first = setupStudy(async () => { throw new Error('offline'); }, storage);
  first.remoteInitStudyOwner();
  first.remoteQueueStudyAnswer({ action: 'study-answer', questionGuid: 'q1', selectedAnswer: 'A' }, true);
  await tick();
  const queued = first.remoteReadStudyQueue()[0];
  assert.match(queued.body.requestId, /^study_/);

  const second = setupStudy(async (_path: string, _method: string, body: any) => {
    assert.equal(body.requestId, queued.body.requestId);
    return { ok: true, data: { stat: { gosterim: 1, dogru: 1, yanlis: 0, sonSonucDogruMu: true } } };
  }, storage);
  second.remoteInitStudyOwner();
  await second.remoteFlushStudyQueue();
  assert.equal(second.remoteReadStudyQueue().length, 0);
  assert.equal(second.STATE.stats.q1.gosterim, 1);
});

test('banka yenilenirken henüz gönderilmemiş cevap iyimser istatistikte korunur', async () => {
  const storage = new Map<string, string>();
  const api = setupStudy(async (_path: string, _method: string, body: any) => {
    if (body.action === 'bank') return { ok: true, data: {
      questions: [{ guid: 'q1' }], stats: { q1: { gosterim: 3, dogru: 2, yanlis: 1, sonSonucDogruMu: false } },
    } };
    throw new Error('offline');
  }, storage);
  api.remoteInitStudyOwner();
  api.remoteQueueStudyAnswer({ action: 'study-answer', questionGuid: 'q1', selectedAnswer: 'A' }, true);
  await tick();
  await api.remoteRefreshStudyStats();
  assert.equal(api.STATE.stats.q1.gosterim, 4);
  assert.equal(api.STATE.stats.q1.dogru, 3);
  assert.equal(api.STATE.stats.q1.yanlis, 1);
  assert.equal(api.STATE.stats.q1.sonSonucDogruMu, true);
  assert.match(api.STATE.stats.q1.sonGorulme, /^2026-/);
});

test('bir cevabın sunucu dönüşü başka sorunun bekleyen sayacını iki kez artırmaz', async () => {
  let resolveFirst: (value: unknown) => void = () => {};
  const api = setupStudy(() => new Promise((resolve) => { resolveFirst = resolve; }));
  api.remoteInitStudyOwner();
  api.STATE.stats = {
    q1: { gosterim: 1, dogru: 1, yanlis: 0 },
    q2: { gosterim: 1, dogru: 0, yanlis: 1 },
  };
  api.remoteQueueStudyAnswer({ action: 'study-answer', questionGuid: 'q1', selectedAnswer: 'A' }, true);
  api.remoteQueueStudyAnswer({ action: 'study-answer', questionGuid: 'q2', selectedAnswer: 'B' }, false);
  resolveFirst({ ok: true, data: { stat: { gosterim: 1, dogru: 1, yanlis: 0 } } });
  await tick();
  assert.equal(api.STATE.stats.q2.gosterim, 1);
});

test('geciken banka anlık görüntüsü daha yeni cevap dönüşünü ezmez', async () => {
  const pending: Array<{ body: any; resolve: (value: unknown) => void }> = [];
  const api = setupStudy((_path: string, _method: string, body: any) => new Promise((resolve) => {
    pending.push({ body, resolve });
  }));
  api.remoteInitStudyOwner();
  const load = api.remoteLoadBankIfNeeded();
  api.STATE.stats.q1 = { gosterim: 1, dogru: 1, yanlis: 0 };
  api.remoteQueueStudyAnswer({ action: 'study-answer', questionGuid: 'q1', selectedAnswer: 'A' }, true);
  pending.find((x) => x.body.action === 'study-answer')?.resolve({
    ok: true, data: { stat: { gosterim: 1, dogru: 1, yanlis: 0, sonSonucDogruMu: true } },
  });
  await tick();
  pending.find((x) => x.body.action === 'bank')?.resolve({
    ok: true, data: { questions: [{ guid: 'q1' }], stats: { q1: { gosterim: 0, dogru: 0, yanlis: 0 } } },
  });
  await load;
  assert.equal(api.STATE.stats.q1.gosterim, 1);
  assert.equal(api.STATE.stats.q1.dogru, 1);
});

test('aynı sorudaki ikinci bekleyen cevap banka yarışı sırasında yalnız bir kez sayılır', async () => {
  const pending: Array<{ body: any; resolve: (value: unknown) => void }> = [];
  const api = setupStudy((_path: string, _method: string, body: any) => new Promise((resolve) => {
    pending.push({ body, resolve });
  }));
  api.remoteInitStudyOwner();
  api.STATE.stats.q1 = { gosterim: 2, dogru: 1, yanlis: 1 };
  api.remoteQueueStudyAnswer({ action: 'study-answer', questionGuid: 'q1', selectedAnswer: 'A' }, true);
  api.remoteQueueStudyAnswer({ action: 'study-answer', questionGuid: 'q1', selectedAnswer: 'B' }, false);
  pending[0].resolve({ ok: true, data: { stat: { gosterim: 1, dogru: 1, yanlis: 0 } } });
  await tick();
  const load = api.remoteLoadBankIfNeeded();
  pending.find((x) => x.body.action === 'bank')?.resolve({
    ok: true, data: { questions: [{ guid: 'q1' }], stats: { q1: { gosterim: 1, dogru: 1, yanlis: 0 } } },
  });
  await load;
  assert.equal(api.STATE.stats.q1.gosterim, 2);
  assert.equal(api.STATE.stats.q1.yanlis, 1);
});

test('geçici 403 cevabı kuyrukta kalır; kalıcı 400 iyimser sayacı geri alır', async () => {
  const transient = setupStudy(async () => ({ ok: false, status: 403, data: { error: 'yeniden giriş' } }));
  transient.remoteInitStudyOwner();
  transient.STATE.stats.q1 = { gosterim: 1, dogru: 1, yanlis: 0 };
  transient.remoteQueueStudyAnswer({ action: 'study-answer', questionGuid: 'q1', selectedAnswer: 'A' }, true);
  await tick();
  assert.equal(transient.remoteReadStudyQueue().length, 1);

  const permanent = setupStudy(async (_path: string, _method: string, body: any) => body.action === 'bank'
    ? { ok: true, data: { questions: [{ guid: 'q1' }], stats: { q1: { gosterim: 3, dogru: 2, yanlis: 1 } } } }
    : { ok: false, status: 400, data: { error: 'geçersiz cevap' } });
  permanent.remoteInitStudyOwner();
  await permanent.remoteLoadBankIfNeeded();
  permanent.STATE.stats.q1.gosterim++;
  permanent.STATE.stats.q1.dogru++;
  permanent.remoteQueueStudyAnswer({ action: 'study-answer', questionGuid: 'q1', selectedAnswer: 'A' }, true);
  await tick();
  assert.equal(permanent.remoteReadStudyQueue().length, 0);
  assert.equal(permanent.STATE.stats.q1.gosterim, 3);
  assert.equal(permanent.STATE.stats.q1.dogru, 2);
});

test('kuyruk dolunca işlem ve özellikle gönderilmekte olan ilk cevap kaybolmaz', () => {
  const api = setupStudy(() => new Promise(() => {}));
  api.remoteInitStudyOwner();
  for (let i = 0; i < 51; i++) {
    api.remoteQueueStudyAnswer({ action: 'study-answer', questionGuid: `q${i}`, selectedAnswer: 'A' }, true);
  }
  const queue = api.remoteReadStudyQueue();
  assert.equal(queue.length, 51);
  assert.equal(queue[0].body.questionGuid, 'q0');
});

test('A→B→A geçişinde eski A cevabı yeni A oturumuna uygulanmaz', async () => {
  const pending: Array<(value: unknown) => void> = [];
  const api = setupStudy(() => new Promise((resolve) => { pending.push(resolve); }));
  api.remoteInitStudyOwner();
  api.remoteQueueStudyAnswer({ action: 'study-answer', questionGuid: 'q1', selectedAnswer: 'A' }, true);
  api.remoteAuth.username = 'other'; api.remoteInitStudyOwner();
  api.remoteAuth.username = 'owner'; api.remoteInitStudyOwner();
  api.STATE.stats.q1 = { gosterim: 1, dogru: 1, yanlis: 0 };
  pending[0]({ ok: true, data: { stat: { gosterim: 99, dogru: 99, yanlis: 0 } } });
  await tick();
  assert.equal(api.STATE.stats.q1.gosterim, 1);
});

test('Konu Konu Bak cevabı seçilince metin tabanlı cevap sunucuya yazılır', async () => {
  const calls: unknown[] = [];
  const question = { guid: 'q1', konu: 'Hukuk', modul: '', siklar: ['Yanlış', 'Doğru'], cevapIdx: 1 };
  const context: Record<string, unknown> = {
    currentFlash: {
      guid: 'q1', secilen: null, kaynak: 'bank', konuFiltre: 'Hukuk', oturum: [],
      gecmis: [{ guid: 'q1', secilen: null }], konum: 0,
    },
    STATE: { sadeceDeneme: true, stats: {}, flashOzet: { gosterim: 0, dogru: 0 } },
    flashSoruBul: () => question,
    recordPratikStat: () => {},
    lsKaydet: () => {},
    veriDegisti: () => {},
    remoteGirisTamamMi: () => true,
    remoteQueueStudyAnswer: (body: unknown) => { calls.push(body); },
    bumpRev: () => {},
    showBanner: () => {},
    render: () => {},
    Date,
  };
  vm.createContext(context);
  vm.runInContext(grab('selectFlashOption'), context);
  (vm.runInContext('selectFlashOption', context) as (index: number) => void)(1);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    action: 'study-answer', questionGuid: 'q1', selectedAnswer: 'Doğru',
  }]);
});
