// Arşiv iki katmanlı gezinme mantığının izole testi.
// Kod kopyalanmaz: ilgili fonksiyonlar index.html'den okunup çağrılır, böylece test
// dosyası gerçek kaynakla birlikte yaşlanmaz.
import { readFileSync } from "node:fs";

const s = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function fonksiyon(ad) {
  const re = new RegExp(String.raw`function ${ad}\s*\([\s\S]*?\n  \}`, "m");
  const m = s.match(re);
  if (!m) throw new Error("bulunamadı: " + ad);
  return m[0];
}
function blok(re) {
  const m = s.match(re);
  if (!m) throw new Error("blok bulunamadı: " + re);
  return m[0];
}

const kod = [
  'var PRATIK_TUM_MODULLER = "__TUMU__";',
  'var ARSIV_KONU = "Arşiv";',
  blok(/var MODUL_TANIMLARI = \{[\s\S]*?\n  \};/),
  blok(/var ARSIV_DERSLERI = \{[\s\S]*?\n  \};/),
  fonksiyon("arsivDersModulleri"),
  fonksiyon("arsivDersiBul"),
  fonksiyon("modulAdi"),
  fonksiyon("pratikSonrakiModul"),
  "return { arsivDersModulleri, arsivDersiBul, modulAdi, pratikSonrakiModul, ARSIV_DERSLERI };",
].join("\n");

// pratikSonrakiModul, Arşiv'de arsivSeciliDers'e bakıyor; parametre olarak veriyoruz.
const api = new Function("arsivSeciliDers", kod)("Kredi");

const esit = (a, b, ad) => {
  if (a !== b) throw new Error(`${ad}: beklenen ${JSON.stringify(b)}, gelen ${JSON.stringify(a)}`);
};

const mod = api.arsivDersModulleri("Kredi");
esit(mod.length, 16, "Kredi arşiv modül sayısı");
esit(mod[0].key, "K1", "ilk modül");
esit(mod[15].key, "K16", "son modül");
esit(api.arsivDersModulleri("Yok").length, 0, "tanımsız ders boş döner");

esit(api.arsivDersiBul("K9"), "Kredi", "K9 hangi ders");
esit(api.arsivDersiBul("M1"), null, "arşivde olmayan modül");

esit(api.modulAdi("Arşiv", "__TUMU__@Kredi"), "Kredi · Karışık — Tüm Modüller", "ders kapsamlı karışık adı");
esit(api.modulAdi("Arşiv", "__TUMU__"), "Karışık — Tüm Modüller", "genel karışık adı");
// Ders adı ekranın başlığında ("Arşiv · Kredi") duruyor; modül adında tekrarlanmaz.
esit(api.modulAdi("Arşiv", "K13"), "Teminat Mektuplarının Esasları ve Türleri", "gerçek modül adı");

// Ders sınırı: son modülden sonra başka bir dersin modülüne atlamamalı.
esit(api.pratikSonrakiModul("Arşiv", "K16"), null, "K16 sonrası");
esit(api.pratikSonrakiModul("Arşiv", "K1").key, "K2", "arşivde sıradaki modül");
esit(api.pratikSonrakiModul("Kredi", "K1").key, "K2", "normal konu bozulmadı");

// Slot anahtarı "konu::modul" ile ayrıştırılıyor; sözde modül "::" içermemeli.
if (Object.keys(api.ARSIV_DERSLERI).some((d) => ("__TUMU__@" + d).includes("::"))) {
  throw new Error("sözde modül anahtarı slot ayracıyla çakışıyor");
}

console.log("arşiv mantığı: tamam (16 modül, ders sınırı korunuyor, anahtar çakışması yok)");
