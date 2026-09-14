import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)?.[1] ?? '';

function fn(name: string) {
  return script.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?^  \\}', 'm'))?.[0] ?? '';
}

void test('AI girişi doğrudan ders listesine açılır', () => {
  assert.match(fn('acceptAiSources'), /aiYukleniyor = true; VIEW = "menuTest";/);
});

void test('ders içinde Konu ve Test sekmeleri checkpoint ve modül içeriklerini ayırır', () => {
  const lesson = fn('renderPratikModul');
  assert.match(lesson, /role="tablist"/);
  assert.match(lesson, /data-action="select-ders-sekmesi" data-sekme="konu"/);
  assert.match(lesson, /data-action="select-ders-sekmesi" data-sekme="test"/);
  assert.match(lesson, /STATE\.checkpoints\.filter/);
  assert.match(lesson, /data-action="open-checkpoint-detay"/);
  assert.match(lesson, /data-action="select-pratik-modul"/);
  assert.match(script, /VIEW === "pratikModul" && document\.activeElement\.getAttribute\("role"\) === "tab"[\s\S]*?e\.key === "ArrowRight"[\s\S]*?e\.key === "ArrowLeft"/);

  const makeLesson = new Function('pratikSeciliKonu', 'konuDotHtml',
    'escapeHtml', 'dersSekmesi', 'STATE', 'checkpointDersi', 'checkpointHatirlaticiListesi',
    'MODUL_TANIMLARI', 'PRATIK_TUM_MODULLER', 'pratikHavuz',
    'pratikTileStil', 'pratikEnIyiHtml', 'pratikDevamHtml',
    fn('renderPratikModul') + '\nreturn renderPratikModul;');
  const render = (tab: string) => (makeLesson(
    'Kambiyo', () => '', (value: string) => value, tab,
    { checkpoints: [{ id: 'ark_n-uluslararasi', konu: 'İthalat İhracat', title: 'Incoterms', subtitle: 'Özet' }] },
    new Function(fn('checkpointDersi') + '\nreturn checkpointDersi;')(), () => [],
    { Kambiyo: [{ key: 'DT1', ad: 'Uluslararası Ticaret' }, { key: 'DT2', ad: 'Boş Modül' }] }, '__TUMU__',
    (_topic: string, module: string) => module === 'DT1' ? [{}] : [], () => '', () => '', () => '',
  ) as () => string)();
  assert.match(render('konu'), /data-action="open-checkpoint-detay" data-id="ark_n-uluslararasi"/);
  assert.doesNotMatch(render('konu'), /data-action="select-pratik-modul"/);
  assert.match(render('test'), /data-action="select-pratik-modul" data-modul="DT1"/);
  assert.doesNotMatch(render('test'), /data-modul="DT2"/);
  assert.doesNotMatch(render('test'), /data-action="open-checkpoint-detay"/);
});

void test('checkpoint bitince eşlenmiş, soru içeren modülün testi açılır', () => {
  const source = script.match(/var CHECKPOINT_TEST_MODULLERI = \{[\s\S]*?^  \};/m)?.[0] ?? '';
  assert.ok(source && fn('checkpointTestHedefi'), 'checkpoint-test eşlemesi bulunmalı');
  const state = { practiceBank: [{ konu: 'Kredi', modul: 'K1' }] };
  const hedef = new Function('STATE', source + '\n' + fn('checkpointTestHedefi') + '\nreturn checkpointTestHedefi;')(state) as
    (id: string) => { konu: string; modul: string } | null;
  assert.deepEqual(hedef('ark_n-kredigenel'), { konu: 'Kredi', modul: 'K1' });
  assert.equal(hedef('ark_n-kreditl'), null, 'soru içermeyen modüle buton verilmez');
  assert.equal(hedef('ark_n-uluslararasi'), null, 'Kambiyo testi yok');
  assert.equal(hedef('bilinmeyen'), null);
  state.practiceBank.push({ konu: 'Sermaye Piyasaları ve Hazine', modul: 'UR7' });
  assert.deepEqual(hedef('ark_n-menkul'), { konu: 'Sermaye Piyasaları ve Hazine', modul: 'UR7' }, 'Menkul Kıymetler testi Sermaye Piyasaları altında');

  const finished = new Function('currentCheckpoint', 'checkpointBul', 'checkpointSorular', 'STATE',
    'checkpointDevamVarMi', 'escapeHtml', 'checkpointTestHedefi', fn('renderCheckpointSoru') + '\nreturn renderCheckpointSoru;')(
    { id: 'ark_n-kredigenel', bitti: true },
    (id: string) => ({ id, konu: 'Kredi', title: 'Kredi — Genel Esaslar' }),
    () => ['madde'], { checkpoints: [{ id: 'ark_n-kredigenel', konu: 'Kredi' }] },
    () => false, (value: string) => value, hedef,
  ) as () => string;
  assert.match(finished(), /data-action="checkpoint-testi-coz" data-konu="Kredi" data-modul="K1">Testi Çöz<\/button>/);
  const withoutTest = new Function('currentCheckpoint', 'checkpointBul', 'checkpointSorular', 'STATE',
    'checkpointDevamVarMi', 'escapeHtml', 'checkpointTestHedefi', fn('renderCheckpointSoru') + '\nreturn renderCheckpointSoru;')(
    { id: 'ark_n-uluslararasi', bitti: true },
    (id: string) => ({ id, konu: 'İthalat İhracat', title: 'Uluslararası Ticarete Giriş' }),
    () => ['madde'], { checkpoints: [{ id: 'ark_n-uluslararasi', konu: 'İthalat İhracat' }] },
    () => false, (value: string) => value, () => null,
  ) as () => string;
  assert.doesNotMatch(withoutTest(), /checkpoint-testi-coz/);
  assert.match(script, /action === "checkpoint-testi-coz"[\s\S]*?startPratikOturum\(hedef\.konu, hedef\.modul, "siray"\)/);
});
