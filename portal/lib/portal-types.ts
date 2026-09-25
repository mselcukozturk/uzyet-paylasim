export type ExamMode = 'rastgele' | 'azgorulen' | 'yanlislar';

export type PublicQuestion = {
  id: string;
  guid: string;
  topic: string;
  prompt: string;
  options: string[];
  position: number;
};

export type AttemptSummary = {
  id: string;
  mode: ExamMode;
  status: 'active' | 'paused' | 'finished';
  examCode: string;
  isDaily: boolean;
  answeredCount: number;
  totalCount: number;
  elapsedSeconds: number;
  updatedAt: string;
  score?: { correct: number; wrong: number; blank: number; percent: number };
};

export type ActiveAttempt = AttemptSummary & {
  questions: PublicQuestion[];
  answers: Record<string, number>;
  resumedAt: string | null;
};

export type ReviewQuestion = PublicQuestion & {
  selectedIndex: number | null;
  correctIndex: number;
  explanation: string;
  isCorrect: boolean | null;
};

export type ExamResult = AttemptSummary & {
  status: 'finished';
  score: { correct: number; wrong: number; blank: number; percent: number };
  topicBreakdown: Array<{ topic: string; correct: number; total: number; percent: number }>;
  review: ReviewQuestion[];
};

export type DashboardData = {
  displayName: string;
  bankQuestionCount: number;
  completedCount: number;
  overallPercent: number | null;
  lastScore: AttemptSummary['score'] | null;
  activeAttempt: AttemptSummary | null;
  topicStats: Array<{ topic: string; correct: number; total: number; percent: number }>;
  // Bitmiş resmi denemelerin konu kırılımı: deneme başına ortalama kaç soru geldiği
  // ve ortalama kaç doğru yapıldığı (Geçmiş ekranındaki "Konu bazlı ortalama" kartı).
  examTopicStats: Array<{
    topic: string;
    asked: number;
    correct: number;
    avgAsked: number;
    avgCorrect: number;
    percent: number;
    weekAvgAsked: number | null;
    weekAvgCorrect: number | null;
    weekPercent: number | null;
    threeDayAvgAsked: number | null;
    threeDayAvgCorrect: number | null;
    threeDayPercent: number | null;
  }>;
  examStats: {
    count: number;
    avgPercent: number;
    avgCorrect: number;
    avgSeconds: number;
    weekCount: number;
    weekAvgCorrect: number | null;
    threeDayCount: number;
    threeDayAvgCorrect: number | null;
  } | null;
  // Günün denemesi: myCorrect/avgCorrect (50 üzerinden doğru) yalnız kullanıcı çözdüyse dolu.
  daily: { day: string; code: string; solvedCount: number; myCorrect: number | null; avgCorrect: number | null };
};

// action "daily-solvers" (yalnız yönetici): bugünün günün denemesini çözenler, kişi başı ilk
// bitmiş deneme, puana göre büyükten küçüğe. name kullanıcı adıdır; correct 50 üzerinden doğru.
export type DailySolversResponse = {
  day: string;
  solvers: Array<{ name: string; finishedAt: string | null; correct: number }>;
};

// action "history": bitmiş denemeler, en yeniden eskiye, pageSize'lık sayfalar (page 0'dan).
export type HistoryPage = { attempts: AttemptSummary[]; total: number; page: number; pageSize: number };

export type PracticeQuestion = {
  guid: string;
  konu: string;
  modul: string;
  soru: string;
  siklar: string[];
  cevapIdx: number;
  cevapHarf: string;
  cevapMetni: string;
  aciklama: string;
  kaynak: string;
};

export type PracticeCheckpoint = {
  id: string;
  konu: string;
  title: string;
  subtitle: string;
  html: string;
};

export type QuestionStat = {
  gosterim: number;
  dogru: number;
  yanlis: number;
  sonSonucDogruMu: boolean | null;
  sonGorulme: string | null;
};

export type PracticeStat = QuestionStat;

export type PracticeBankResponse = { questions: PracticeQuestion[] };
export type PracticeAnswerResponse = { ok: true; correct: boolean; stat: PracticeStat };
export type PracticeCheckpointsResponse = { checkpoints: PracticeCheckpoint[] };
export type PracticeStatsResponse = {
  stats: Record<string, PracticeStat>;
  sessions: Array<{ konu: string; modul: string; updatedAt: string }>;
};

export type StudyBankResponse = {
  questions: Array<{
    guid: string;
    konu: string;
    soru: string;
    siklar: string[];
    cevapIdx: number;
    cevapHarf: string;
    cevapMetni: string;
    aciklama: string;
    kaynak: string;
    donem: string;
    dogrulanmis: boolean;
  }>;
  stats: Record<string, QuestionStat>;
};

export type StudyAnswerResponse = { ok: true; correct: boolean; stat: QuestionStat };

export type ExamApiRequest =
  | { action: 'study-answer'; questionGuid: string; selectedAnswer: string; requestId?: string }
  | { action: 'practice-answer'; questionGuid: string; selectedAnswer: string; requestId?: string }
  | { action: 'practice-session-save'; konu: string; modul: string; payload: unknown }
  | { action: 'practice-session-load'; konu: string; modul: string }
  | { action: 'practice-session-delete'; konu: string; modul: string }
  | { action: 'practice-bank' }
  | { action: 'checkpoints' }
  | { action: 'practice-stats' }
  // sonuc verilirse günün AI denemesi sonucu kaydedilir (ilk kayıt sayılır); her iki
  // durumda da günün tohumu + çözen sayısı + ortalama döner.
  | { action: 'ai-daily'; sonuc?: { dogru: number; yanlis: number; bos: number; sureSaniye: number } }
  // AI denemesi geçmişi: sunucuda sınav oturumu yok, biten deneme tek parça kaydedilir.
  | { action: 'ai-exam-save'; payload: unknown }
  | { action: 'ai-exam-history'; page?: number }
  | { action: 'ai-exam-detail'; attemptId: string }
  | { action: 'ai-exam-delete'; attemptId: string }
  | { action: 'dashboard' }
  | { action: 'daily-solvers' }
  | { action: 'start'; mode: ExamMode; examCode?: string; daily?: boolean }
  | { action: 'resume'; attemptId: string }
  | { action: 'answer'; attemptId: string; questionId: string; selectedIndex: number }
  | { action: 'pause'; attemptId: string; answers?: Record<string, number> }
  | { action: 'cancel'; attemptId: string }
  | { action: 'delete'; attemptId: string }
  | { action: 'finish'; attemptId: string; answers?: Record<string, number> }
  | { action: 'history'; page?: number }
  | { action: 'flag'; questionGuid: string; note: string; category?: string | null; reported?: boolean; reminder?: boolean }
  | { action: 'reminders' }
  | { action: 'wrong-questions' }
  | { action: 'wrong-question-answer'; questionGuid: string; selectedAnswer: string }
  | { action: 'flags' }
  | { action: 'bank' }
  | { action: 'corrections' };
