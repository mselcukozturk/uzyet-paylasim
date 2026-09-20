-- Yarım kalan test/checkpoint oturumu 20 Eyl 2026'da kaldırıldı (kullanıcı isteği).
-- Geriye kalan satırlar artık hiçbir yerden okunmuyor; practice_sessions yalnız
-- ayrılmış anahtarları taşısın diye temizleniyor:
--   '__pBest__'    modül kartındaki en iyi sonuç
--   '__aiGunun__'  AI Günün Denemesi'nin ilk sonucu
--   '__aiDeneme__' biten AI denemesi (AI istatistik sekmesinin kaynağı)
-- Tekrar çalıştırılabilir: silinecek satır kalmazsa hiçbir şey yapmaz.
DELETE FROM "practice_sessions" WHERE "topic" NOT IN ('__pBest__', '__aiGunun__', '__aiDeneme__');
