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
