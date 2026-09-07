import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import {
  examCode,
  mulberry32,
  parseExamCode,
  selectExamQuestions,
  shuffleQuestionOptions,
  type BankQuestion,
  type ExamMode,
} from '../_shared/exam-core.ts';

type Row = {
  id: string;
  user_id: string;
  bank_id: string;
  attempt_id: string;
  attempt_question_id: string;
  question_guid: string;
  guid: string;
  topic: string;
  prompt: string;
  options: string[];
  position: number;
  correct_index: number;
  explanation: string;
  selected_index: number;
  mode: ExamMode;
  status: 'active' | 'paused' | 'finished' | 'cancelled';
  exam_code: string;
  elapsed_seconds: number;
  last_resumed_at: string | null;
  updated_at: string;
  finished_at: string | null;
  correct_count: number | null;
  wrong_count: number | null;
  blank_count: number | null;
  score_percent: number | null;
  stats_applied: boolean;
  shown_count: number;
  last_result: boolean | null;
  display_name: string | null;
  is_active: boolean;
  question_count: number;
};

const localOrigins = new Set(['http://localhost:3000', 'http://localhost:5173']);

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const allowed = localOrigins.has(origin) || configured.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : configured[0] ?? 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function currentElapsed(attempt: Row) {
  const base = Number(attempt.elapsed_seconds ?? 0);
  if (attempt.status !== 'active' || !attempt.last_resumed_at) return base;
  return Math.min(3600, base + Math.max(0, Math.floor((Date.now() - new Date(attempt.last_resumed_at).getTime()) / 1000)));
}

function publicQuestion(row: Row) {
  return {
    id: row.id,
    guid: row.question_guid,
    topic: row.topic,
    prompt: row.prompt,
    options: row.options,
    position: row.position,
  };
}

function summary(attempt: Row, totalCount: number, answeredCount: number) {
  const hasScore = attempt.status === 'finished';
  return {
    id: attempt.id,
    mode: attempt.mode,
    status: attempt.status,
    examCode: attempt.exam_code,
    answeredCount,
    totalCount,
    elapsedSeconds: currentElapsed(attempt),
    updatedAt: attempt.updated_at,
    ...(hasScore ? { score: {
      correct: attempt.correct_count,
      wrong: attempt.wrong_count,
      blank: attempt.blank_count,
      percent: attempt.score_percent,
    } } : {}),
  };
}

async function loadAttempt(admin: SupabaseClient, userId: string, attemptId: string) {
  const { data: attempt, error } = await admin.from('exam_attempts').select('*').eq('id', attemptId).eq('user_id', userId).single();
  if (error || !attempt) throw new Error('Sınav bulunamadı.');
  const { data: questions, error: questionError } = await admin.from('exam_attempt_questions').select('*').eq('attempt_id', attemptId).order('position');
  if (questionError) throw questionError;
  const questionIds = (questions ?? []).map((item: Row) => item.id);
  const { data: answers, error: answerError } = questionIds.length
    ? await admin.from('exam_answers').select('*').in('attempt_question_id', questionIds)
    : { data: [], error: null };
  if (answerError) throw answerError;
  const answerMap = Object.fromEntries((answers ?? []).map((item: Row) => [item.attempt_question_id, item.selected_index]));
  return { attempt, questions: questions ?? [], answers: answerMap };
}

