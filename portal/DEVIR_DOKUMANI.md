# UZYET paylaşım portalı — devir dokümanı

Son güncelleme: 7 Eylül 2026

## 1. Hedef ve kesinleşen kapsam

Amaç, GitHub Pages'te çalışan mevcut UZYET paylaşım sayfasını yalnız deneme
sınavına odaklanan ve ilerlemeyi kullanıcı bazında saklayan küçük bir arkadaş
grubu sistemine dönüştürmektir.

Kullanıcının son açıklamasıyla kesinleşen ürün kararları şunlardır:

- Mevcut HTML/Artifact görünümü ve sınav davranışı korunmalıdır. Arayüzü sıfırdan
  tasarlamak hedef değildir.
- Yeni sistem yalnız deneme sınavını kapsar. Kişisel Artifact'teki Test ve
  Checkpoint alanları bu portala taşınmayacaktır.
- Ziyaretçi istediği kullanıcı adını yazar ve erişim talebi oluşturur.
- Site sahibi talebi elle onayladığında kullanıcı etkinleşir.
- Kullanıcının sınavları, cevapları, geçmişi ve istatistikleri bu kullanıcıya
  bağlanır.
- Arkadaş grubu kullanımında e-posta, parola sıfırlama, ayrıntılı davet veya
  kurumsal kimlik yönetimi istenmemektedir.
- Veri altyapısı Supabase değil Neon olmalıdır. Tercihin sebebi, aynı hesapta
  çalışan `selport-main` projesindeki Neon deneyimidir.

Yalnız kullanıcı adıyla oturum açılması, kullanıcı adını bilen başka bir kişinin
aynı hesaba girebilmesi anlamına gelir. Bu risk ürün sahibi tarafından küçük ve
bilinen kullanıcı grubu bağlamında kabul edilebilir görülmektedir. Devralan kişi
kendiliğinden e-posta/parola sistemine dönmemelidir. Ek koruma gerekirse önce ürün
sahibine çok basit PIN veya ilk cihaz anahtarı seçeneği sorulmalıdır.

## 2. GitHub ve PR düzeni

Repo: `mselcukozturk/uzyet-paylasim`

Çalışma iki yığılmış taslak PR olarak gönderildi:

1. [PR #1 — Neon veri ve kullanıcı altyapısı](https://github.com/mselcukozturk/uzyet-paylasim/pull/1)
   - Dal: `codex/neon-user-data-backend`
   - Taban: `main`
   - Commit: `3983087`
2. [PR #2 — Portal arayüzü ve HTML uyumluluğu](https://github.com/mselcukozturk/uzyet-paylasim/pull/2)
   - Dal: `codex/neon-portal-frontend`
   - Taban: `codex/neon-user-data-backend`
   - Commit: `1df4996`

İnceleme/birleştirme sırası `#1 → #2` olmalıdır. İki commit birlikte geliştirme
sırasında oluşturulan 200 dosyayı içerir. Yerel sırlar ve üretilen bağımlılık
klasörleri Git'e eklenmemiştir.

`main` dalındaki kök `index.html` canlı GitHub Pages sürümüdür. Bu çalışma sırasında
değiştirilmemiştir; dolayısıyla PR'lar birleşmeden mevcut paylaşım sitesi etkilenmez.

## 3. Depodaki önemli dosyalar

### Mevcut canlı uygulama ve asıl davranış referansı

- `../index.html`: GitHub Pages'te çalışan paylaşım sürümü.
- `../../uzyet_quiz.html`: soru derleme şablonu; elle üretilen dağıtım dosyası
  yerine davranış referansı olarak kullanılmalıdır.
- `../../web_quiz_bank.json`: deneme bankasının kanonik kaynağı.
- `../../../../calisma_yonergeleri/web-quiz.md`: kişisel durum ve yayın güvenliği
  kuralları.

### Deneysel Neon portalı

- `app/exam-portal.tsx`: sıfırdan yazılmış mevcut Next.js arayüz denemesi.
- `app/api/exam/route.ts`: kullanıcıya bağlı sınav API'si.
- `app/actions/auth.ts`: mevcut e-posta/parola giriş ve parola yenileme akışı.
- `lib/db/schema.ts`: Drizzle tablo tanımları.
- `drizzle/`: uygulanmış PostgreSQL migrationları.
- `scripts/sync-question-bank.mjs`: kanonik bankayı Neon'a aktarır.
- `scripts/activate-user.mjs`: mevcut Neon Auth profil etkinleştirme komutu.
- `tests/exam-core.test.ts`: çekirdek sınav üretimi testleri.
- `.env.example`: gerekli ortam değişkenlerinin yalnız örnek isimleri.

### Arşivler

- `../Eski/portal_supabase_20260907_224500/`: Neon kararından önceki Supabase
  tabanlı deneme.
- `Eski/activate_user_users_sync_20260907_231500/`: eski Neon Auth tablo adına
  göre yazılmış etkinleştirme komutu.
- `Eski/password_reset_oncesi_20260907_232000/`: parola yenileme ekranından önceki
  ara sürüm.

Arşivler güncel uygulama talimatı değildir; yalnız geçmişi ve geri dönüş imkânını
korur.

## 4. Şu anda kurulmuş teknik altyapı

### Neon

- Proje adı: `uzyet-portal`
- Proje kimliği: `morning-leaf-95749537`
- Bölge: `aws-eu-central-1`
- PostgreSQL: 18
- Neon Auth: etkin; Better Auth tabanlı
- E-posta/parola girişi: etkin
- Açık kullanıcı kaydı: kapalı
- `http://localhost:3000`: geliştirme için güvenilir yönlendirme alanı olarak
  eklenmiş durumda

Veritabanına iki migration uygulanmıştır. Bir aktif banka ve 2.180 soru vardır.
Aktif banka sürümü `357636e8014c0715` değeridir.

Neon'da geliştirme sırasında bir yönetici/test kullanıcısı oluşturulmuştur. E-posta,
parola ve kullanıcı kimliği repoya yazılmamıştır. Nihai sade kullanıcı akışına
geçerken bu kayıt Neon üzerinden gözden geçirilmeli; gerekiyorsa kaldırılmalı veya
yeni modele dönüştürülmelidir.

### Vercel

- Takım/proje: `selcuk12/uzyet-portal`
- Proje kimliği: `prj_J8Y73ioYZEYROo1vLZDegg1ZWnfy`
- Next.js framework ayarı yapılmıştır.
- Production, Preview ve Development ortamları için Neon bağlantı değişkenleri
  tanımlanmıştır.
- Sunucu fonksiyon bölgesi `vercel.json` içinde `fra1` olarak seçilmiştir.
- Hiçbir Vercel deployment yapılmamıştır.

Vercel'in yerel `vercel build` komutu Preview sırlarını `[SENSITIVE]` olarak
maskelediği için cookie-secret uzunluk kontrolünde durmuştur. Gerçek yerel ortam
değerleriyle normal `npm run build` başarılıdır. Bu bir kaynak kod derleme hatası
değildir.

## 5. Mevcut veri modeli ve davranış

Şu anki şema şu kayıtları tutar:

- `profiles`: uygulama kullanıcısı, kullanıcı adı, aktif/yönetici bayrakları
- `question_banks`, `questions`: sürümlü soru bankaları
- `exam_attempts`: sınav oturumları ve sınav kodu
- `exam_attempt_questions`: sınav başındaki soru/şık görüntüsü
- `exam_answers`: kullanıcının cevapları
- `question_stats`: kullanıcı-soru bazında görülme/doğru/yanlış istatistiği
- `question_flags`: hata bildirimleri

Başlanmış sınavın soru ve şıkları ayrıca saklandığından, banka daha sonra değişse
bile tarihsel sınav yeni içeriğe göre yeniden yorumlanmaz. Bütün sınav sorguları
sunucudaki oturum kullanıcısıyla filtrelenir. Cevap anahtarı sınav bitmeden
istemciye gönderilmez. Sınav bitirme ve istatistik güncelleme işlemi transaction ve
satır kilidiyle korunur.

Bu veri katmanı yeniden kullanılabilir. Değiştirilmesi gereken asıl bölüm mevcut
Neon Auth/e-posta modeli ile sıfırdan yazılan arayüzdür.

## 6. Bilinen kapsam sapmaları ve teknik borç

### A. Kullanıcı akışı gereğinden karmaşık

Mevcut kodda kullanıcı önce Neon Auth'ta e-posta hesabı olarak oluşturuluyor, sonra
`profiles` tablosunda etkinleştiriliyor ve ilk parola/yenileme akışı kullanılıyor.
Bu, istenen ürün değildir.

Hedef akış için önerilen en küçük model:

1. Herkese açık küçük form yalnız `username` alır.
2. `user_requests` benzeri tabloda `pending` talep oluşur.
3. Site sahibi için ayrı ve basit bir onay ekranı bulunur.
4. Onay işlemi talebi `approved` yapar ve kullanıcı kaydını etkinleştirir.
5. Kullanıcı adıyla açılan oturum veya cihaz anahtarı tüm kayıtların sahibi olur.

Saf kullanıcı adı seçilecekse Neon Auth tamamen kaldırılabilir. Yönetici ekranının
korunması için ise kullanıcılarınkinden ayrı tek bir sahip anahtarı veya mevcut
yönetici oturumu tutulmalıdır.

### B. HTML/Artifact deneyimi korunmadı

`portal/app/exam-portal.tsx` mevcut HTML'yi uyarlamak yerine yeni bir arayüz kurar.
Bu bir deneme olarak değerlendirilmeli, nihai tasarım olarak kabul edilmemelidir.

Doğru devam yöntemi:

1. Kök `index.html` ve kanonik quiz şablonundaki ekranları/davranışları envanterle.
2. Mevcut DOM, görünüm, klavye/dokunma davranışı ve sınav akışını koru.
3. `localStorage` kullanan kayıt noktalarını bir depolama adaptörünün arkasına al.
4. Yeni adaptörü Neon API'sine bağla.
5. Mevcut kullanıcı durum alanlarını ve gerçek soru GUID kümelerini önce/sonra
   karşılaştır.

Korunması gereken kişisel alanlar: `stats`, `pStats`, `history`, `flags` ve yarım
oturum/`pausedExam` durumudur. Kullanıcı açıkça istemeden bu alanlar sıfırlanmamalı
veya yeni banka içeriğiyle yeniden yorumlanmamalıdır.

### C. Diğer notlar

- Parola yenileme sayfasındaki `Button` içinde `Link` kullanımı geliştirme
  konsolunda Base UI `nativeButton` erişilebilirlik uyarısı üretmektedir.
- PR #1 tek başına bütün Next.js arayüzünü içermez; tam üretim build doğrulaması
  iki yığılmış commit birlikteyken yapılmıştır.
- Gerçek Neon API'si için uçtan uca otomatik entegrasyon testi henüz yoktur.
- Geliştirme, bulut senkronizasyonlu çalışma dizisindeki `node_modules` sorunları
  nedeniyle geçici yerel bir build klasöründe doğrulanmıştır. Devralan kişi temiz
  bir yerel clone üzerinde `npm ci` kullanmalıdır.

## 7. Doğrulananlar

İki commit birlikteyken aşağıdaki sonuçlar alınmıştır:

- `npm run lint`: başarılı
- `npx tsc --noEmit`: başarılı
- `npm test`: 6/6 başarılı
- `npm run bank:check`: 2.180 soru, sürüm `357636e8014c0715`
- `npm run build`: başarılı
- `npm audit`: 0 güvenlik açığı
- `/reset-password`: yerelde HTTP 200
- Yetkisiz `/api/exam` isteği: HTTP 401
- Yerel Neon Auth giriş/parola yenileme ve sınav API istekleri çalıştırılmıştır

Bu kontroller mevcut uygulamanın hedef ürüne uyduğu anlamına gelmez; yalnız mevcut
denemenin teknik olarak çalıştığını gösterir.

## 8. Devralan kişi için kurulum

İki PR'ın birleşik halini incelemek için:

```sh
git fetch origin
git switch codex/neon-portal-frontend
cd portal
npm ci
```

`.env.example` dosyasını yerel `.env.local` için şablon olarak kullan. Gerçek
değerler GitHub'da yoktur ve Neon/Vercel erişimi olan hesaptan alınmalıdır.

Neon CLI bağlantısı:

```sh
neon auth
neon link --project-id morning-leaf-95749537
neon env run -- npm run db:migrate
neon env run -- npm run bank:sync
```

Kontroller:

```sh
npm run lint
npm test
npm run bank:check
npm run build
npm run dev
```

`bank:check` ve `bank:sync`, normal repo diziliminde
`08 Sorular/birlestir/web_quiz_bank.json` dosyasını okur. Başka bir checkout düzeni
kullanılırsa `QUESTION_BANK_PATH` açıkça verilmelidir.

## 9. Önerilen devam sırası

1. Bu dokümandaki hedef akışı ürün sahibiyle bir kez teyit et; yeni özellik
   ekleme.
2. Kök HTML ve kişisel Artifact davranışlarını referans alarak korunacak ekran ve
   durum alanlarını çıkar.
3. Basit kullanıcı adı talebi ve yönetici onay modelini tasarla.
4. E-posta/parola bağımlılığını kaldır veya yalnız yönetici tarafına indir.
5. Mevcut HTML'nin kayıt işlemlerini Neon API'sine bağla.
6. Gerçek GUID kümeleri ile `stats/pStats/history/flags/pausedExam` fark testlerini
   ekle.
7. Yetkisiz erişim, kullanıcılar arası veri ayrımı, yarım sınav ve idempotent bitirme
   için entegrasyon testleri yaz.
8. Ürün sahibine yerel/preview sürümü göster; onay almadan canlı `index.html` veya
   yönlendirmeleri değiştirme.
9. Canlıya alma ayrıca istendiğinde Web Quiz yönergesindeki yedekleme ve yayın
   kontrollerini uygula.

## 10. Yapılan / yapılmayan özeti

| Konu | Durum |
|---|---|
| Neon projesi ve PostgreSQL şeması | Yapıldı |
| 2.180 soruluk bankanın Neon'a aktarılması | Yapıldı |
| Kullanıcıya bağlı deneme kayıt API'si | Yapıldı |
| Mevcut HTML'nin korunarak Neon'a bağlanması | Yapılmadı |
| Basit kullanıcı adı talebi ve sahip onayı | Yapılmadı |
| E-posta/parola tabanlı deneysel giriş | Yapıldı; hedefe uygun değil |
| Next.js deneysel arayüz | Yapıldı; hedefe uygun değil |
| GitHub dalları ve iki taslak PR | Yapıldı |
| GitHub Pages canlı sürüm değişikliği | Yapılmadı |
| Vercel deployment | Yapılmadı |
| Kişisel Artifact yayını | Yapılmadı |

## 11. Güvenlik ve erişim notu

`.env.local`, `.vercel/`, `.neon/`, veritabanı bağlantı adresi, Neon Auth cookie
secret ve Vercel erişim değerleri Git'e gönderilmemiştir. Devralacak kişinin GitHub,
Neon ve Vercel projelerine ayrıca yetkilendirilmesi gerekir. Hiçbir sır PR yorumuna,
commit mesajına veya bu belgeye eklenmemelidir.
