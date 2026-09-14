import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script id="app-script">([\s\S]*?)<\/script>/);
assert.ok(scriptMatch);
const script = scriptMatch[1];

function fn(name: string) {
  return script.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?^  \\}', 'm'))?.[0] ?? '';
}

void test('🤖 butonu yalnız yetkili hesapta basılır ve AI modu kalıcı değildir', () => {
  // Buton, ana sayfa ve AI ekranlarının ortak üst çubuğunda (ustBarHtml) basılır.
  assert.match(fn('renderMenuDeneme'), /ustBarHtml\(\)/);
  const menuDeneme = fn('ustBarHtml');
  assert.match(menuDeneme, /canSeeAiSources === true \? '<button[^']*data-action="open-ai-sources"/);
  // Buton görünürlük katmanı; gerçek kontrol sunucuda. İstemci yine de kapıyı iki yerde tutar.
  assert.match(fn('openAiSources'), /remoteAuth\.canSeeAiSources !== true\) return;/);
  // Bayrak bellek içi: sayfa yenilenince AI modu kapanır, STATE'e/localStorage'a hiç yazılmaz.
  assert.match(script, /\n  var aiModu = false;/);
  assert.doesNotMatch(script, /STATE\.aiModu|"aiModu"/);
});

void test('AI ekranının baştaki yalnız-düğme satırı üst çubuğa alınır, metinli satır yerinde kalır', () => {
  const kaynak = script.match(/var EKRAN_UST_SATIR_RE = (\/.*\/);/)?.[1];
  assert.ok(kaynak, 'EKRAN_UST_SATIR_RE bulunamadı');
  const re = new Function('return ' + kaynak)() as RegExp;
  const moduller = '<div class="link-row"><button class="btn" data-action="pratik-konu-geri">← Konulara Dön</button></div><div class="section-title">Kredi</div>';
  assert.equal(moduller.match(re)?.[1], '<button class="btn" data-action="pratik-konu-geri">← Konulara Dön</button>');
  // Kaydet ve Çık satırı stil ve metin içerir — soru ekranının parçası, taşınmaz.
  assert.equal('<div class="link-row" style="margin-bottom:10px"><button class="btn primary">💾 Kaydet ve Çık</button><span>x</span></div>'.match(re), null);
  assert.match(fn('render'), /ustBarHtml\(ekranUstSatir \? ekranUstSatir\[1\] : ""\)/);
});

