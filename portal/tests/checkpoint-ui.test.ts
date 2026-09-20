import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)?.[1] ?? '';

function fn(name: string) {
  return script.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?^  \\}', 'm'))?.[0] ?? '';
}

void test('checkpoint maddeleri ileri-geri gezilen notlara dönüşür, yarım kalan tutulmaz', () => {
  assert.match(fn('checkpointSorular'), /querySelectorAll\("li"\)/);
  // Liste dışı tablo/paragraflar komşu maddeye eklenir; madde sırası (hatırlatıcı guid'i) değişmez.
  assert.match(fn('checkpointSorular'), /doc\.body\.children/);
  assert.match(fn('checkpointSorular'), /return maddeler\.map\(function \(li, i\) \{ return once\[i\] \+ li\.innerHTML \+ sonra\[i\]; \}\)/);
  // Yarım kalan checkpoint 20 Eyl 2026'da kaldırıldı: ne slot yazılır ne de menüde kart çıkar.
  assert.doesNotMatch(script, /checkpointSlotYaz|checkpointDevamEt|checkpointSlotSil|checkpointYarimKalanKartlari/);
  assert.doesNotMatch(script, /data-action="devam-checkpoint"/);
  assert.match(fn('checkpointOnceki'), /currentCheckpoint\.index--/);
  assert.match(fn('checkpointSonraki'), /currentCheckpoint\.index\+\+/);
  assert.match(fn('renderCheckpointSoru'), /data-action="checkpoint-onceki"/);
  assert.match(fn('renderCheckpointSoru'), /data-action="checkpoint-sonraki"/);
  assert.doesNotMatch(fn('renderCheckpointDetay'), /Kaldığım Yerden Devam Et/);
  assert.match(fn('renderCheckpointDetay'), /data-action="start-checkpoint"/);
});

void test('checkpoint ekranı pratik sorusuyla aynı üst bloğu kullanır ve gezinme "Madde" der', () => {
  const ekran = fn('renderCheckpointSoru');
  assert.match(ekran, /soruUstBlokHtml\(/);
  assert.match(ekran, /c\.konu, \(index \+ 1\) \+ " \/ " \+ sorular\.length/);
  assert.match(ekran, /data-action="copy-checkpoint-soru" title="Maddeyi kopyala" aria-label="Maddeyi kopyala">📋<\/button>'/);
  assert.match(ekran, /aria-label="Çık">✕<span class="genis-etiket"> Çık<\/span><\/button>'/);
  assert.match(ekran, /← Önceki Madde/);
  assert.match(ekran, /Sonraki Madde →/);
  assert.doesNotMatch(ekran, /Soru →|Önceki Soru|soru\/adım|otomatik kaydediliyor/);
});

void test('checkpoint maddeleri ok tuşlarıyla gezilir; Çık AI ders listesine döner', () => {
  assert.match(script, /else if \(VIEW === "checkpointSoru" && currentCheckpoint && !currentCheckpoint\.bitti\) \{[\s\S]*?"ArrowRight"\) \{ e\.preventDefault\(\); checkpointSonraki\(\); \}[\s\S]*?"ArrowLeft"\) \{ e\.preventDefault\(\); checkpointOnceki\(\); \}/);
  const cik = fn('checkpointCik');
  assert.doesNotMatch(cik, /SlotYaz/);
  assert.match(cik, /VIEW = "menuTest"; render\(\);/);
  assert.doesNotMatch(cik, /checkpointDetay/);
});

void test('yarım kalan test/checkpoint kaydı hiçbir katmanda tutulmaz', () => {
  // 20 Eyl 2026: yerel yedek yalnız pBest taşır, STATE'te paused* alanları kalmadı.
  assert.match(fn('remoteSavePracticeLocal'), /pBest: STATE\.pBest/);
  assert.doesNotMatch(script, /pausedPratik|pausedCheckpoints/);
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
