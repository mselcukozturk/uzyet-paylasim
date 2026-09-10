import { NextResponse } from 'next/server';
import { and, avg, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { getSessionProfile } from '@/lib/auth/session';
import { corsPreflight, withCors } from '@/lib/cors';
import { getDb, schema } from '@/lib/db';
import {
  examCode,
  mulberry32,
  parseExamCode,
  selectExamQuestions,
  shuffleQuestionOptions,
  type BankQuestion,
  type ExamMode,
} from '@/lib/exam-core';
import type { ExamApiRequest, PracticeBankResponse, PracticeCheckpointsResponse, PracticeStatsResponse } from '@/lib/portal-types';
import bankCorrections from '@/data/bank-corrections.json';
import { validatePracticeAnswer } from '@/lib/practice-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Attempt = typeof schema.examAttempts.$inferSelect;
type AttemptQuestion = typeof schema.examAttemptQuestions.$inferSelect;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function requireAiSources(profile: { canSeeAiSources: boolean; disclaimerAcceptedAt: Date | null }) {
  if (!profile.canSeeAiSources) return fail('Yapay zekâ kaynaklarına erişim iznin yok.', 403);
  if (!profile.disclaimerAcceptedAt) return fail('Önce kullanım uyarısını kabul etmelisin.', 403);
  return null;
}

function currentElapsed(attempt: Attempt) {
  const base = attempt.elapsedSeconds;
  if (attempt.status !== 'active' || !attempt.lastResumedAt) return base;
  return Math.min(3600, base + Math.max(0, Math.floor((Date.now() - attempt.lastResumedAt.getTime()) / 1000)));
}

function publicQuestion(row: AttemptQuestion) {
  return {
    id: row.id,
    guid: row.questionGuid,
    topic: row.topic,
    prompt: row.prompt,
    options: row.options,
    position: row.position,
  };
}

function summary(attempt: Attempt, totalCount: number, answeredCount: number) {
  return {
    id: attempt.id,
    mode: attempt.mode,
    status: attempt.status,
    examCode: attempt.examCode,
    answeredCount,
    totalCount,
    elapsedSeconds: currentElapsed(attempt),
    updatedAt: attempt.updatedAt.toISOString(),
    ...(attempt.status === 'finished' ? {
      score: {
        correct: attempt.correctCount ?? 0,
        wrong: attempt.wrongCount ?? 0,
        blank: attempt.blankCount ?? 0,
        percent: attempt.scorePercent ?? 0,
      },
    } : {}),
  };
}

async function loadAttempt(userId: string, attemptId: string) {
  const db = getDb();
  const [attempt] = await db.select().from(schema.examAttempts)
    .where(and(eq(schema.examAttempts.id, attemptId), eq(schema.examAttempts.userId, userId))).limit(1);
  if (!attempt) throw new Error('NOT_FOUND');
  const questions = await db.select().from(schema.examAttemptQuestions)
    .where(eq(schema.examAttemptQuestions.attemptId, attemptId)).orderBy(schema.examAttemptQuestions.position);
  const questionIds = questions.map((item) => item.id);
  const answers = questionIds.length
    ? await db.select().from(schema.examAnswers).where(inArray(schema.examAnswers.attemptQuestionId, questionIds))
    : [];
  return {
    attempt,
    questions,
    answers: Object.fromEntries(answers.map((item) => [item.attemptQuestionId, item.selectedIndex])) as Record<string, number>,
  };
}

async function dashboard(userId: string) {
  const db = getDb();
  const [profileRows, bankRows, attempts, stats, completedRows, avgRows] = await Promise.all([
    db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).limit(1),
    db.select().from(schema.questionBanks).where(eq(schema.questionBanks.isActive, true)).limit(1),
    db.select().from(schema.examAttempts).where(eq(schema.examAttempts.userId, userId)).orderBy(desc(schema.examAttempts.updatedAt)).limit(12),
    db.select().from(schema.questionStats).where(eq(schema.questionStats.userId, userId)),
    db.select({ value: count() }).from(schema.examAttempts).where(and(eq(schema.examAttempts.userId, userId), eq(schema.examAttempts.status, 'finished'))),
    db.select({ avgPercent: avg(schema.examAttempts.scorePercent), avgCorrect: avg(schema.examAttempts.correctCount), avgSeconds: avg(schema.examAttempts.elapsedSeconds) })
      .from(schema.examAttempts).where(and(eq(schema.examAttempts.userId, userId), eq(schema.examAttempts.status, 'finished'))),
  ]);
  const profile = profileRows[0];
  const bank = bankRows[0];
  const attemptIds = attempts.map((item) => item.id);
  const questionCounts = attemptIds.length
    ? await db.select({ attemptId: schema.examAttemptQuestions.attemptId, total: count() })
      .from(schema.examAttemptQuestions).where(inArray(schema.examAttemptQuestions.attemptId, attemptIds))
      .groupBy(schema.examAttemptQuestions.attemptId)
    : [];
  const answerCounts = attemptIds.length
    ? await db.select({ attemptId: schema.examAttemptQuestions.attemptId, answered: count() })
      .from(schema.examAnswers)
      .innerJoin(schema.examAttemptQuestions, eq(schema.examAnswers.attemptQuestionId, schema.examAttemptQuestions.id))
      .where(inArray(schema.examAttemptQuestions.attemptId, attemptIds))
      .groupBy(schema.examAttemptQuestions.attemptId)
    : [];
  const counts = new Map(questionCounts.map((item) => [item.attemptId, { total: Number(item.total), answered: 0 }]));
  for (const item of answerCounts) {
    const entry = counts.get(item.attemptId) ?? { total: 0, answered: 0 };
    entry.answered = Number(item.answered);
    counts.set(item.attemptId, entry);
  }

  const scoredTotal = stats.reduce((sum, item) => sum + item.correctCount + item.wrongCount, 0);
  const scoredCorrect = stats.reduce((sum, item) => sum + item.correctCount, 0);
  const completed = attempts.filter((item) => item.status === 'finished');
  const open = attempts.find((item) => item.status === 'active' || item.status === 'paused');
  const toSummary = (item: Attempt) => {
    const itemCounts = counts.get(item.id) ?? { total: 0, answered: 0 };
    return summary(item, itemCounts.total, itemCounts.answered);
  };

  let topicStats: Array<{ topic: string; correct: number; total: number; percent: number }> = [];
  if (bank && stats.length) {
    const topicRows = await db.select({ guid: schema.questions.guid, topic: schema.questions.topic })
      .from(schema.questions).where(eq(schema.questions.bankId, bank.id));
    const topicByGuid = new Map(topicRows.map((item) => [item.guid, item.topic]));
    const grouped = new Map<string, { correct: number; total: number }>();
    for (const item of stats) {
      const topic = topicByGuid.get(item.questionGuid);
      if (!topic) continue;
      const entry = grouped.get(topic) ?? { correct: 0, total: 0 };
      entry.correct += item.correctCount;
      entry.total += item.correctCount + item.wrongCount;
      grouped.set(topic, entry);
    }
    topicStats = [...grouped.entries()].map(([topic, value]) => ({
      topic,
      ...value,
      percent: value.total ? Math.round(value.correct / value.total * 100) : 0,
    }));
  }

  const completedCount = Number(completedRows[0]?.value ?? 0);
  const avgPercentRaw = avgRows[0]?.avgPercent;
  const avgSecondsRaw = avgRows[0]?.avgSeconds;

  return {
    displayName: profile?.displayName || profile?.username || 'Kullanıcı',
    bankQuestionCount: bank?.questionCount ?? 0,
    completedCount,
    overallPercent: scoredTotal ? Math.round(scoredCorrect / scoredTotal * 100) : null,
    lastScore: completed.length ? toSummary(completed[0]).score : null,
    activeAttempt: open ? toSummary(open) : null,
    recentAttempts: completed.slice(0, 6).map(toSummary),
    topicStats,
    examStats: completedCount ? {
      count: completedCount,
      avgPercent: Math.round(Number(avgPercentRaw ?? 0)),
      avgCorrect: Math.round(Number(avgRows[0]?.avgCorrect ?? 0)),
      avgSeconds: Math.round(Number(avgSecondsRaw ?? 0)),
    } : null,
  };
}

