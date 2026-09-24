import { createHmac } from 'node:crypto';

export type ExamMode = 'rastgele' | 'azgorulen' | 'yanlislar' | 'zor';

export const OFFICIAL_DISTRIBUTION: Record<string, number> = {
  'Ürünler': 8,
  'Hukuk': 8,
  'Temel İşlemler': 8,
  'Kredi': 8,
  'Genel Ekonomi': 5,
  'Mali Analiz': 5,
  'Kambiyo': 3,
  'Sermaye Piyasaları ve Hazine': 3,
  'İK Politikaları': 2,
};

export type BankQuestion = {
  id: string;
  guid: string;
  topic: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export type UserQuestionStat = {
  questionGuid: string;
  shownCount: number;
  wrongCount: number;
  lastResult: boolean | null;
};

const STAT_CONTENT_FIELDS = ['soru', 'a', 'b', 'c', 'd', 'cevap_harf', 'cevap_metni'] as const;

export function shouldResetQuestionStats(before: Record<string, unknown>, after: Record<string, unknown>) {
  return STAT_CONTENT_FIELDS.some((field) => String(before[field] ?? '') !== String(after[field] ?? ''));
}

export function shouldApplyAttemptStats(attemptBankId: string, activeBankId: string) {
  return attemptBankId === activeBankId;
}

export function parseResetQuestionGuids(value: string | null) {
  return [...new Set((value ?? '').split(',').map((item) => item.trim())
    .filter((item) => /^[a-zA-Z0-9:_-]{3,100}$/.test(item)))];
}

export function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
export function examCode(mode: ExamMode, seed: number) {
  const prefix = { rastgele: 'R', azgorulen: 'A', yanlislar: 'Y', zor: 'Z' }[mode];
  return `UZY-${prefix}${(seed >>> 0).toString(36).toUpperCase()}`;
}

// "Son N gün" istatistikleri takvim günüyle sayılır (24 Eyl 2026 kullanıcı isteği): bugün
// dahil son N İstanbul günü, yani (N-1) gün önceki gece yarısından (UTC+3, yaz saati yok) beri.
export function takvimGunuBaslangici(gunSayisi: number, now = new Date()) {
  const istanbul = 3 * 3600 * 1000;
  const bugunBasi = Math.floor((now.getTime() + istanbul) / 86_400_000) * 86_400_000 - istanbul;
  return new Date(bugunBasi - (gunSayisi - 1) * 86_400_000);
}

// Günün denemesi İstanbul saatiyle 07:00'de değişir (UTC+3, yaz saati yok → UTC 04:00).
export function dailyExamDay(now = new Date()) {
  return new Date(now.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

// Repo public: tohum düz tarihten türeseydi yarının soruları önceden hesaplanabilirdi.
// Sunucudaki gizli anahtarla HMAC'lenir; kodu yalnız sunucu üretir. Aynı kodu açan herkes
// aynı 50 soruyu alır (/api/exam "start" kod paylaşım dalı).
export function dailyExamCode(day: string, secret = process.env.PIN_ENCRYPTION_KEY ?? '') {
  return examCode('rastgele', createHmac('sha256', secret).update(`gunun-denemesi:${day}`).digest().readUInt32BE(0));
}

// AI Günün Denemesi (Yapay Zekâ Kaynakları) resmi denemeden ayrı bir tohum kullanır — aynı gün
// iki deneme de aynı 50 soruyu seçmesin diye etiket farklı. Resmi denemedeki gerekçe burada da
// geçerli: repo public, tohum düz tarihten türeseydi yarının soruları önceden hesaplanabilirdi.
// İstemci tohumu üretmez, /api/exam "ai-daily" ucundan alır.
export function aiDailySeed(day: string, secret = process.env.PIN_ENCRYPTION_KEY ?? '') {
  return createHmac('sha256', secret).update(`ai-gunun-denemesi:${day}`).digest().readUInt32BE(0);
}

// AI denemesi kodu: tek mod olduğu için mod harfi yok, öneki UZA- (resmi deneme UZY-).
// İstemcideki aiKoduUret ile birebir aynı biçim.
export function aiExamCode(seed: number) {
  return `UZA-${(seed >>> 0).toString(36).toUpperCase()}`;
}

export function parseExamCode(value: string): { mode: ExamMode; seed: number } | null {
  const clean = value.trim().toUpperCase().replace(/^UZY-?/, '');
  const modes: Record<string, ExamMode> = { R: 'rastgele', A: 'azgorulen', Y: 'yanlislar', Z: 'zor' };
  const mode = modes[clean[0]];
  const seedText = clean.slice(1);
  if (!mode || !/^[0-9A-Z]+$/.test(seedText)) return null;
  const seed = Number.parseInt(seedText, 36);
  return Number.isFinite(seed) ? { mode, seed: seed >>> 0 } : null;
}

function shuffled<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function selectExamQuestions(
  questions: BankQuestion[],
  stats: UserQuestionStat[],
  mode: ExamMode,
  seed: number,
) {
  const random = mulberry32(seed);
  const statMap = new Map(stats.map((item) => [item.questionGuid, item]));
  const warnings: string[] = [];
  const selected: BankQuestion[] = [];

  for (const [topic, requested] of Object.entries(OFFICIAL_DISTRIBUTION)) {
    const topicQuestions = questions.filter((question) => question.topic === topic);
    let ordered: BankQuestion[];
    if (mode === 'yanlislar') {
      const wrong = topicQuestions.filter((question) => statMap.get(question.guid)?.lastResult === false);
      const rest = topicQuestions.filter((question) => statMap.get(question.guid)?.lastResult !== false);
      ordered = [...shuffled(wrong, random), ...shuffled(rest, random)];
    } else if (mode === 'azgorulen') {
      ordered = shuffled(topicQuestions, random).sort((left, right) =>
        (statMap.get(left.guid)?.shownCount ?? 0) - (statMap.get(right.guid)?.shownCount ?? 0));
    } else if (mode === 'zor') {
      ordered = shuffled(topicQuestions, random).sort((left, right) =>
        (statMap.get(right.guid)?.wrongCount ?? 0) - (statMap.get(left.guid)?.wrongCount ?? 0));
    } else {
      ordered = shuffled(topicQuestions, random);
    }
    const chosen = ordered.slice(0, requested);
    if (chosen.length < requested) warnings.push(`${topic}: ${chosen.length}/${requested} soru bulundu.`);
    selected.push(...chosen);
  }

  return { questions: shuffled(selected, random), warnings };
}

export function shuffleQuestionOptions(question: BankQuestion, random: () => number) {
  const indexed = question.options.map((option, index) => ({ option, index }));
  const options = shuffled(indexed, random);
  return {
    ...question,
    options: options.map((item) => item.option),
    correctIndex: options.findIndex((item) => item.index === question.correctIndex),
  };
}
