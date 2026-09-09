import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parsePracticeSync } from '../lib/practice-sync.ts';

const question = {
  guid: ' t_b16485763cd3 ', konu: 'Temel İşlemler', modul: 'M1', soru: 'Soru?',
  siklar: ['Bir', 'İki', 'Üç', 'Dört'], cevapIdx: 0, aciklama: 'Açıklama', kaynak: 'Kitap s.4',
};
const checkpoint = {
  id: 'ark_n-medeni', konu: 'Hukuk', title: 'Medeni Hukuk', subtitle: '11 bölüm', html: ' <h3>İçerik</h3> ',
};
function parse(questions: unknown = [question], checkpoints: unknown = [checkpoint]) {
  return parsePracticeSync(JSON.stringify({ questions, checkpoints }));
}

test('geçerli payload alanları, sıra ve sürüm ile dönüştürülür', () => {
  const result = parse([question], [checkpoint, { ...checkpoint, id: 'ikinci' }]);
  assert.deepEqual(result.questions, [{
    guid: question.guid.trim(), topic: question.konu, modul: question.modul, prompt: question.soru,
    options: question.siklar, correctIndex: 0, explanation: question.aciklama, source: question.kaynak,
    version: result.version,
  }]);
  assert.deepEqual(result.checkpoints[0], {
    id: checkpoint.id, topic: checkpoint.konu, title: checkpoint.title, subtitle: checkpoint.subtitle,
    html: checkpoint.html, sira: 0, version: result.version,
  });
  assert.equal(result.checkpoints[1].sira, 1);
});

test('boş ve mükerrer guid kayıt numarasıyla reddedilir', () => {
  assert.throws(() => parse([question, { ...question, guid: question.guid.trim() }]), /GUID: satır 2/);
  assert.throws(() => parse([{ ...question, guid: ' ' }]), /GUID: satır 1/);
});

test('zorunlu soru alanları boş olamaz', () => {
  for (const field of ['konu', 'modul', 'soru']) {
    assert.throws(() => parse([{ ...question, [field]: ' ' }]), /Eksik konu\/modul\/soru/);
  }
});

test('cevapIdx tamsayı ve şık aralığında olmalı', () => {
  for (const cevapIdx of [-1, 4, 0.5, '0', null]) {
    assert.throws(() => parse([{ ...question, cevapIdx }]), /Geçersiz cevap/);
  }
  assert.equal(parse([{ ...question, siklar: ['A', 'B'], cevapIdx: 1 }]).questions[0].correctIndex, 1);
});

test('şıklar 2–4 metinden oluşmalı', () => {
  for (const siklar of [null, 'AB', [], ['A'], ['A', 'B', 'C', 'D', 'E'], ['A', 2]]) {
    assert.throws(() => parse([{ ...question, siklar }]), /Geçersiz cevap/);
  }
});

test('checkpoint id boş veya mükerrer, html boş olamaz', () => {
  assert.throws(() => parse([], [{ ...checkpoint, id: ' ' }]), /checkpoint id: satır 1/);
  assert.throws(() => parse([], [checkpoint, checkpoint]), /checkpoint id: satır 2/);
  assert.throws(() => parse([], [{ ...checkpoint, html: ' ' }]), /Boş checkpoint html: satır 1/);
});

test('bozuk JSON ve beklenmeyen gövde veya kayıt türleri reddedilir', () => {
  assert.throws(() => parsePracticeSync('{'), /Geçersiz JSON/);
  for (const body of [null, [], {}, { questions: [], checkpoints: {} }]) {
    assert.throws(() => parsePracticeSync(JSON.stringify(body)), /JSON nesnesi/);
  }
  assert.throws(() => parse([null]), /Geçersiz soru/);
  assert.throws(() => parse([], [null]), /Geçersiz checkpoint/);
});

test('sürüm ham gövdenin SHA256 ilk 16 hanesidir ve deterministiktir', () => {
  const raw = JSON.stringify({ questions: [question], checkpoints: [checkpoint] });
  const result = parsePracticeSync(raw);
  assert.equal(result.version, createHash('sha256').update(raw).digest('hex').slice(0, 16));
  assert.equal(result.version, parsePracticeSync(raw).version);
  assert.notEqual(result.version, parsePracticeSync(raw + '\n').version);
});

test('boş koleksiyonlar ve isteğe bağlı alanlar desteklenir', () => {
  assert.deepEqual(parse([], []).questions, []);
  const result = parse([{ ...question, aciklama: undefined, kaynak: undefined }]);
  assert.equal(result.questions[0].explanation, '');
  assert.equal(result.questions[0].source, '');
});
