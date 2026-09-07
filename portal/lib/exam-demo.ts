import type {
  ActiveAttempt,
  DashboardData,
  ExamApiRequest,
  ExamResult,
  PublicQuestion,
} from './portal-types';

const questions: Array<PublicQuestion & { correctIndex: number; explanation: string }> = [
  {
    id: 'demo-1', guid: 'demo-1', topic: 'Hukuk', position: 1,
    prompt: 'Yerel önizlemede sınav ilerlemesi hangi katmanda saklanır?',
    options: ['Yalnız sayfa belleğinde', 'Kullanıcı hesabına bağlı sunucu kaydında', 'HTML kaynak kodunda', 'Git geçmişinde'],
    correctIndex: 1, explanation: 'Gerçek portalda cevaplar kullanıcı kimliğine bağlı olarak sunucuda saklanır.',
  },
  {
    id: 'demo-2', guid: 'demo-2', topic: 'Kredi', position: 2,
    prompt: 'Bir banka güncellemesi başladıktan sonra yarım kalan sınav nasıl değerlendirilir?',
    options: ['Yeni şıklara göre', 'Rastgele', 'Başladığı andaki soru ve şık görüntüsüne göre', 'Silinerek'],
    correctIndex: 2, explanation: 'Her deneme kendi soru ve şık görüntüsünü taşır.',
  },
  {
    id: 'demo-3', guid: 'demo-3', topic: 'Temel İşlemler', position: 3,
    prompt: 'Doğru cevap bilgisi kullanıcıya ne zaman gönderilir?',
    options: ['Sınav başlamadan', 'Her soru açıldığında', 'Sınav tamamlandıktan sonra', 'Hiçbir zaman'],
    correctIndex: 2, explanation: 'Cevap anahtarı sınav tamamlanana kadar sunucuda kalır.',
  },
  {
    id: 'demo-4', guid: 'demo-4', topic: 'Ürünler', position: 4,
    prompt: 'Portalın ilk sürümündeki ana çalışma biçimi hangisidir?',
    options: ['Checkpoint', 'Konu anlatımı', '50 soruluk deneme', 'Dosya düzenleme'],
    correctIndex: 2, explanation: 'Paylaşım portalı yalnız deneme sınavına odaklanır.',
  },
  {
    id: 'demo-5', guid: 'demo-5', topic: 'Genel Ekonomi', position: 5,
    prompt: 'Kullanıcı başka cihazdan yarım kalan sınava devam edebilir mi?',
    options: ['Evet', 'Hayır', 'Yalnız aynı tarayıcıda', 'Yalnız yönetici onayıyla'],
    correctIndex: 0, explanation: 'Sunucu kaydı sayesinde aynı hesapla farklı cihazdan devam edilebilir.',
  },
];

let active: ActiveAttempt | null = null;
let completed: ExamResult[] = [];

function dashboard(): DashboardData {
  const total = completed.reduce((sum, item) => sum + item.score.correct + item.score.wrong, 0);
  const correct = completed.reduce((sum, item) => sum + item.score.correct, 0);
  return {
    displayName: 'Yerel Önizleme',
    bankQuestionCount: 2180,
    completedCount: completed.length,
    overallPercent: total ? Math.round((correct / total) * 100) : null,
    lastScore: completed[0]?.score ?? null,
    activeAttempt: active,
    recentAttempts: completed,
    topicStats: completed[0]?.topicBreakdown ?? [],
  };
}

export async function demoApi(request: ExamApiRequest) {
  await new Promise((resolve) => setTimeout(resolve, 120));

  if (request.action === 'dashboard' || request.action === 'history') return dashboard();
  if (request.action === 'start') {
    active = {
      id: `demo-${Date.now()}`, mode: request.mode, status: 'active', examCode: 'UZY-DEMO',
      answeredCount: 0, totalCount: questions.length, elapsedSeconds: 0,
      updatedAt: new Date().toISOString(), resumedAt: new Date().toISOString(),
      questions: questions.map(({ correctIndex: _correct, explanation: _explanation, ...question }) => question), answers: {},
    };
    return active;
  }
  if (request.action === 'resume') {
    if (!active) throw new Error('Devam eden deneme bulunamadı.');
    active.status = 'active';
    active.resumedAt = new Date().toISOString();
    return active;
  }
  if (request.action === 'answer') {
    if (!active || active.id !== request.attemptId) throw new Error('Deneme bulunamadı.');
    active.answers[request.questionId] = request.selectedIndex;
    active.answeredCount = Object.keys(active.answers).length;
    active.updatedAt = new Date().toISOString();
    return { ok: true } as const;
  }
  if (request.action === 'pause') {
    if (!active) throw new Error('Deneme bulunamadı.');
    active.status = 'paused';
    active.resumedAt = null;
    return { ok: true } as const;
  }
  if (request.action === 'cancel') {
    active = null;
    return { ok: true } as const;
  }
  if (request.action === 'flag') return { ok: true } as const;
  if (request.action === 'finish') {
    if (!active) throw new Error('Deneme bulunamadı.');
    const review = questions.map((question) => {
      const selectedIndex = active?.answers[question.id] ?? null;
      return { ...question, selectedIndex, isCorrect: selectedIndex === null ? null : selectedIndex === question.correctIndex };
    });
    const correct = review.filter((item) => item.isCorrect === true).length;
    const wrong = review.filter((item) => item.isCorrect === false).length;
    const blank = review.filter((item) => item.isCorrect === null).length;
    const topicBreakdown = [...new Set(review.map((item) => item.topic))].map((topic) => {
      const rows = review.filter((item) => item.topic === topic);
      const topicCorrect = rows.filter((item) => item.isCorrect).length;
      return { topic, correct: topicCorrect, total: rows.length, percent: Math.round((topicCorrect / rows.length) * 100) };
    });
    const result: ExamResult = {
      ...active, status: 'finished',
      score: { correct, wrong, blank, percent: Math.round((correct / questions.length) * 100) },
      topicBreakdown, review,
    };
    completed = [result, ...completed];
    active = null;
    return result;
  }
  throw new Error('Desteklenmeyen yerel işlem.');
}