void test('üst çubuk mobilde tek satır: 🤖, geri ve çıkış yalnız emoji, metin erişilebilir etikette', () => {
  const ustBar = new Function('remoteGirisTamamMi', 'remoteAuth', 'escapeHtml',
    fn('ustBarHtml') + '\nreturn ustBarHtml;')(() => true, { canSeeAiSources: true, username: 'selcuk' }, (s: string) => s);
  const bar = ustBar('<button class="btn" data-action="pratik-konu-geri">← Konulara Dön</button>');
  assert.match(bar, /data-action="open-ai-sources" title="Yapay Zekâ Kaynakları" aria-label="Yapay Zekâ Kaynakları">🤖<\/button>/);
  assert.match(bar, /data-action="pratik-konu-geri" title="Konulara Dön" aria-label="Konulara Dön">⬅️<\/button>/);
  assert.match(bar, /data-action="deneme-cikis-yap" title="Çıkış" aria-label="Çıkış">🚪<\/button>/);
  assert.doesNotMatch(bar, />[^<]*(Yapay Zekâ Kaynakları|Çıkış|←)[^<]*<\/button>/);
  assert.match(html, /\.ust-bar \{ flex-wrap: nowrap;/);
});

void test('pratik soru üst bloğu: bilgi solda, 📋 ve 💾 sağda aynı satırda; mobilde yazılar gizlenir', () => {
  const soru = fn('renderPratikSoru');
  assert.match(soru, /'<div class="pratik-ust"><div class="pratik-ust-bilgi">'/);
  assert.match(soru, /data-action="copy-soru" data-scope="pratik" title="Soruyu kopyala" aria-label="Soruyu kopyala">📋<\/button>'/);
  assert.match(soru, /aria-label="Kaydet ve Çık">💾<span class="genis-etiket"> Kaydet ve Çık<\/span><\/button>'/);
  assert.doesNotMatch(soru, /kopyalaButonHtml\("pratik"\)/);
  // Üst satır "• Ders | x / y cevaplandı"; otomatik kayıt açıklaması gösterilmez.
  assert.match(soru, /konuDotHtml\(q\.konu\) \+ escapeHtml\(q\.konu\) \+ " \| " \+\s*cevaplananSayisi \+ " \/ " \+ currentPratik\.kuyruk\.length \+ " cevaplandı<\/div>"/);
  assert.doesNotMatch(soru, /otomatik kaydediliyor/);
  assert.match(html, /@media \(max-width: 560px\) \{ \.genis-etiket \{ display: none; \} \}/);
});

void test('AI modu yalnız pratik ve checkpoint ekranlarını açar; ayarlar ve import kapalı kalır', () => {
  const render = fn('render');
  assert.match(render, /STATE\.sadeceDeneme && !aiModu && \(VIEW === "menu"/);
  assert.match(render, /VIEW === "settings" \|\| VIEW === "import"\)\) VIEW = aiModu \? "menuTest" : "menuDeneme"/);
  // Yetki sonradan düşerse (oturum yenilenince) AI modu kendini kapatır.
  assert.match(render, /if \(aiModu && \(!remoteGirisTamamMi\(\) \|\| remoteAuth\.canSeeAiSources !== true\)\)/);
  assert.match(fn('ustBarHtml'), /data-action="go-home"/);
});

void test('AI ders listesi ayarlar, içe aktarma ve düzeltme listesini göstermez', () => {
  const menu = fn('renderMenuTest');
  assert.match(menu, /data-action="select-pratik-konu"/);
  assert.doesNotMatch(menu, /open-settings|open-import|open-duzeltmeler|open-checkpoint-liste/);
});

void test('uyarı yalnız ilk girişte gösterilir, kabul sunucuya kalıcı yazılır ve kapatılabilir', () => {
  assert.match(script, /var AI_KAYNAK_UYARISI = "Buradaki soru ve konular yapay zekâ ile kişisel kullanım için üretildi, doğruluğu ve kapsamı teyit edilmedi\.";/);
  // Daha önce kabul edilmişse modal atlanıp doğrudan bölüm açılır.
  assert.match(fn('openAiSources'), /if \(remoteAuth\.aiDisclaimerAccepted\) \{ acceptAiSources\(\); return; \}/);
  // İlk kabulde (yalnız modal açıkken ve henüz kabul edilmemişken) sunucuya kalıcı yazılır.
  const accept = fn('acceptAiSources');
  assert.match(accept, /var ilkKabul = aiUyariAcik && !remoteAuth\.aiDisclaimerAccepted;/);
  assert.match(accept, /remoteFetch\("\/api\/access", "POST", \{ acceptAiDisclaimer: true \}\)/);
  // Tek butonlu ama çıkışsız değil: Esc ve karartma alanı kapatır, gövde tıklaması yutulur.
  assert.match(script, /if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); closeAiUyari\(\); \}/);
  assert.match(script, /data-action="close-ai-uyari"/);
  assert.match(script, /data-action="ai-uyari-govde"/);
});

void test('"sınav bankasına aday" ve "kapsam dışı" işaretleri yalnız yönetici hesabında görünür', () => {
  assert.match(script, /var pratikExtraBtns = \(showPratikExtras && remoteAuth\.isAdmin\)/);
});

void test('bölüm açılınca tembel yükleyiciler çağrılır, hata olursa Deneme ekranına dönülür', () => {
  const accept = fn('acceptAiSources');
  assert.match(accept, /remoteLoadPracticeBankIfNeeded\(\), remoteLoadCheckpointsIfNeeded\(\), remoteLoadPracticeStats\(\)/);
  assert.match(accept, /aiYukleniyor = true/);
  assert.match(accept, /aiModu = false; VIEW = "menuDeneme"/);
  // Yarım pratik oturumu Deneme'ye dönerken kaybolmasın diye önce diske yazılır.
  assert.match(fn('leaveAiSources'), /pratikSlotYaz\(\); veriDegisti\(\)/);
});

void test('çıkışta AI içeriği ve pratik ilerlemesi bellekten temizlenir', () => {
  const cikis = fn('denemeCikisYap');
  for (
    const parca of [
      'aiModu = false',
      'STATE.practiceBank = []',
      'STATE.checkpoints = []',
      'STATE.pStats = {}',
      'remotePracticeBankLoaded = false',
      'remoteCheckpointsLoaded = false',
      'canSeeAiSources: false',
    ]
  ) assert.ok(cikis.includes(parca), parca + ' çıkışta temizlenmeli');
});
