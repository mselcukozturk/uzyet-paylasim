export type ExamMode = 'rastgele' | 'azgorulen' | 'yanlislar';

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
  lastResult: boolean | null;
};

export function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function examCode(mode: ExamMode, seed: number) {
  const prefix = { rastgele: 'R', azgorulen: 'A', yanlislar: 'Y' }[mode];
  return `UZY-${prefix}${(seed >>> 0).toString(36).toUpperCase()}`;
}

export function parseExamCode(value: string): { mode: ExamMode; seed: number } | null {
  const clean = value.trim().toUpperCase().replace(/^UZY-?/, '');
  const modes: Record<string, ExamMode> = { R: 'rastgele', A: 'azgorulen', Y: 'yanlislar' };
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

