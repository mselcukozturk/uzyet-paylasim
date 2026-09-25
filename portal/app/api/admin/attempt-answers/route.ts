import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function checkAuth(req: Request) {
  const token = process.env.FLAGS_EXPORT_TOKEN;
  if (!token) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${token}`;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const username = url.searchParams.get('username')?.trim();
  if (!username) {
    return NextResponse.json({ error: 'username parametresi gerekli.' }, { status: 400 });
  }

  const limitRaw = url.searchParams.get('limit');
  const limitParsed = limitRaw !== null ? Number(limitRaw) : 3;
  const limit = Math.min(10, Math.max(1, Number.isInteger(limitParsed) && limitParsed > 0 ? limitParsed : 3));

  const db = getDb();
  const [profile] = await db
    .select({ userId: schema.profiles.userId, username: schema.profiles.username })
    .from(schema.profiles)
    .where(sql`lower(${schema.profiles.username}) = lower(${username})`)
    .limit(1);

  if (!profile) {
    return NextResponse.json({ error: 'Kullanıcı bulunamadı.' }, { status: 404 });
  }

  const attempts = await db
    .select()
    .from(schema.examAttempts)
    .where(eq(schema.examAttempts.userId, profile.userId))
    .orderBy(desc(schema.examAttempts.startedAt))
    .limit(limit);

  if (attempts.length === 0) {
    return NextResponse.json([]);
  }

  const attemptIds = attempts.map((a) => a.id);
  const allQuestions = await db
    .select()
    .from(schema.examAttemptQuestions)
    .where(inArray(schema.examAttemptQuestions.attemptId, attemptIds))
    .orderBy(schema.examAttemptQuestions.position);

  const questionIds = allQuestions.map((q) => q.id);
  const allAnswers = questionIds.length
    ? await db
        .select()
        .from(schema.examAnswers)
        .where(inArray(schema.examAnswers.attemptQuestionId, questionIds))
    : [];

  const answerMap = new Map(allAnswers.map((a) => [a.attemptQuestionId, a.selectedIndex]));
  const questionsByAttempt = new Map<string, typeof allQuestions>();
  for (const q of allQuestions) {
    const list = questionsByAttempt.get(q.attemptId) ?? [];
    list.push(q);
    questionsByAttempt.set(q.attemptId, list);
  }

  const result = attempts.map((attempt) => {
    const qList = questionsByAttempt.get(attempt.id) ?? [];
    return {
      id: attempt.id,
      examCode: attempt.examCode,
      status: attempt.status,
      startedAt: attempt.startedAt.toISOString(),
      finishedAt: attempt.finishedAt?.toISOString() ?? null,
      correctCount: attempt.correctCount,
      wrongCount: attempt.wrongCount,
      blankCount: attempt.blankCount,
      statsApplied: attempt.statsApplied,
      questions: qList.map((q) => ({
        attemptQuestionId: q.id,
        position: q.position,
        questionGuid: q.questionGuid,
        topic: q.topic,
        prompt: q.prompt,
        options: q.options,
        correctIndex: q.correctIndex,
        selectedIndex: answerMap.get(q.id) ?? null,
      })),
    };
  });

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { attemptId?: unknown; answers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz JSON.' }, { status: 400 });
  }

  if (typeof body.attemptId !== 'string' || !body.attemptId.trim()) {
    return NextResponse.json({ error: 'attemptId zorunludur.' }, { status: 400 });
  }
  if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
    return NextResponse.json({ error: 'answers nesnesi zorunludur.' }, { status: 400 });
  }

  const attemptId = body.attemptId.trim();
  const rawAnswers = body.answers as Record<string, unknown>;

  const db = getDb();
  return await db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId))
      .limit(1);

    if (!attempt) {
      return NextResponse.json({ error: 'Deneme bulunamadı.' }, { status: 404 });
    }

    const questions = await tx
      .select()
      .from(schema.examAttemptQuestions)
      .where(eq(schema.examAttemptQuestions.attemptId, attemptId))
      .orderBy(schema.examAttemptQuestions.position);

    const questionMap = new Map(questions.map((q) => [q.id, q]));
    const questionIds = questions.map((q) => q.id);

    // 1. Doğrulama: geçersiz varsa 400 ve hiçbir şey yazma.
    const validatedEntries: Array<{ attemptQuestionId: string; selectedIndex: number; question: typeof questions[0] }> = [];
    for (const [qId, idxRaw] of Object.entries(rawAnswers)) {
      const q = questionMap.get(qId);
      if (!q) {
        return NextResponse.json({ error: `Geçersiz soru kimliği: ${qId}` }, { status: 400 });
      }
      if (typeof idxRaw !== 'number' || !Number.isInteger(idxRaw) || idxRaw < 0 || idxRaw >= q.options.length) {
        return NextResponse.json({ error: `Geçersiz şık: ${qId}` }, { status: 400 });
      }
      validatedEntries.push({ attemptQuestionId: q.id, selectedIndex: idxRaw, question: q });
    }

    // Mevcut cevapları oku
    const existingAnswers = questionIds.length
      ? await tx.select().from(schema.examAnswers).where(inArray(schema.examAnswers.attemptQuestionId, questionIds))
      : [];
    const oldAnswerMap = new Map(existingAnswers.map((a) => [a.attemptQuestionId, a.selectedIndex]));
    const currentAnswerMap = new Map(oldAnswerMap);

    const now = new Date();
    let changedQuestions = 0;

    // Her geçerli cevabı upsert et
    for (const entry of validatedEntries) {
      const oldIdx = oldAnswerMap.get(entry.attemptQuestionId);
      if (oldIdx !== entry.selectedIndex) {
        changedQuestions++;
      }
      await tx.insert(schema.examAnswers).values({
        attemptQuestionId: entry.attemptQuestionId,
        selectedIndex: entry.selectedIndex,
        answeredAt: now,
      }).onConflictDoUpdate({
        target: schema.examAnswers.attemptQuestionId,
        set: { selectedIndex: entry.selectedIndex, answeredAt: now },
      });
      currentAnswerMap.set(entry.attemptQuestionId, entry.selectedIndex);
    }

    // 2. Deneme finished ise correct/wrong/blank/scorePercent'i tüm sorulardan yeniden hesapla ve yaz
    let correct = 0;
    let wrong = 0;
    let blank = 0;
    for (const q of questions) {
      const sel = currentAnswerMap.get(q.id);
      if (sel === undefined || sel === null) {
        blank++;
      } else if (sel === q.correctIndex) {
        correct++;
      } else {
        wrong++;
      }
    }
    const total = questions.length;
    const scorePercent = total ? Math.round((correct / total) * 100) : 0;

    if (attempt.status === 'finished') {
      await tx.update(schema.examAttempts).set({
        correctCount: correct,
        wrongCount: wrong,
        blankCount: blank,
        scorePercent,
        updatedAt: now,
      }).where(eq(schema.examAttempts.id, attempt.id));
    }

    // 3. statsApplied true ise yalnız sonucu DEĞİŞEN sorular için question_stats'ı düzelt:
    // eski sonuç (boş/doğru/yanlış) sayacından 1 düş (greatest(x-1,0)), yeni sonucun sayacına 1 ekle,
    // lastResult'u yeni sonuca çek. shownCount değişmez.
    if (attempt.statsApplied) {
      for (const entry of validatedEntries) {
        const q = entry.question;
        const oldSel = oldAnswerMap.get(q.id);
        const newSel = entry.selectedIndex;

        const oldResult: 'blank' | 'correct' | 'wrong' =
          oldSel === undefined || oldSel === null ? 'blank' : (oldSel === q.correctIndex ? 'correct' : 'wrong');
        const newResult: 'blank' | 'correct' | 'wrong' =
          newSel === q.correctIndex ? 'correct' : 'wrong';

        if (oldResult === newResult) continue;

        let correctDelta = 0;
        let wrongDelta = 0;
        if (oldResult === 'correct') correctDelta -= 1;
        if (oldResult === 'wrong') wrongDelta -= 1;

        if (newResult === 'correct') correctDelta += 1;
        if (newResult === 'wrong') wrongDelta += 1;

        const setFields: Record<string, unknown> = {
          lastResult: newResult === 'correct' ? true : (newResult === 'wrong' ? false : null),
          lastSeenAt: now,
        };

        if (correctDelta > 0) {
          setFields.correctCount = sql`${schema.questionStats.correctCount} + 1`;
        } else if (correctDelta < 0) {
          setFields.correctCount = sql`greatest(${schema.questionStats.correctCount} - 1, 0)`;
        }

        if (wrongDelta > 0) {
          setFields.wrongCount = sql`${schema.questionStats.wrongCount} + 1`;
        } else if (wrongDelta < 0) {
          setFields.wrongCount = sql`greatest(${schema.questionStats.wrongCount} - 1, 0)`;
        }

        const [existingStat] = await tx
          .select({ userId: schema.questionStats.userId })
          .from(schema.questionStats)
          .where(and(
            eq(schema.questionStats.userId, attempt.userId),
            eq(schema.questionStats.questionGuid, q.questionGuid),
          ))
          .limit(1);

        if (existingStat) {
          await tx.update(schema.questionStats)
            .set(setFields)
            .where(and(
              eq(schema.questionStats.userId, attempt.userId),
              eq(schema.questionStats.questionGuid, q.questionGuid),
            ));
        } else {
          await tx.insert(schema.questionStats).values({
            userId: attempt.userId,
            questionGuid: q.questionGuid,
            shownCount: 1,
            correctCount: newResult === 'correct' ? 1 : 0,
            wrongCount: newResult === 'wrong' ? 1 : 0,
            lastResult: newResult === 'correct' ? true : (newResult === 'wrong' ? false : null),
            lastSeenAt: now,
          });
        }
      }
    }

    // 4. Yanıt: güncel sayılar + değişen soru sayısı
    return NextResponse.json({
      ok: true,
      correctCount: correct,
      wrongCount: wrong,
      blankCount: blank,
      scorePercent,
      changedCount: changedQuestions,
      changedQuestions,
    });
  });
}
