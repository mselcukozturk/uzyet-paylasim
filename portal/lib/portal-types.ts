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
  recentAttempts: AttemptSummary[];
  topicStats: Array<{ topic: string; correct: number; total: number; percent: number }>;
};

export type ExamApiRequest =
  | { action: 'dashboard' }
  | { action: 'start'; mode: ExamMode; examCode?: string }
  | { action: 'resume'; attemptId: string }
  | { action: 'answer'; attemptId: string; questionId: string; selectedIndex: number }
  | { action: 'pause'; attemptId: string }
  | { action: 'cancel'; attemptId: string }
  | { action: 'delete'; attemptId: string }
  | { action: 'finish'; attemptId: string }
  | { action: 'history' }
  | { action: 'flag'; questionGuid: string; note: string; category?: string | null; reported?: boolean; reminder?: boolean }
  | { action: 'reminders' }
  | { action: 'flags' }
  | { action: 'bank' };