async function dashboard(admin: SupabaseClient, user: User) {
  const [{ data: profile }, { data: bank }, { data: attempts }, { data: stats }, completedResult] = await Promise.all([
    admin.from('profiles').select('display_name').eq('id', user.id).single(),
    admin.from('question_banks').select('id,question_count').eq('is_active', true).single(),
    admin.from('exam_attempts').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(12),
    admin.from('question_stats').select('*').eq('user_id', user.id),
    admin.from('exam_attempts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'finished'),
  ]);

  const attemptRows = attempts ?? [];
  const attemptIds = attemptRows.map((item: Row) => item.id);
  const { data: attemptQuestions } = attemptIds.length
    ? await admin.from('exam_attempt_questions').select('id,attempt_id').in('attempt_id', attemptIds)
    : { data: [] };
  const attemptQuestionIds = (attemptQuestions ?? []).map((item) => item.id);
  const { data: answerRows } = attemptQuestionIds.length
    ? await admin.from('exam_answers').select('attempt_question_id').in('attempt_question_id', attemptQuestionIds)
    : { data: [] };
  const questionAttempt = new Map<string, string>((attemptQuestions ?? []).map((item) => [String(item.id), String(item.attempt_id)]));
  const counts = new Map<string, { total: number; answered: number }>();
  for (const item of attemptQuestions ?? []) {
    const entry = counts.get(item.attempt_id) ?? { total: 0, answered: 0 };
    entry.total += 1;
    counts.set(item.attempt_id, entry);
  }
  for (const item of answerRows ?? []) {
    const attemptId = questionAttempt.get(item.attempt_question_id);
    if (!attemptId) continue;
    const entry = counts.get(attemptId) ?? { total: 0, answered: 0 };
    entry.answered += 1;
    counts.set(attemptId, entry);
  }

  const completed = attemptRows.filter((item: Row) => item.status === 'finished');
  const scoredTotal = (stats ?? []).reduce((sum: number, item: Row) => sum + Number(item.correct_count ?? 0) + Number(item.wrong_count ?? 0), 0);
  const scoredCorrect = (stats ?? []).reduce((sum: number, item: Row) => sum + Number(item.correct_count ?? 0), 0);
  const open = attemptRows.find((item: Row) => item.status === 'active' || item.status === 'paused');

  let topicStats: Array<{ topic: string; correct: number; total: number; percent: number }> = [];
  if (bank?.id && (stats ?? []).length) {
    const { data: topics } = await admin.from('questions').select('guid,topic').eq('bank_id', bank.id);
    const topicByGuid = new Map<string, string>((topics ?? []).map((item) => [String(item.guid), String(item.topic)]));
    const grouped = new Map<string, { correct: number; total: number }>();
    for (const item of stats ?? []) {
      const topic = topicByGuid.get(item.question_guid);
      if (!topic) continue;
      const entry = grouped.get(topic) ?? { correct: 0, total: 0 };
      entry.correct += item.correct_count;
      entry.total += item.correct_count + item.wrong_count;
      grouped.set(topic, entry);
    }
    topicStats = [...grouped.entries()].map(([topic, value]) => ({ topic, ...value, percent: value.total ? Math.round(value.correct / value.total * 100) : 0 }));
  }

  const toSummary = (item: Row) => {
    const count = counts.get(item.id) ?? { total: 0, answered: 0 };
    return summary(item, count.total, count.answered);
  };
  return {
    displayName: profile?.display_name || user.email?.split('@')[0] || 'Kullanıcı',
    bankQuestionCount: bank?.question_count ?? 0,
    completedCount: completedResult.count ?? 0,
    overallPercent: scoredTotal ? Math.round(scoredCorrect / scoredTotal * 100) : null,
    lastScore: completed.length ? toSummary(completed[0]).score : null,
    activeAttempt: open ? toSummary(open) : null,
    recentAttempts: completed.slice(0, 6).map(toSummary),
    topicStats,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Yalnız POST desteklenir.' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
    const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = request.headers.get('Authorization');
    if (!url || !publicKey || !secretKey) return json(request, { error: 'Servis yapılandırması eksik.' }, 500);
    if (!authHeader) return json(request, { error: 'Giriş gerekli.' }, 401);

    const auth = createClient(url, publicKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: { user }, error: authError } = await auth.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (authError || !user) return json(request, { error: 'Oturum geçersiz.' }, 401);

    const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile } = await admin.from('profiles').select('is_active').eq('id', user.id).single();
    if (!profile?.is_active) return json(request, { error: 'Bu hesabın erişimi kapalı.' }, 403);

    const body = await request.json();
    if (body.action === 'dashboard' || body.action === 'history') return json(request, await dashboard(admin, user));

    if (body.action === 'start') {
      const { data: open } = await admin.from('exam_attempts').select('id').eq('user_id', user.id).in('status', ['active', 'paused']).maybeSingle();
      if (open) return json(request, { error: 'Önce yarım kalan sınavı tamamla veya sil.' }, 409);

      let mode: ExamMode = body.mode;
      let seed = crypto.getRandomValues(new Uint32Array(1))[0];
      if (!['rastgele', 'azgorulen', 'yanlislar'].includes(mode)) return json(request, { error: 'Sınav modu geçersiz.' }, 400);
      if (body.examCode) {
        const parsed = parseExamCode(body.examCode);
        if (!parsed) return json(request, { error: 'Deneme kodu geçersiz.' }, 400);
        mode = parsed.mode;
        seed = parsed.seed;
      }

      const { data: bank, error: bankError } = await admin.from('question_banks').select('*').eq('is_active', true).single();
      if (bankError || !bank) return json(request, { error: 'Aktif soru bankası bulunamadı.' }, 503);
      const [{ data: rows, error: questionError }, { data: statRows }] = await Promise.all([
        admin.from('questions').select('*').eq('bank_id', bank.id),
        admin.from('question_stats').select('*').eq('user_id', user.id),
      ]);
      if (questionError) throw questionError;
      const questions: BankQuestion[] = (rows ?? []).map((item: Row) => ({
        id: item.id, guid: item.guid, topic: item.topic, prompt: item.prompt,
        options: item.options, correctIndex: item.correct_index, explanation: item.explanation,
      }));
      const stats = (statRows ?? []).map((item: Row) => ({ questionGuid: item.question_guid, shownCount: item.shown_count, lastResult: item.last_result }));
      const picked = selectExamQuestions(questions, stats, mode, seed);
      if (picked.questions.length !== 50) return json(request, { error: 'Resmî dağılım için yeterli soru bulunamadı.', warnings: picked.warnings }, 503);
      const optionRandom = mulberry32(seed ^ 0x9e3779b9);
      const snapshots = picked.questions.map((item) => shuffleQuestionOptions(item, optionRandom));

      const { data: attempt, error: attemptError } = await admin.from('exam_attempts').insert({
        user_id: user.id, bank_id: bank.id, mode, exam_code: examCode(mode, seed),
      }).select('*').single();
      if (attemptError) throw attemptError;
      const { data: insertedQuestions, error: snapshotError } = await admin.from('exam_attempt_questions').insert(snapshots.map((item, index) => ({
        attempt_id: attempt.id, question_id: item.id, question_guid: item.guid, position: index + 1,
        topic: item.topic, prompt: item.prompt, options: item.options,
        correct_index: item.correctIndex, explanation: item.explanation,
      }))).select('*');
      if (snapshotError) {
        await admin.from('exam_attempts').delete().eq('id', attempt.id);
        throw snapshotError;
      }
      return json(request, {
        ...summary(attempt, 50, 0),
        questions: insertedQuestions.map(publicQuestion),
        answers: {}, resumedAt: attempt.last_resumed_at,
      });
    }

    if (!body.attemptId || typeof body.attemptId !== 'string') return json(request, { error: 'Sınav kimliği eksik.' }, 400);

    if (body.action === 'resume') {
      const loaded = await loadAttempt(admin, user.id, body.attemptId);
      if (!['active', 'paused'].includes(loaded.attempt.status)) return json(request, { error: 'Bu sınav devam ettirilemez.' }, 409);
      const elapsed = currentElapsed(loaded.attempt);
      const { data: resumed, error } = await admin.from('exam_attempts').update({ status: 'active', elapsed_seconds: elapsed, last_resumed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', body.attemptId).eq('user_id', user.id).select('*').single();
      if (error) throw error;
      return json(request, { ...summary(resumed, loaded.questions.length, Object.keys(loaded.answers).length), questions: loaded.questions.map(publicQuestion), answers: loaded.answers, resumedAt: resumed.last_resumed_at });
    }

    if (body.action === 'answer') {
      const loaded = await loadAttempt(admin, user.id, body.attemptId);
      if (loaded.attempt.status !== 'active') return json(request, { error: 'Sınav aktif değil.' }, 409);
      if (currentElapsed(loaded.attempt) >= 3600) return json(request, { error: 'Sınav süresi doldu; sınavı tamamla.' }, 409);
      const question = loaded.questions.find((item: Row) => item.id === body.questionId);
      if (!question || !Number.isInteger(body.selectedIndex) || body.selectedIndex < 0 || body.selectedIndex >= question.options.length) return json(request, { error: 'Cevap geçersiz.' }, 400);
      const { error } = await admin.from('exam_answers').upsert({ attempt_question_id: question.id, selected_index: body.selectedIndex, answered_at: new Date().toISOString() });
      if (error) throw error;
      await admin.from('exam_attempts').update({ updated_at: new Date().toISOString() }).eq('id', body.attemptId);
      return json(request, { ok: true });
    }

    if (body.action === 'pause') {
      const loaded = await loadAttempt(admin, user.id, body.attemptId);
      if (loaded.attempt.status !== 'active') return json(request, { error: 'Sınav aktif değil.' }, 409);
      const { error } = await admin.from('exam_attempts').update({ status: 'paused', elapsed_seconds: currentElapsed(loaded.attempt), last_resumed_at: null, updated_at: new Date().toISOString() }).eq('id', body.attemptId).eq('user_id', user.id);
      if (error) throw error;
      return json(request, { ok: true });
    }

    if (body.action === 'cancel') {
      const loaded = await loadAttempt(admin, user.id, body.attemptId);
      if (!['active', 'paused'].includes(loaded.attempt.status)) return json(request, { error: 'Bu sınav silinemez.' }, 409);
      const { error } = await admin.from('exam_attempts').update({
        status: 'cancelled', elapsed_seconds: currentElapsed(loaded.attempt), last_resumed_at: null, updated_at: new Date().toISOString(),
      }).eq('id', body.attemptId).eq('user_id', user.id);
      if (error) throw error;
      return json(request, { ok: true });
    }

    if (body.action === 'finish') {
      const loaded = await loadAttempt(admin, user.id, body.attemptId);
      if (!['active', 'finished'].includes(loaded.attempt.status)) return json(request, { error: 'Sınav tamamlanamaz.' }, 409);
      const review = loaded.questions.map((item: Row) => {
        const selectedIndex = loaded.answers[item.id] ?? null;
        return { ...publicQuestion(item), selectedIndex, correctIndex: item.correct_index, explanation: item.explanation, isCorrect: selectedIndex === null ? null : selectedIndex === item.correct_index };
      });
      const correct = review.filter((item) => item.isCorrect === true).length;
      const wrong = review.filter((item) => item.isCorrect === false).length;
      const blank = review.filter((item) => item.isCorrect === null).length;
      const percent = Math.round(correct / review.length * 100);
      let finished = loaded.attempt;
      if (loaded.attempt.status === 'active') {
        const elapsed = currentElapsed(loaded.attempt);
        const finishedAt = new Date().toISOString();
        const { data, error } = await admin.from('exam_attempts').update({
          status: 'finished', elapsed_seconds: elapsed, last_resumed_at: null, finished_at: finishedAt,
          updated_at: finishedAt, correct_count: correct, wrong_count: wrong, blank_count: blank, score_percent: percent,
        }).eq('id', body.attemptId).eq('user_id', user.id).select('*').single();
        if (error) throw error;
        finished = data;
      }

      if (!finished.stats_applied) {
        const { error: statError } = await admin.rpc('apply_finished_exam_stats', {
          p_attempt_id: body.attemptId,
          p_user_id: user.id,
          p_results: review.map((item) => ({ guid: item.guid, isCorrect: item.isCorrect })),
        });
        if (statError) throw statError;
      }
      const topicMap = new Map<string, { correct: number; total: number }>();
      for (const item of review) {
        const entry = topicMap.get(item.topic) ?? { correct: 0, total: 0 };
        entry.total += 1;
        if (item.isCorrect) entry.correct += 1;
        topicMap.set(item.topic, entry);
      }
      const topicBreakdown = [...topicMap.entries()].map(([topic, value]) => ({ topic, ...value, percent: Math.round(value.correct / value.total * 100) }));
      return json(request, { ...summary(finished, review.length, review.length - blank), score: { correct, wrong, blank, percent }, topicBreakdown, review });
    }

    if (body.action === 'flag') {
      const loaded = await loadAttempt(admin, user.id, body.attemptId);
      const question = loaded.questions.find((item: Row) => item.id === body.questionId);
      if (!question) return json(request, { error: 'Soru bulunamadı.' }, 404);
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
      const { error } = await admin.from('question_flags').upsert({ user_id: user.id, question_guid: question.question_guid, note, is_reported: true, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json(request, { ok: true });
    }

    return json(request, { error: 'İşlem tanınmadı.' }, 400);
  } catch (error) {
    console.error(error);
    return json(request, { error: 'İşlem tamamlanamadı.' }, 500);
  }
});
