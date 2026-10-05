import { createHash } from 'node:crypto';
import type { KlasikCevapOgesi } from '@/lib/db/schema';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseKlasikSync(sourceText: string) {
  let source: unknown;
  try {
    source = JSON.parse(sourceText);
  } catch {
    throw new Error('Geçersiz JSON.');
  }

  if (!record(source) || !Array.isArray(source.questions) || source.questions.length === 0) {
    throw new Error('Gövde questions dizisi içeren bir JSON nesnesi olmalı ve dizi boş olamaz.');
  }

  const version = createHash('sha256').update(sourceText).digest('hex').slice(0, 16);
  const nos = new Set<string>();

  const questions = source.questions.map((item: unknown, i: number) => {
    if (!record(item)) throw new Error(`Geçersiz soru: satır ${i + 1}`);

    const no = text(item.no);
    if (!no || !/^S\d+$/.test(no)) {
      throw new Error(`Geçersiz veya eksik soru no: satır ${i + 1} (biçim ^S\\d+$ olmalı)`);
    }
    if (nos.has(no)) {
      throw new Error(`Mükerrer soru no (${no}): satır ${i + 1}`);
    }
    nos.add(no);

    const kategori = text(item.kategori);
    const soru = text(item.soru);
    if (!kategori || !soru) {
      throw new Error(`Eksik kategori veya soru: satır ${i + 1}`);
    }

    const konu = text(item.konu);
    const kontrol = text(item.kontrol);
    if (!konu) throw new Error(`Eksik konu: satır ${i + 1}`);
    if (kontrol !== 'edildi' && kontrol !== 'edilecek') throw new Error(`Geçersiz kontrol: satır ${i + 1}`);
    if (typeof item.guncellikNotu !== 'string') throw new Error(`Geçersiz güncellik notu: satır ${i + 1}`);
    const guncellikNotu = item.guncellikNotu.trim();
    const durum = text(item.durum);
    if (durum !== 'tam' && durum !== 'kismi' && durum !== 'cevapsiz') {
      throw new Error(`Geçersiz durum: satır ${i + 1} ('tam', 'kismi' veya 'cevapsiz' olmalı)`);
    }

    if (!Array.isArray(item.cevap) || (durum !== 'cevapsiz' && item.cevap.length === 0)) {
      throw new Error(`Boş veya geçersiz cevap: satır ${i + 1}`);
    }

    const cevap: KlasikCevapOgesi[] = item.cevap.map((c: unknown, ci: number) => {
      if (!record(c)) throw new Error(`Geçersiz cevap öğesi: soru ${i + 1}, öğe ${ci + 1}`);
      const tur = text(c.tur);
      if (tur === 'baslik' || tur === 'paragraf' || tur === 'madde') {
        const metin = text(c.metin);
        if (!metin) throw new Error(`Boş metin içeren cevap öğesi (${tur}): soru ${i + 1}, öğe ${ci + 1}`);
        return { tur, metin } as KlasikCevapOgesi;
      }
      if (tur === 'tablo') {
        if (!Array.isArray(c.satirlar) || c.satirlar.length === 0) {
          throw new Error(`Boş veya geçersiz tablo satırları: soru ${i + 1}, öğe ${ci + 1}`);
        }
        const satirlar = c.satirlar.map((row: unknown, ri: number) => {
          if (!Array.isArray(row) || row.length === 0 || !row.every(cell => typeof cell === 'string')) {
            throw new Error(`Geçersiz tablo satırı: soru ${i + 1}, öğe ${ci + 1}, satır ${ri + 1}`);
          }
          return row.map(cell => String(cell));
        });
        return { tur: 'tablo', satirlar };
      }
      throw new Error(`Bilinmeyen cevap türü (${tur}): soru ${i + 1}, öğe ${ci + 1}`);
    });

    if (!Array.isArray(item.ipuclari)
      || !item.ipuclari.every(ip => typeof ip === 'string' && ip.trim().length > 0)) {
      throw new Error(`Boş veya geçersiz ipuçları: satır ${i + 1}`);
    }
    const ipuclari = item.ipuclari.map(ip => text(ip));

    return {
      no,
      sira: i,
      kategori,
      konu,
      kontrol,
      guncellikNotu,
      soru,
      durum,
      cevap,
      ipuclari,
      version,
    };
  });

  return { version, questions };
}
