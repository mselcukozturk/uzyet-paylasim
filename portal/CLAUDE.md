# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proje

UZYET Deneme Portalı — Next.js (Vercel) + Neon Postgres. Canlı: https://uzyet-portal.vercel.app/
(Vercel projesi `uzyet-portal`, Root Directory = `portal`). `main`'e push → otomatik build + deploy;
elle `vercel deploy` gerekmez.

## Komutlar

Hepsi `portal/` içinden çalıştırılır:

```
npx tsc --noEmit          # tip kontrolü
npm test                  # node --test tests/*.test.ts (tüm testler)
node --test tests/exam-core.test.ts   # tek dosya
npm run lint              # oxlint app lib components/portal scripts tests
npm run format            # oxfmt
npm run db:gen            # şema değişince: SQL'leri lib/db/migrations.generated.ts'e göm
npm run dev               # yerel dev sunucu
```

`db:gen`, `prebuild` ile otomatik çalışır; unutulursa `npm test` bunu yakalar
(`tests/migrations-embedded.test.ts`).

## Mimari

- Sunucu tarafı `app/api` altında, DB şeması `lib/db/schema.ts` (Drizzle).
- **İstemci tek dosya: `public/index.html`.** Bu dosya **ana kaynaktır ve elle
  düzenlenir** (derleme adımı yok — dosyanın başındaki yorum bloğu bu tarihi kuralı
  tekrarlar, artık geçerli değil).
- **Soru bankası HTML'e hiç gömülmez.** `app-state` JSON'unda `bank`, `practiceBank`,
  `checkpoints` boş başlar; içerik yalnız yetkili bir oturuma sunucudan gelir.
- **API yüzeyi:**
  - `app/api/access` — kayıt/giriş (isim + PIN), oturum durumu, disclaimer onayı.
  - `app/api/exam` — **action tabanlı** tek uç. Deneme: `bank`, `start`, `answer`,
    `pause`, `resume`, `finish`, `dashboard`, `history`, `flags`, `flag`, `reminders`,
    `corrections`, `wrong-questions`. AI kaynakları: `practice-bank`, `checkpoints`,
    `practice-stats`, `practice-answer`, `practice-session-save/load/delete`.
  - `app/api/admin/*` — token korumalı bakım uçları (bkz. aşağı).
  - `app/api/auth/[...path]` — Neon Auth (yalnız yönetici hesabı).
- İş mantığı `lib/exam-core.ts` (deneme) ve `lib/practice-core.ts` (AI kaynakları) içinde;
  route dosyaları ince kalır.

## Yetki katmanları

Sırayla: **oturum** (isim + 4 haneli PIN; PIN `PIN_ENCRYPTION_KEY` ile AES-256-GCM
şifrelenir, hash değil, bkz. `lib/auth/session.ts`) → **yönetici onayı**
(`profiles.is_active`, `/admin`den verilir) → **disclaimer** (`disclaimer_accepted_at`) →
AI kaynakları için ayrıca **`profiles.can_see_ai_sources`** (varsayılan `false`).

Son bayrak sunucu tarafında zorlanır (`requireAiSources`, `app/api/exam/route.ts`);
istemcideki 🤖 butonu yalnız görünürlüktür, erişim kontrolü değildir.

## İki içerik senkron kanalı

Her ikisi de `Authorization: Bearer $FLAGS_EXPORT_TOKEN` ister ve sürümü gövde metninin
SHA256'sının ilk 16 hanesinden türetir; aynı gövde tekrar gönderilirse yeniden yazmaz.
Fark: `sync-bank` her sürümü `question_banks` içinde **saklar** ve yalnız aktif olanı
değiştirir (eski denemeler kendi bankalarına bağlı kalsın diye); `sync-practice` ise
pratik içeriğini tek işlemde **değiştirir** (pratik ilerlemesi guid bazlı olduğu için
sürüm geçmişi tutmaya gerek yok).

| Uç | İçerik | Gövde |
|---|---|---|
| `POST /api/admin/sync-bank` | Deneme bankası (`question_bank`) | düz JSON **dizisi** |
| `POST /api/admin/sync-practice` | Pratik sorular + checkpoint'ler | `{"questions":[…],"checkpoints":[…]}` **nesnesi** |

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
2. `npm run db:gen` — SQL'ler `lib/db/migrations.generated.ts`e gömülür
3. merge → deploy
4. `GET /api/admin/migrate` ile durumu oku (`{toplam, uygulanmis, bekleyen[]}`), sonra `POST` et

**DDL'i idempotent yaz** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`):
`_migrations` kaydı ile gerçek şemanın ayrışabildiği görüldü (bir migration prod'a betik
dışında uygulanmış, kaydı yokken sütun vardı).

## Diğer bakım uçları

- `GET /api/admin/export-bank` — aktif soru bankasını Excel'de açılan CSV olarak döner.
- `GET/POST /api/admin/flagged-questions` — açık işaretleri döner / çözüldü işaretler.
- `POST /api/admin/activate-user` — `{"email","username","admin":true}`. Tek fark:
  `FLAGS_EXPORT_TOKEN` değil ayrı bir **`ADMIN_SETUP_TOKEN`** ister; o değişken tanımlı
  değilse uç 404 döner. Akış: Vercel'de değişkeni geçici tanımla → isteği at → **sil**.
  Gerekçe: bu uç `is_admin` verebiliyor, günlük işlerin paylaşık tokenına kalıcı yetki
  yükseltme gücü verilmedi.

## Test yapısı

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
