# UZYET Deneme Portalı

Davetli kullanıcıların 50 soruluk deneme sınavlarını çözdüğü, yarım sınav ve
geçmiş verisini hesap bazında saklayan yeni portal. Kişisel Artifact'teki Test ve
Checkpoint alanları bu uygulamanın kapsamında değildir.

## Güvenlik sınırı

- Soru bankası ve cevap anahtarı istemci paketine eklenmez.
- Tarayıcı yalnız başladığı sınavın soru/şık görüntüsünü alır.
- Doğru cevaplar yalnız sınav tamamlanınca `exam-api` tarafından döner.
- Veritabanı tabloları `anon` ve `authenticated` rollerine kapalıdır; işlemler
  kullanıcı JWT'sini doğrulayan Edge Function üzerinden yapılır.
- Service/secret key yalnız Supabase Function ve yerel yönetim komutlarında tutulur.

## Yerel geliştirme

Ortam değişkenleri yoksa uygulama beş yapay soruluk önizleme modunda açılır; gerçek
kullanıcı veya UZYET sorusu kullanılmaz.

```sh
npm install
npm run dev
npm test
npm run bank:check
```

## Supabase kurulumu

1. Yeni bir Supabase projesi oluştur.
2. `supabase/migrations/202609070001_portal_schema.sql` migrasyonunu uygula.
3. `supabase/functions/exam-api` fonksiyonunu deploy et.
4. Fonksiyon secret'larına `ALLOWED_ORIGINS` değerini ve Supabase'in sağladığı
   servis değişkenlerini ekle.
5. Auth ayarlarında genel kullanıcı kaydını kapalı tut; yalnız davet akışını kullan.
6. `.env.example` dosyasını `.env.local` olarak kopyalayıp gerçek değerleri yalnız
   yerelde doldur.
7. `npm run bank:sync` ile `../../web_quiz_bank.json` kaynağını sürümlü olarak aktar.

Kullanıcı daveti:

```sh
npm run user:invite -- kullanici@example.com
```

## Yayın geçişi

Mevcut kök `index.html` canlı GitHub Pages sürümüdür ve bu geliştirme sırasında
değiştirilmez. Yeni portal güvenlik testlerinden geçmeden GitHub Pages kapatılmaz,
repo geçmişi temizlenmez ve canlı yönlendirme yapılmaz.

