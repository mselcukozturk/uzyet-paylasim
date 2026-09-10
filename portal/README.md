# UZYET Deneme Portalı

Canlı: <https://uzyet-portal.vercel.app/> · Vercel projesi `uzyet-portal`, Root Directory =
`portal`. `main`'e push → otomatik build + deploy; elle `vercel deploy` gerekmez.

## Mimari

- **Next.js (Vercel) + Neon Postgres.** Sunucu tarafı `app/api` altında, şema
  `lib/db/schema.ts` (Drizzle).
- **İstemci tek dosya: `public/index.html`.** Bu dosya **ana kaynaktır ve elle
  düzenlenir** — 9 Eyl 2026'ya kadar geçerli olan "`uzyet_quiz.html` şablonundan
  `build_quiz_dist.py` ile derlenir, elle düzenlenmez" kuralı, kişisel Artifact emekliye
  ayrıldığı için tarihsel hâle geldi. Dosyanın başındaki yorum bloğu bunu tekrarlar.
- **Soru bankası HTML'e hiç gömülmez.** `app-state` JSON'unda `bank`, `practiceBank`,
  `checkpoints` boş başlar; içerik yalnız yetkili bir oturuma sunucudan gelir.
- **API yüzeyi:**
  - `app/api/access` — kayıt/giriş (isim + PIN), oturum durumu, disclaimer onayı.
  - `app/api/exam` — **action tabanlı** tek uç. Deneme: `bank`, `start`, `answer`,
    `pause`, `resume`, `finish`, `dashboard`, `history`, `flags`, `flag`, `reminders`,
    `corrections`, `wrong-questions`. AI kaynakları: `practice-bank`, `checkpoints`,
    `practice-stats`, `practice-answer`, `practice-session-save/load/delete`.
  - `app/api/admin/*` — token korumalı bakım uçları (aşağıda).
  - `app/api/auth/[...path]` — Neon Auth (yalnız yönetici hesabı).

## Yetki katmanları

Sırayla: **oturum** (isim + 4 haneli PIN; PIN `PIN_ENCRYPTION_KEY` ile AES-256-GCM
şifrelenir, hash değil) → **yönetici onayı** (`profiles.is_active`, `/admin`den verilir) →
**disclaimer** (`disclaimer_accepted_at`) → AI kaynakları için ayrıca
**`profiles.can_see_ai_sources`** (varsayılan `false`).

Son bayrak sunucu tarafında zorlanır (`requireAiSources`, `app/api/exam/route.ts`);
istemcideki 🤖 butonu yalnız görünürlüktür, erişim kontrolü değildir.

## İki içerik kanalı

Her ikisi de `Authorization: Bearer $FLAGS_EXPORT_TOKEN` ister ve sürümü gövde metninin
SHA256'sinin ilk 16 hanesinden türetir; aynı gövde tekrar gönderilirse yeniden yazmaz.
Fark: `sync-bank` her sürümü `question_banks` içinde **saklar** ve yalnız aktif olanı
değiştirir (eski denemeler kendi bankalarına bağlı kalsın diye), `sync-practice` ise
pratik içeriğini tek işlemde **değiştirir** — pratik ilerlemesi guid bazlı olduğu için
sürüm geçmişi tutmaya gerek yok.

| Uç | İçerik | Gövde |
|---|---|---|
| `POST /api/admin/sync-bank` | Deneme bankası (`question_bank`) | düz JSON **dizisi** |
| `POST /api/admin/sync-practice` | AI kaynakları: pratik sorular + checkpoint'ler | `{"questions":[…],"checkpoints":[…]}` **nesnesi** |

`sync-practice` gövdesi Türkçe alan adlarını bekler: soru için `guid`, `konu`, `modul`,
`soru`, `siklar` (2–4), `cevapIdx`, `aciklama`, `kaynak`; checkpoint için `id`, `konu`,
`title`, `subtitle`, `html` (sıra dizideki sıradır). Doğrulama `lib/practice-sync.ts`de,
testi `tests/practice-sync.test.ts`.

## İki istatistik havuzu — neden ayrı

`question_stats` yalnız **Deneme**, `practice_stats` yalnız **AI kaynakları** içindir.
Karıştırma: `dashboard()` ve `wrongQuestionGuids()` kullanıcının tüm `question_stats`
satırlarını **filtresiz** toplar; pratik cevapları oraya yazılırsa Deneme'nin genel
doğruluk oranı ve "Yanlış Sorular" kartı bozulur.

Buna karşılık `question_flags` guid bazlıdır ve iki havuzun guid uzayları kesişmez, bu
yüzden 🔖 hatırlatıcı / 🚩 hata bildirimi her iki havuzda da tek kodla çalışır.

## Şema değişikliği akışı

1. `lib/db/schema.ts` + yeni `drizzle/000N_*.sql`
2. `npm run db:gen` — SQL'ler `lib/db/migrations.generated.ts`e gömülür (`prebuild` ile de
   çalışır; unutulursa `npm test` yakalar)
3. merge → deploy
4. `GET /api/admin/migrate` ile durumu oku (`{toplam, uygulanmis, bekleyen[]}`), sonra
   `POST` et

**DDL'i idempotent yaz** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`):
`_migrations` kaydı ile gerçek şemanın ayrışabildiği görüldü (bir migration prod'a betik
dışında uygulanmış, kaydı yokken sütun vardı).

## Diğer bakım uçları

- `GET/POST /api/admin/flagged-questions` — açık işaretleri döner / çözüldü işaretler.
- `POST /api/admin/activate-user` — `{"email","username","admin":true}`. Tek fark:
  `FLAGS_EXPORT_TOKEN` değil ayrı bir **`ADMIN_SETUP_TOKEN`** ister; o değişken tanımlı
  değilse uç 404 döner. Akış: Vercel'de değişkeni geçici tanımla → isteği at → **sil**.
  Gerekçe: bu uç `is_admin` verebiliyor, günlük işlerin paylaşık tokenına kalıcı yetki
  yükseltme gücü verilmedi.

## Test

```
cd portal
npx tsc --noEmit
npm test          # node --test tests/*.test.ts
npm run lint      # oxlint
```

`tests/` iki tür sınama içerir: sunucu mantığı (pglite üzerinde gerçek sorgular) ve
`public/index.html`in script bloğunu okuyup davranış kurallarını bağlayan istemci
testleri.

**Preview deploy'ları prod Neon veritabanına bağlanır.** Preview'da yalnız salt okunur
doğrulama yap; yazma testlerini merge sonrası prod'da yürüt. Preview'lar Vercel SSO
arkasındadır; `x-vercel-protection-bypass: <secret>` başlığı bunu aşar. Ortam değişkenleri
deploy anında sabitlenir — yeni eklenen bir değişkeni mevcut preview'lar görmez.

## Ortam değişkenleri (Vercel)

`DATABASE_URL` (Neon entegrasyonu) · `PIN_ENCRYPTION_KEY` · `FLAGS_EXPORT_TOKEN`
(sync-bank + sync-practice + migrate + flagged-questions) · `ADMIN_SETUP_TOKEN` (yalnız
geçici) · Neon Auth anahtarları.
