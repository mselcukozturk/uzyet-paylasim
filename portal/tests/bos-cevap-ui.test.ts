import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)?.[1] ?? '';
assert.ok(script);

function fn(name: string): string {
  const src = script.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?^  \\}`, 'm'))?.[0];
  assert.ok(src, `${name} bulunamadı`);
  return src;
}

// Fonksiyonları gerçek kaynaktan alıp izole bir bağlamda çalıştırır; istatistik ve
// sunucu yazan her şey sayaçlı sahte fonksiyondur.
function sandbox(extra: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const ctx: Record<string, unknown> = {
    BOS_CEVAP: -1,
    render: () => calls.push('render'),
    recordPratikStat: () => calls.push('recordPratikStat'),
    remoteQueueStudyAnswer: () => calls.push('remoteQueueStudyAnswer'),
    remoteFetch: () => { calls.push('remoteFetch'); return Promise.resolve({ ok: true }); },
    veriDegisti: () => calls.push('veriDegisti'),
    lsKaydet: () => calls.push('lsKaydet'),
    calls,
    ...extra,
  };
  vm.createContext(ctx);
  return ctx;
}

void test('Rastgele Soru/Konu: Boş cevabı açar ama stats, özet ve sunucuya yazmaz', () => {
  const ctx = sandbox({
    currentFlash: { secilen: null, konum: 0, gecmis: [{ guid: 'g1', secilen: null }], oturum: [] },
    STATE: { stats: {}, flashOzet: { gosterim: 0, dogru: 0 } },
  });
  vm.runInContext(fn('bosFlash') + '; bosFlash();', ctx);
  const cf = ctx.currentFlash as { secilen: number; gecmis: { secilen: number }[]; oturum: unknown[] };
  assert.equal(cf.secilen, -1);
  assert.equal(cf.gecmis[0].secilen, -1, 'geri/ileri gezinmede boş durumu korunur');
  assert.deepEqual(cf.oturum, []);
  assert.deepEqual((ctx.STATE as { stats: object }).stats, {});
  assert.deepEqual(ctx.calls, ['render']);
  // Cevaplanmış soruda Boş işlemez.
  vm.runInContext('bosFlash();', ctx);
  assert.deepEqual(ctx.calls, ['render']);
});

void test('Tekrar testi: Boş kaydedilmez, özet ve Testi Bitir sayımına girmez', () => {
  const kayit = { guid: 'g1', secilen: null as number | null, dogru: null, kayit: '', kayitHatasi: '' };
  const ctx = sandbox({
    currentTekrar: { tur: 'yanlis', havuz: 'deneme', kuyruk: ['g1'], konum: 0, kayitlar: [kayit] },
    TEKRAR_TUR: { yanlis: { kaydeder: true } },
    hatirlaticiSoruBul: () => ({ guid: 'g1', konu: 'Kredi', siklar: ['a', 'b', 'c', 'd'], cevapIdx: 2 }),
    VIEW: 'tekrarTest', lastTekrarSonuc: null,
  });
  vm.runInContext([fn('tekrarAktifKayit'), fn('bosTekrar'), fn('tekrarCevapKaydet'), fn('finishTekrarTest')].join('\n') +
    '; bosTekrar(); tekrarCevapKaydet(tekrarAktifKayit()); finishTekrarTest();', ctx);
  assert.equal(kayit.secilen, -1);
  assert.ok(!(ctx.calls as string[]).includes('remoteFetch'), 'yanlış havuzu sunucuda değişmez');
  assert.ok(!(ctx.calls as string[]).includes('recordPratikStat'));
  assert.equal((ctx.lastTekrarSonuc as { oturum: unknown[] }).oturum.length, 0);
  assert.match(fn('renderTekrarTest'), /k\.secilen !== null && k\.secilen !== BOS_CEVAP/);
});

void test('AI pratik: Boş modül skoruna ve pStats\'a yazılmaz', () => {
  const ctx = sandbox({
    currentPratik: { cevaplandi: false, secilen: null, cevaplar: {}, kuyruk: ['p_1'], index: 0 },
  });
  vm.runInContext(fn('bosPratik') + '; bosPratik();', ctx);
  const cp = ctx.currentPratik as { cevaplandi: boolean; secilen: number; cevaplar: object };
  assert.equal(cp.cevaplandi, true);
  assert.equal(cp.secilen, -1);
  assert.deepEqual(cp.cevaplar, {});
  assert.deepEqual(ctx.calls, ['render']);
});

void test('alt bar: tüm soru ekranları ortak barı kullanır, Boş yalnız deneme dışında', () => {
  assert.match(fn('renderFlash'), /soruNavBarHtml\(\{[\s\S]*bos: answered \? null : "bos-flash"[\s\S]*nextEtiket: sonSoruda \? "Testi Bitir"/);
  assert.match(fn('renderTekrarTest'), /bos: q && kayit\.secilen === null \? "bos-tekrar"/);
  assert.match(fn('renderPratikSoru'), /\{ bos: "bos-pratik" \}/);
  // Deneme aynı barı kullanır ama Boş butonu yoktur; Bitir düğmesi barın dışında kalır.
  const exam = fn('renderExam');
  assert.match(exam, /soruNavBarHtml\(\{[\s\S]*prev: "prev-q"[\s\S]*next: "next-q", nextDisabled: isLast/);
  assert.doesNotMatch(exam, /bos:|bos-/);
  assert.ok(exam.indexOf('data-action="finish-exam"') < exam.indexOf('soruNavBarHtml('));
  // Dar ekranda oklar yazısız, bar ekranın altına sabit; not yazılırken gizlenir.
  const bar = fn('soruNavBarHtml');
  assert.match(bar, /←<span class="genis-etiket"> Önceki Soru<\/span>/);
  assert.match(bar, /<span class="genis-etiket">Sonraki Soru <\/span>→/);
  assert.match(html, /@media \(max-width: 560px\) \{\s*\.soru-nav \{\s*position: fixed;/);
  assert.match(html, /body:has\(textarea:focus\) \.soru-nav \{ display: none; \}/);
});

void test('klavye: 5 tuşu üç ekranda da Boş işlevi görür', () => {
  assert.match(script, /currentFlash\.secilen === null && e\.key === "5"\) \{\s*e\.preventDefault\(\); bosFlash\(\);/);
  assert.match(script, /!currentPratik\.cevaplandi && e\.key === "5"\) \{\s*e\.preventDefault\(\); bosPratik\(\);/);
  assert.match(script, /tKayit\.secilen === null && e\.key === "5"\) \{\s*e\.preventDefault\(\); bosTekrar\(\);/);
  for (const a of ['bos-flash', 'bos-tekrar', 'bos-pratik']) assert.match(script, new RegExp(`action === "${a}"\\)`));
});
