import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)?.[1] ?? '';

function fn(name: string) {
  return script.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?^  \\}', 'm'))?.[0] ?? '';
}

void test('checkpoint maddeleri ileri-geri gezilen ve kaldığı yerden devam eden notlara dönüşür', () => {
  assert.match(fn('checkpointSorular'), /querySelectorAll\("li"\)/);
  assert.match(fn('checkpointSlotYaz'), /practice-session-save/);
  assert.match(fn('checkpointDevamEt'), /practice-session-load/);
  assert.match(fn('checkpointSlotSil'), /practice-session-delete/);
  assert.match(fn('checkpointOnceki'), /currentCheckpoint\.index--/);
  assert.match(fn('checkpointSonraki'), /currentCheckpoint\.index\+\+/);
  assert.match(fn('renderCheckpointSoru'), /data-action="checkpoint-onceki"/);
  assert.match(fn('renderCheckpointSoru'), /data-action="checkpoint-sonraki"/);
  assert.match(fn('renderCheckpointDetay'), /Kaldığım Yerden Devam Et/);
  assert.match(fn('checkpointYarimKalanKartlari'), /Kaldığım Yerden Devam Et/);
  assert.match(fn('renderMenu'), /checkpointYarimKalanKartlari\(\)/);
});

void test('checkpoint yarım oturumu kullanıcıya ait yerel yedekte de tutulur', () => {
  const save = fn('remoteSavePracticeLocal');
  const load = fn('remoteInitPracticeOwner');
  assert.match(save, /pausedCheckpoints/);
  assert.match(load, /saved\.pausedCheckpoints/);
  assert.match(script, /"pausedCheckpoints"/);
});

void test('checkpoint kartında kopyala ve hatırlatıcı butonu, ayrı gruplu hatırlatıcılar bölümü ve Word dışa aktarımı var', () => {
  assert.match(fn('renderCheckpointSoru'), /data-action="copy-checkpoint-soru"/);
  assert.match(fn('renderCheckpointSoru'), /data-action="toggle-flag" data-guid="' \+ guid \+ '" data-kind="hatirlatici"/);
  assert.match(fn('kopyalaCheckpointMaddesi'), /htmlDenDuzMetin/);
  assert.match(fn('checkpointGuidCoz'), /checkpointBul/);
  assert.match(fn('checkpointHatirlaticiListesi'), /STATE\.flags/);
  assert.match(fn('renderCheckpointHatirlaticilar'), /it\.c\.konu/);
  assert.match(fn('renderCheckpointHatirlaticilar'), /it\.c\.title/);
  assert.match(fn('renderCheckpointHatirlaticilar'), /data-action="export-checkpoint-hatirlatici-word"/);
  assert.match(fn('exportCheckpointHatirlaticiWord'), /checkpointHatirlaticiDocxOlustur/);
  assert.match(fn('renderCheckpointListe'), /data-action="open-checkpoint-hatirlatici"/);
  assert.match(script, /else if \(action === "copy-checkpoint-soru"\) kopyalaCheckpointMaddesi\(\);/);
  assert.match(script, /else if \(action === "open-checkpoint-hatirlatici"\)/);
  assert.match(script, /else if \(action === "export-checkpoint-hatirlatici-word"\) exportCheckpointHatirlaticiWord\(\);/);
  assert.match(script, /VIEW === "checkpointHatirlatici"/);
});
