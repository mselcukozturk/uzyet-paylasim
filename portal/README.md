# UZYET Deneme Portalı

Davetli kullanıcıların 50 soruluk deneme sınavlarını çözdüğü, yarım sınav ve
geçmiş verisini hesap bazında Neon Postgres'te saklayan Next.js uygulaması.
Kişisel Artifact'teki Test ve Checkpoint alanları bu uygulamanın kapsamında
değildir.

## Mimari

- Next.js 16 ve Vercel uyumlu Node.js route handler'ları
- Neon Auth ile e-posta/parola oturumu
- Kullanıcı adı veya e-posta ile giriş
- Neon Postgres ve Drizzle şeması
- Sürüm korumalı soru bankası ve sınav anı görüntüleri
- Tarayıcıya sınav bitmeden cevap anahtarı göndermeyen sunucu API'si

Kullanıcı kaydı Neon Auth tarafında kapalıdır. Bir Neon Auth kullanıcısı ancak
`profiles.is_active = true` olduğunda sınav verisine erişebilir.

## Yerel geliştirme

Ortam değişkenleri yoksa uygulama beş yapay soruluk önizleme modunda açılır;
gerçek kullanıcı veya UZYET sorusu kullanılmaz.

```sh
npm install
npm run dev
npm test
npm run bank:check
npm run build
```

Gerçek Neon ortamında `.env.example` değerlerini `.env.local` içinde doldur.
Bu dosya Git'e eklenmez.

## Neon kurulumu

Klasör `uzyet-portal` Neon projesine bağlıdır. CLI ile gizli bağlantı değerini
dosyaya yazmadan işlem yapılabilir:

```sh
neon env run -- npm run db:migrate
neon env run -- npm run bank:sync
```

Alternatif olarak `DATABASE_URL` tanımlıyken:

```sh
npm run db:migrate
npm run bank:sync
```

Migration'lar `drizzle/` altında tutulur ve `_migrations` tablosu aracılığıyla
yalnız bir kez uygulanır. Soru aktarımı `web_quiz_bank.json` içeriğini doğrular,
hash tabanlı yeni bir banka sürümü oluşturur ve eski sürümleri silmez.

## Davetli kullanıcı

1. Neon Auth kullanıcısını oluştur:

```sh
neon neon-auth user create --email kullanici@example.com --name "Ad Soyad"
```

2. Kullanıcı ilk parola/hesap akışını tamamladıktan sonra profili etkinleştir:

```sh
npm run user:activate -- kullanici@example.com kullaniciadi
```

İlk yönetici için sona `--admin` eklenir. Kullanıcı adı küçük harf, rakam,
nokta, tire ve alt çizgiden oluşur.

## Güvenlik sınırı

- `DATABASE_URL` ve `NEON_AUTH_COOKIE_SECRET` yalnız sunucuda bulunur.
- Bütün sınav sorguları oturumdaki kullanıcı kimliğiyle filtrelenir.
- İstemci tarafından gönderilen kullanıcı kimliğine güvenilmez.
- Soru bankası ve cevap anahtarı istemci paketine eklenmez.
- Doğru cevap ve açıklama yalnız sınav tamamlandıktan sonra döner.
- Tamamlama ve istatistik yazımı kilitli bir veritabanı işlemi içinde yapılır.
- Açık kullanıcı kaydı kapalıdır; profil etkinleştirme ayrıca gerekir.

## Yayın sınırı

Mevcut kök `index.html` canlı GitHub Pages sürümüdür ve bu geliştirme sırasında
değiştirilmez. Portal güvenlik testlerinden geçmeden GitHub Pages kapatılmaz,
repo geçmişi temizlenmez veya canlı yönlendirme yapılmaz.