async function wrongQuestionGuids(userId: string) {
  const db = getDb();
  const rows = await db.select({ questionGuid: schema.questionStats.questionGuid })
    .from(schema.questionStats)
    .innerJoin(schema.questions, eq(schema.questionStats.questionGuid, schema.questions.guid))
    .innerJoin(schema.questionBanks, eq(schema.questions.bankId, schema.questionBanks.id))
    .where(and(
      eq(schema.questionStats.userId, userId),
      eq(schema.questionStats.lastResult, false),
      eq(schema.questionBanks.isActive, true),
    ))
    .orderBy(desc(schema.questionStats.lastSeenAt));
  return rows.map((row) => row.questionGuid);
}

export async function OPTIONS() {
  return corsPreflight();
}

export async function POST(request: Request) {
  return withCors(await handlePost(request));
}

async function handlePost(request: Request) {
  try {
    const profile = await getSessionProfile(request);
    if (!profile) return fail('Giriş gerekli.', 401);
    if (!profile.isActive) return fail('Bu hesabın erişimi kapalı; onay bekleniyor.', 403);
    const user = { id: profile.userId };

    const db = getDb();
    const body = await request.json() as ExamApiRequest;
    if (body.action === 'practice-answer' || body.action === 'practice-session-save'
      || body.action === 'practice-session-load' || body.action === 'practice-session-delete') {
      const denied = requireAiSources(profile);
      if (denied) return denied;
      if (body.action === 'practice-answer') {
        if (typeof body.questionGuid !== 'string' || !body.questionGuid.trim()) return fail('Soru kimliği eksik.', 400);
        if (body.requestId !== undefined && (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId))) {
          return fail('İstek kimliği geçersiz.', 400);
        }
        const [question] = await db.select({ options: schema.practiceQuestions.options, correctIndex: schema.practiceQuestions.correctIndex })
          .from(schema.practiceQuestions).where(eq(schema.practiceQuestions.guid, body.questionGuid)).limit(1);
        let correct: boolean;
        try { correct = validatePracticeAnswer(question, body.selectedAnswer); }
        catch { return fail('Soru veya cevap geçersiz.', 400); }
        const response = await db.transaction(async (tx) => {
          if (body.requestId) {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${user.id + ':' + body.requestId}, 0))`);
            const [receipt] = await tx.select().from(schema.practiceAnswerReceipts)
              .where(and(eq(schema.practiceAnswerReceipts.userId, user.id), eq(schema.practiceAnswerReceipts.requestId, body.requestId))).limit(1);
            if (receipt) {
              if (receipt.questionGuid !== body.questionGuid || receipt.selectedAnswer !== body.selectedAnswer) throw new Error('REQUEST_CONFLICT');
              return receipt.response;
            }
          }
          const now = new Date();
          const [stat] = await tx.insert(schema.practiceStats).values({
            userId: user.id, questionGuid: body.questionGuid, shownCount: 1,
            correctCount: correct ? 1 : 0, wrongCount: correct ? 0 : 1, lastResult: correct, lastSeenAt: now,
          }).onConflictDoUpdate({
            target: [schema.practiceStats.userId, schema.practiceStats.questionGuid],
            set: {
              shownCount: sql`${schema.practiceStats.shownCount} + 1`,
              correctCount: sql`${schema.practiceStats.correctCount} + ${correct ? 1 : 0}`,
              wrongCount: sql`${schema.practiceStats.wrongCount} + ${correct ? 0 : 1}`,
              lastResult: correct, lastSeenAt: now,
            },
          }).returning();
          const result = { ok: true, correct, stat: {
            gosterim: stat.shownCount, dogru: stat.correctCount, yanlis: stat.wrongCount,
            sonSonucDogruMu: stat.lastResult, sonGorulme: stat.lastSeenAt?.toISOString() ?? null,
          } };
          if (body.requestId) await tx.insert(schema.practiceAnswerReceipts).values({
            userId: user.id, requestId: body.requestId, questionGuid: body.questionGuid,
            selectedAnswer: body.selectedAnswer, response: result,
          });
          return result;
        });
        return NextResponse.json(response);
      }

      if (typeof body.konu !== 'string' || !body.konu.trim() || typeof body.modul !== 'string' || !body.modul.trim()) {
        return fail('Konu ve modül gerekli.', 400);
      }
      const where = and(eq(schema.practiceSessions.userId, user.id),
        eq(schema.practiceSessions.topic, body.konu), eq(schema.practiceSessions.modul, body.modul));
      if (body.action === 'practice-session-save') {
        if (body.payload === undefined || body.payload === null) return fail('Oturum verisi gerekli.', 400);
        if (Buffer.byteLength(JSON.stringify(body.payload), 'utf8') > 256 * 1024) return fail('Oturum verisi 256 KB sınırını aşıyor.', 413);
        await db.insert(schema.practiceSessions).values({
          userId: user.id, topic: body.konu, modul: body.modul, payload: body.payload,
        }).onConflictDoUpdate({
          target: [schema.practiceSessions.userId, schema.practiceSessions.topic, schema.practiceSessions.modul],
          set: { payload: body.payload, updatedAt: new Date() },
        });
        return NextResponse.json({ ok: true });
      }
      if (body.action === 'practice-session-load') {
        const [session] = await db.select({ payload: schema.practiceSessions.payload })
          .from(schema.practiceSessions).where(where).limit(1);
        return NextResponse.json({ payload: session?.payload ?? null });
      }
      await db.delete(schema.practiceSessions).where(where);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'practice-bank' || body.action === 'checkpoints' || body.action === 'practice-stats') {
      const denied = requireAiSources(profile);
      if (denied) return denied;

      if (body.action === 'practice-bank') {
        const rows = await db.select().from(schema.practiceQuestions);
        return NextResponse.json({
          questions: rows.map((q) => ({
            guid: q.guid, konu: q.topic, modul: q.modul, soru: q.prompt, siklar: q.options,
            cevapIdx: q.correctIndex, cevapHarf: ['A', 'B', 'C', 'D'][q.correctIndex] || '',
            cevapMetni: q.options[q.correctIndex] || '', aciklama: q.explanation, kaynak: q.source,
          })),
        } satisfies PracticeBankResponse);
      }

      if (body.action === 'checkpoints') {
        const rows = await db.select().from(schema.practiceCheckpoints).orderBy(schema.practiceCheckpoints.sira);
        return NextResponse.json({
          checkpoints: rows.map((row) => ({
            id: row.id, konu: row.topic, title: row.title, subtitle: row.subtitle, html: row.html,
          })),
        } satisfies PracticeCheckpointsResponse);
      }

      const [rows, sessions] = await Promise.all([
        db.select().from(schema.practiceStats).where(eq(schema.practiceStats.userId, user.id)),
        db.select({
          konu: schema.practiceSessions.topic,
          modul: schema.practiceSessions.modul,
          updatedAt: schema.practiceSessions.updatedAt,
        }).from(schema.practiceSessions).where(eq(schema.practiceSessions.userId, user.id)),
      ]);
      const stats: PracticeStatsResponse['stats'] = {};
      for (const row of rows) {
        stats[row.questionGuid] = {
          gosterim: row.shownCount, dogru: row.correctCount, yanlis: row.wrongCount,
          sonSonucDogruMu: row.lastResult, sonGorulme: row.lastSeenAt?.toISOString() ?? null,
        };
      }
      return NextResponse.json({
        stats,
        sessions: sessions.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
      } satisfies PracticeStatsResponse);
    }

    if (body.action === 'dashboard' || body.action === 'history') {
      return NextResponse.json(await dashboard(user.id));
    }

    if (body.action === 'bank') {
      // Rastgele Soru / Konu Konu Bak — sadeceDeneme derlemesi soru havuzunu HTML'e
      // gömmez; giriş yapmış+onaylı kullanıcı bunu burada, cevaplarıyla birlikte çeker.
      const [activeBank] = await db.select().from(schema.questionBanks).where(eq(schema.questionBanks.isActive, true)).limit(1);
      if (!activeBank) return fail('Aktif soru bankası bulunamadı.', 503);
      const rows = await db.select().from(schema.questions).where(eq(schema.questions.bankId, activeBank.id));
      const harfler = ['A', 'B', 'C', 'D'];
      return NextResponse.json({
        questions: rows.map((q) => ({
          guid: q.guid, konu: q.topic, soru: q.prompt, siklar: q.options,
          cevapIdx: q.correctIndex, cevapHarf: harfler[q.correctIndex] || '',
          cevapMetni: q.options[q.correctIndex] || '', aciklama: q.explanation,
          kaynak: q.source, donem: '', dogrulanmis: q.verified,
        })),
      });
    }

    if (body.action === 'start') {
      const [open] = await db.select({ id: schema.examAttempts.id }).from(schema.examAttempts)
        .where(and(eq(schema.examAttempts.userId, user.id), inArray(schema.examAttempts.status, ['active', 'paused']))).limit(1);
      if (open) return fail('Önce yarım kalan sınavı tamamla veya sil.', 409);

      let mode: ExamMode = body.mode;
      let seed = crypto.getRandomValues(new Uint32Array(1))[0];
      if (!['rastgele', 'azgorulen', 'yanlislar', 'zor'].includes(mode)) return fail('Sınav modu geçersiz.', 400);
      if (body.examCode) {
        const parsed = parseExamCode(body.examCode);
        if (!parsed) return fail('Deneme kodu geçersiz.', 400);
        mode = parsed.mode;
        seed = parsed.seed;
      }

      const [bank] = await db.select().from(schema.questionBanks).where(eq(schema.questionBanks.isActive, true)).limit(1);
      if (!bank) return fail('Aktif soru bankası bulunamadı.', 503);
      const questionRows = await db.select().from(schema.questions).where(eq(schema.questions.bankId, bank.id));
      const bankQuestions: BankQuestion[] = questionRows.map((item) => ({
        id: item.id,
        guid: item.guid,
        topic: item.topic,
        prompt: item.prompt,
        options: item.options,
        correctIndex: item.correctIndex,
        explanation: item.explanation,
      }));
      // "zor" TÜM kullanıcılar arasında en çok yanlış yapılan soruları hedefler — kişisel
      // değil, herkesin question_stats'ı toplanır (guid bazında SUM(wrong_count)). Diğer
      // modlar hâlâ yalnız bu kullanıcının kendi geçmişini kullanır.
      const stats = mode === 'zor'
        ? (await db.select({
            questionGuid: schema.questionStats.questionGuid,
            wrongCount: sql<number>`sum(${schema.questionStats.wrongCount})`.mapWith(Number),
          }).from(schema.questionStats).groupBy(schema.questionStats.questionGuid))
          .map((item) => ({ questionGuid: item.questionGuid, shownCount: 0, wrongCount: item.wrongCount, lastResult: null as boolean | null }))
        : (await db.select().from(schema.questionStats).where(eq(schema.questionStats.userId, user.id)))
          .map((item) => ({ questionGuid: item.questionGuid, shownCount: item.shownCount, wrongCount: item.wrongCount, lastResult: item.lastResult }));
      const picked = selectExamQuestions(bankQuestions, stats, mode, seed);
      if (picked.questions.length !== 50) return fail('Resmî dağılım için yeterli soru bulunamadı.', 503);
      const optionRandom = mulberry32(seed ^ 0x9e3779b9);
      const snapshots = picked.questions.map((item) => shuffleQuestionOptions(item, optionRandom));

      const created = await db.transaction(async (tx) => {
        const [attempt] = await tx.insert(schema.examAttempts).values({
          userId: user.id,
          bankId: bank.id,
          mode,
          examCode: examCode(mode, seed),
        }).returning();
        const insertedQuestions = await tx.insert(schema.examAttemptQuestions).values(snapshots.map((item, index) => ({
          attemptId: attempt.id,
          questionId: item.id,
          questionGuid: item.guid,
          position: index + 1,
          topic: item.topic,
          prompt: item.prompt,
          options: item.options,
          correctIndex: item.correctIndex,
          explanation: item.explanation,
        }))).returning();
        return { attempt, insertedQuestions };
      });
      return NextResponse.json({
        ...summary(created.attempt, 50, 0),
        questions: created.insertedQuestions.map(publicQuestion),
        answers: {},
        resumedAt: created.attempt.lastResumedAt?.toISOString() ?? null,
      });
    }

    if (body.action === 'reminders') {
      const rows = await db.select({ questionGuid: schema.questionFlags.questionGuid })
        .from(schema.questionFlags)
        .where(and(eq(schema.questionFlags.userId, user.id), eq(schema.questionFlags.isReminder, true)));
      return NextResponse.json({ guids: rows.map((r) => r.questionGuid) });
    }

    if (body.action === 'corrections') {
      // Salt-okunur, herkese aynı görünen içerik düzeltme günlüğü (bkz. Test moddaki
      // STATE.duzeltmeler ile aynı kaynak: 08 Sorular/birlestir/bank_corrections.json,
      // portal/data/bank-corrections.json'a kopyalanır). Kullanıcıya özel takip veya
      // istatistik sıfırlama YOK, bilinçli bir tasarım kararı — bkz. web-quiz.md.
      const [activeBankForCorrections] = await db.select().from(schema.questionBanks)
        .where(eq(schema.questionBanks.isActive, true)).limit(1);
      if (!activeBankForCorrections) return NextResponse.json({ items: [] });
      const activeGuids = await db.select({ guid: schema.questions.guid })
        .from(schema.questions).where(eq(schema.questions.bankId, activeBankForCorrections.id));
      const activeGuidSet = new Set(activeGuids.map((r) => r.guid));
      const items = (bankCorrections as Array<{ guid: string; konu: string; soru: string; not: string; tarihISO: string }>)
        .filter((d) => activeGuidSet.has(d.guid))
        .sort((a, b) => (a.tarihISO < b.tarihISO ? 1 : a.tarihISO > b.tarihISO ? -1 : 0))
        .map((d) => ({ guid: d.guid, konu: d.konu, soru: d.soru, not: d.not, tarihISO: d.tarihISO }));
      return NextResponse.json({ items });
    }

    if (body.action === 'wrong-questions') {
      return NextResponse.json({ guids: await wrongQuestionGuids(user.id) });
    }

    if (body.action === 'wrong-question-answer') {
      if (!body.questionGuid || typeof body.selectedAnswer !== 'string') return fail('Cevap geçersiz.', 400);
      const [question] = await db.select({
        correctIndex: schema.questions.correctIndex,
        options: schema.questions.options,
      }).from(schema.questions)
        .innerJoin(schema.questionBanks, eq(schema.questions.bankId, schema.questionBanks.id))
        .where(and(
          eq(schema.questions.guid, body.questionGuid),
          eq(schema.questionBanks.isActive, true),
        )).limit(1);
      if (!question || !question.options.includes(body.selectedAnswer)) return fail('Soru veya cevap geçersiz.', 400);
      const isCorrect = body.selectedAnswer === question.options[question.correctIndex];
      const [existingStat] = await db.select({ lastResult: schema.questionStats.lastResult })
        .from(schema.questionStats)
        .where(and(
          eq(schema.questionStats.userId, user.id),
          eq(schema.questionStats.questionGuid, body.questionGuid),
        )).limit(1);
      if (!existingStat || existingStat.lastResult === null) return fail('Soru yanlış havuzunda değil.', 409);
      if (existingStat.lastResult === true) {
        return NextResponse.json({
          ok: true,
          correct: true,
          alreadyResolved: true,
          guids: await wrongQuestionGuids(user.id),
        });
      }
      const now = new Date();
      // Bu bir resmî deneme değildir: toplam doğru/yanlış/gösterim sayaçlarını
      // değiştirme. Yalnız eriyen yanlış havuzunun son durumunu güncelle.
      await db.update(schema.questionStats).set({ lastResult: isCorrect, lastSeenAt: now })
        .where(and(
          eq(schema.questionStats.userId, user.id),
          eq(schema.questionStats.questionGuid, body.questionGuid),
        ));
      return NextResponse.json({ ok: true, correct: isCorrect, guids: await wrongQuestionGuids(user.id) });
    }

    if (body.action === 'flags') {
      // İşaretler yalnız tarayıcı localStorage'ında (STATE.flags) tutuluyordu —
      // başka bir cihaz/tarayıcıdan devam edince sunucudaki kayıt hâlâ dururken
      // yerelde hiç görünmüyordu ("işaretli sorular yok oluyor" — kullanıcı
      // bildirimi, 8 Eyl 2026). Bu uç, girişte STATE.flags'i sunucudaki gerçek
      // durumla eşitlemek için kullanıcının TÜM işaretlerini döner.
      const rows = await db.select({
        questionGuid: schema.questionFlags.questionGuid,
        note: schema.questionFlags.note,
        category: schema.questionFlags.category,
        isReported: schema.questionFlags.isReported,
        isReminder: schema.questionFlags.isReminder,
      }).from(schema.questionFlags).where(eq(schema.questionFlags.userId, user.id));
      const flags: Record<string, { hatali: boolean; kategori: string | null; hataNotu: string; hatirlatici: boolean }> = {};
      for (const row of rows) {
        flags[row.questionGuid] = {
          hatali: row.isReported, kategori: row.category, hataNotu: row.note, hatirlatici: row.isReminder,
        };
      }
      return NextResponse.json({ flags });
    }

    if (body.action === 'flag') {
      // Doğrudan guid ile çalışır — bir attemptId/questionId'ye bağlı değil, çünkü
      // 🔖 Hatırlatıcı ve 🚩 hatalı bildirimi Deneme sınavı dışında Rastgele Soru/Konu
      // Konu Bak'ta da kullanılır; hepsi aynı sunucu bankasının guid'ini paylaşır
      // (kullanıcı isteği, 8 Eyl 2026 — önceki sürüm yalnız aktif/az önce bitmiş bir
      // Deneme sınavı oturumunda çalışıyordu).
      if (!body.questionGuid) return fail('Soru kimliği eksik.', 400);
      const note = body.note.trim().slice(0, 1000);
      const category = body.category ? body.category.trim().slice(0, 40) : null;
      // reported: hata bayrağı (kategori seçimiyle birlikte gelir). reminder: kişisel
      // "hatırlatıcı" işareti — hatalı olmadan da bağımsız açık/kapalı olabilir.
      const isReported = body.reported !== undefined ? !!body.reported : true;
      const isReminder = !!body.reminder;
      const now = new Date();
      await db.insert(schema.questionFlags).values({
        userId: user.id, questionGuid: body.questionGuid, note, category, isReported, isReminder, updatedAt: now,
      }).onConflictDoUpdate({
        target: [schema.questionFlags.userId, schema.questionFlags.questionGuid],
        set: { note, category, isReported, isReminder, updatedAt: now },
      });
      return NextResponse.json({ ok: true });
    }

    if (!('attemptId' in body) || !body.attemptId) return fail('Sınav kimliği eksik.', 400);

    if (body.action === 'resume') {
      const loaded = await loadAttempt(user.id, body.attemptId);
      if (loaded.attempt.status !== 'active' && loaded.attempt.status !== 'paused') return fail('Bu sınav devam ettirilemez.', 409);
      const now = new Date();
      const [resumed] = await db.update(schema.examAttempts).set({
        status: 'active', elapsedSeconds: currentElapsed(loaded.attempt), lastResumedAt: now, updatedAt: now,
      }).where(and(eq(schema.examAttempts.id, body.attemptId), eq(schema.examAttempts.userId, user.id))).returning();
      // loaded.answers sunucu içi eşleşmeler için attemptQuestionId ile anahtarlanır
      // (bkz. loadAttempt) — istemci ise seçili şıkkı (currentExam.cevaplar) baştan
      // sona questionGuid ile anahtarlıyor. Bu farkı burada kapatmazsak "Kaydet ve
      // Çık" sonrası devam edilince önceden işaretlenmiş şıklar hiç görünmüyordu
      // (guid anahtarıyla arayınca bulunamıyordu) — kullanıcı bildirimi, 8 Eyl 2026.
      const answersByGuid: Record<string, number> = {};
      for (const q of loaded.questions) {
        if (loaded.answers[q.id] !== undefined) answersByGuid[q.questionGuid] = loaded.answers[q.id];
      }
      return NextResponse.json({
        ...summary(resumed, loaded.questions.length, Object.keys(loaded.answers).length),
        questions: loaded.questions.map(publicQuestion),
        answers: answersByGuid,
        resumedAt: resumed.lastResumedAt?.toISOString() ?? null,
      });
    }

    if (body.action === 'answer') {
      const loaded = await loadAttempt(user.id, body.attemptId);
      if (loaded.attempt.status !== 'active') return fail('Sınav aktif değil.', 409);
      if (currentElapsed(loaded.attempt) >= 3600) return fail('Sınav süresi doldu; sınavı tamamla.', 409);
      const question = loaded.questions.find((item) => item.id === body.questionId);
      if (!question || !Number.isInteger(body.selectedIndex) || body.selectedIndex < 0 || body.selectedIndex >= question.options.length) {
        return fail('Cevap geçersiz.', 400);
      }
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.insert(schema.examAnswers).values({
          attemptQuestionId: question.id, selectedIndex: body.selectedIndex, answeredAt: now,
        }).onConflictDoUpdate({
          target: schema.examAnswers.attemptQuestionId,
          set: { selectedIndex: body.selectedIndex, answeredAt: now },
        });
        await tx.update(schema.examAttempts).set({ updatedAt: now }).where(eq(schema.examAttempts.id, body.attemptId));
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'pause' || body.action === 'cancel') {
      const loaded = await loadAttempt(user.id, body.attemptId);
      if (body.action === 'pause' && loaded.attempt.status !== 'active') return fail('Sınav aktif değil.', 409);
      if (body.action === 'cancel' && loaded.attempt.status !== 'active' && loaded.attempt.status !== 'paused') return fail('Bu sınav silinemez.', 409);
      const now = new Date();
      await db.update(schema.examAttempts).set({
        status: body.action === 'pause' ? 'paused' : 'cancelled',
        elapsedSeconds: currentElapsed(loaded.attempt),
        lastResumedAt: null,
        updatedAt: now,
      }).where(and(eq(schema.examAttempts.id, body.attemptId), eq(schema.examAttempts.userId, user.id)));
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'delete') {
      // Geçmişten bir denemeyi kalıcı olarak siler; bu denemenin question_stats'a
      // katkısı da (shownCount/correctCount/wrongCount) geri alınır — yerel uygulamanın
      // deleteHistoryEntry()'sinin sunucu tarafındaki karşılığı.
      const loaded = await loadAttempt(user.id, body.attemptId);
      if (loaded.attempt.status !== 'finished') return fail('Yalnız tamamlanmış denemeler silinebilir.', 409);
      await db.transaction(async (tx) => {
        if (loaded.attempt.statsApplied) {
          for (const q of loaded.questions) {
            const selected = loaded.answers[q.id];
            const wasCorrect = selected === undefined ? null : selected === q.correctIndex;
            const where = and(eq(schema.questionStats.userId, user.id), eq(schema.questionStats.questionGuid, q.questionGuid));
            if (wasCorrect === true) {
              await tx.update(schema.questionStats).set({
                shownCount: sql`greatest(${schema.questionStats.shownCount} - 1, 0)`,
                correctCount: sql`greatest(${schema.questionStats.correctCount} - 1, 0)`,
              }).where(where);
            } else if (wasCorrect === false) {
              await tx.update(schema.questionStats).set({
                shownCount: sql`greatest(${schema.questionStats.shownCount} - 1, 0)`,
                wrongCount: sql`greatest(${schema.questionStats.wrongCount} - 1, 0)`,
              }).where(where);
            } else {
              await tx.update(schema.questionStats).set({
                shownCount: sql`greatest(${schema.questionStats.shownCount} - 1, 0)`,
              }).where(where);
            }
            const [row] = await tx.select({ shownCount: schema.questionStats.shownCount })
              .from(schema.questionStats).where(where).limit(1);
            if (row && row.shownCount === 0) {
              await tx.update(schema.questionStats).set({ lastResult: null, lastSeenAt: null }).where(where);
            }
          }
        }
        await tx.delete(schema.examAttempts)
          .where(and(eq(schema.examAttempts.id, loaded.attempt.id), eq(schema.examAttempts.userId, user.id)));
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'finish') {
      const loaded = await loadAttempt(user.id, body.attemptId);
      if (loaded.attempt.status !== 'active' && loaded.attempt.status !== 'finished') return fail('Sınav tamamlanamaz.', 409);
      const review = loaded.questions.map((item) => {
        const selectedIndex = loaded.answers[item.id] ?? null;
        return {
          ...publicQuestion(item),
          selectedIndex,
          correctIndex: item.correctIndex,
          explanation: item.explanation,
          isCorrect: selectedIndex === null ? null : selectedIndex === item.correctIndex,
        };
      });
      const correct = review.filter((item) => item.isCorrect === true).length;
      const wrong = review.filter((item) => item.isCorrect === false).length;
      const blank = review.filter((item) => item.isCorrect === null).length;
      const percent = Math.round(correct / review.length * 100);
      const finished = await db.transaction(async (tx) => {
        await tx.execute(sql`select id from exam_attempts where id = ${body.attemptId} and user_id = ${user.id} for update`);
        const [current] = await tx.select().from(schema.examAttempts)
          .where(and(eq(schema.examAttempts.id, body.attemptId), eq(schema.examAttempts.userId, user.id))).limit(1);
        if (!current) throw new Error('NOT_FOUND');
        let result = current;
        if (current.status === 'active') {
          const now = new Date();
          [result] = await tx.update(schema.examAttempts).set({
            status: 'finished',
            elapsedSeconds: currentElapsed(current),
            lastResumedAt: null,
            finishedAt: now,
            updatedAt: now,
            correctCount: correct,
            wrongCount: wrong,
            blankCount: blank,
            scorePercent: percent,
          }).where(eq(schema.examAttempts.id, body.attemptId)).returning();
        }
        if (!result.statsApplied) {
          const seenAt = result.finishedAt ?? new Date();
          await tx.insert(schema.questionStats).values(review.map((item) => ({
            userId: user.id,
            questionGuid: item.guid,
            shownCount: 1,
            correctCount: item.isCorrect === true ? 1 : 0,
            wrongCount: item.isCorrect === false ? 1 : 0,
            lastResult: item.isCorrect,
            lastSeenAt: seenAt,
          }))).onConflictDoUpdate({
            target: [schema.questionStats.userId, schema.questionStats.questionGuid],
            set: {
              shownCount: sql`${schema.questionStats.shownCount} + excluded.shown_count`,
              correctCount: sql`${schema.questionStats.correctCount} + excluded.correct_count`,
              wrongCount: sql`${schema.questionStats.wrongCount} + excluded.wrong_count`,
              lastResult: sql`excluded.last_result`,
              lastSeenAt: sql`excluded.last_seen_at`,
            },
          });
          [result] = await tx.update(schema.examAttempts).set({ statsApplied: true })
            .where(eq(schema.examAttempts.id, body.attemptId)).returning();
        }
        return result;
      });
      const topicMap = new Map<string, { correct: number; total: number }>();
      for (const item of review) {
        const entry = topicMap.get(item.topic) ?? { correct: 0, total: 0 };
        entry.total += 1;
        if (item.isCorrect) entry.correct += 1;
        topicMap.set(item.topic, entry);
      }
      const topicBreakdown = [...topicMap.entries()].map(([topic, value]) => ({
        topic, ...value, percent: Math.round(value.correct / value.total * 100),
      }));
      return NextResponse.json({
        ...summary(finished, review.length, review.length - blank),
        score: { correct, wrong, blank, percent },
        topicBreakdown,
        review,
      });
    }

    return fail('İşlem tanınmadı.', 400);
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_CONFLICT') return fail('İstek kimliği başka bir cevap için kullanılmış.', 409);
    if (error instanceof Error && error.message === 'NOT_FOUND') return fail('Sınav bulunamadı.', 404);
    console.error(error);
    return fail('İşlem tamamlanamadı.', 500);
  }
}
