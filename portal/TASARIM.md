# UZYET Deneme Portalı — tasarım sözleşmesi

Bu belge yalnız `portal/` uygulamasını kapsar. Kişisel Artifact'in işlev dili korunur;
paylaşım portalı ise yalnız deneme sınavına odaklanır.

## Görsel tez

Sınav salonu ciddiyeti ile günlük çalışma aracının hızını birleştiren koyu lacivert,
net ve yoğun bir çalışma yüzeyi. İlk ekran pazarlama sayfası değil, giriş veya deneme
kontrolleridir. Dekoratif görsel kullanılmaz.

## Gerçek dosyalar

- Tema ve renk tokenları: `app/globals.css`
- Sayfa kabuğu ve metadata: `app/layout.tsx`
- Ana akış: `app/exam-portal.tsx`
- Ortak UI parçaları: `components/portal/`
- Hazır erişilebilir kontroller: `components/ui/`

## Kurallar

- Bileşenlerde sabit renk kullanılmaz; tüm renkler `app/globals.css` içindeki anlamsal
  tokenlardan gelir.
- Başarı ve hata için yalnız `--positive` / `--negative`; konu renkleri için sınırlı
  `--series-*` tokenları kullanılır.
- Sınav sayaçları ve bütün sayısal metrikler `tabular-nums` kullanır.
- Ana gövde yazısı en az 16px, sık kullanılan etiketler en az 14px'tir.
- Kart, düğme, form alanı, uyarı ve ilerleme görünümleri ortak bileşenlerle kurulur.
- Sık kullanılan sınav gezinmesinde animasyon yoktur. Yalnız hover/focus renkleri
  150ms geçiş kullanabilir.
- Dokunma hedefleri en az 44x44px'tir.
- `prefers-reduced-motion` her zaman gözetilir.
- Koyu ve açık tema aynı token katmanından yönetilir; bileşen içinde ayrı renk dalları
  oluşturulmaz.

## Temel bileşenler

- `PortalShell`: üst şerit ve içerik genişliği
- `MetricCard`: sınav metrikleri
- `StatusNotice`: hata/bilgi/başarı mesajı
- `QuestionNavigator`: 50 soruluk hızlı gezinme
- `ExamTimer`: sunucu durumundan türetilen süre

Yeni tekrar eden bir görsel kalıp eklenmeden önce bu belge güncellenir.
