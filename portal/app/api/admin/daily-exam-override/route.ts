import { NextResponse } from 'next/server';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { dailyExamCode, secondDailyExamCode, OFFICIAL_DISTRIBUTION, mulberry32, parseExamCode, shuffleQuestionOptions } from '@/lib/exam-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const DAY = '2026-10-01';

function authorized(request: Request) {
  const token = process.env.FLAGS_EXPORT_TOKEN;
  return !!token && request.headers.get('authorization') === `Bearer ${token}`;
}

type Reader = Pick<ReturnType<typeof getDb>, 'select'>;
async function selection(reader: Reader) {
  const [bank] = await reader.select().from(schema.questionBanks).where(eq(schema.questionBanks.isActive, true)).limit(1);
  if (!bank) throw new Error('Aktif soru bankası yok.');
  const rows = await reader.select({ question: schema.questions,
    correct: sql<number>`coalesce(sum(${schema.questionStats.correctCount}), 0)::int`,
    wrong: sql<number>`coalesce(sum(${schema.questionStats.wrongCount}), 0)::int`,
  }).from(schema.questions).leftJoin(schema.questionStats, eq(schema.questionStats.questionGuid, schema.questions.guid))
    .where(eq(schema.questions.bankId, bank.id)).groupBy(schema.questions.id);
  const eligible = rows.filter(q => q.correct + q.wrong >= (q.question.topic === 'Kambiyo' ? 8 : 11)).sort((a,b) =>
    b.wrong * (a.correct + a.wrong) - a.wrong * (b.correct + b.wrong)
    || b.wrong - a.wrong || a.question.guid.localeCompare(b.question.guid));
  const selected = Object.entries(OFFICIAL_DISTRIBUTION).flatMap(([topic, quota]) =>
    eligible.filter(q => q.question.topic === topic).slice(0, quota));
  const chosen = new Set(selected.map(q => q.question.guid));
  const distribution = Object.fromEntries(Object.keys(OFFICIAL_DISTRIBUTION).map(topic =>
    [topic, selected.filter(q => q.question.topic === topic).length]));
  const remaining = Object.fromEntries(Object.keys(OFFICIAL_DISTRIBUTION).map(topic =>
    [topic, rows.filter(q => q.question.topic === topic && !chosen.has(q.question.guid)).length]));
  const topicSummary = Object.entries(OFFICIAL_DISTRIBUTION).map(([topic, quota]) => {
    const picked = selected.filter(q => q.question.topic === topic);
    const rates = picked.map(q => 100 * q.wrong / (q.correct + q.wrong));
    return { topic, quota, minimumAnswered: topic === 'Kambiyo' ? 8 : 11,
      eligibleCount: eligible.filter(q => q.question.topic === topic).length,
      selectedCount: picked.length, missing: quota - picked.length,
      minWrongPercent: rates.length ? Math.min(...rates) : null,
      maxWrongPercent: rates.length ? Math.max(...rates) : null };
  });
  const report = { day: DAY, number: 1, code: dailyExamCode(DAY), bankId: bank.id,
    capturedAt: new Date().toISOString(), activeCount: rows.length, eligibleCount: eligible.length,
    selectionRule: 'official topic quotas; correct + wrong >= 11 (Kambiyo >= 8); within topic wrong / (correct + wrong) DESC; wrong DESC; guid ASC',
    topicSummary,
    officialDistribution: OFFICIAL_DISTRIBUTION, distribution,
    distributionDiffers: Object.entries(OFFICIAL_DISTRIBUTION).some(([t,n]) => distribution[t] !== n),
    remainingByTopic: remaining,
    secondExamFeasible: Object.entries(OFFICIAL_DISTRIBUTION).every(([t,n]) => remaining[t] >= n),
    selected: selected.map(({ question: q, correct, wrong }, index) => ({
      rank: index+1, guid: q.guid, topic: q.topic, prompt: q.prompt,
      correct, wrong, answered: correct+wrong, wrongPercent: 100*wrong/(correct+wrong),
    })),
  };
  return { bank, selected, report };
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json((await selection(getDb())).report);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: { day?: unknown; replaceCode?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Geçersiz JSON.' }, { status: 400 }); }
  if (body.day !== DAY) return NextResponse.json({ error: 'Bu işlem yalnız 1 Ekim 2026 içindir.' }, { status: 400 });
  if (Date.now() >= Date.parse(`${DAY}T00:00:00+03:00`)) return NextResponse.json({ error: 'Hazırlama süresi doldu.' }, { status: 409 });
  return getDb().transaction(async tx => {
    const code = dailyExamCode(DAY);
    const codes = [code, secondDailyExamCode(DAY)].sort();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'daily-exams:' + DAY}))`);
    for (const item of codes) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${item}))`);
    const existing = await tx.select().from(schema.dailyExams).where(eq(schema.dailyExams.day, DAY));
    const attempts = await tx.select({ id: schema.examAttempts.id }).from(schema.examAttempts)
      .where(or(inArray(schema.examAttempts.examCode, codes), eq(schema.examAttempts.dailyDay, DAY))).limit(1);
    if (attempts.length || existing.some(item => item.number === 2)) return NextResponse.json({ error: 'Günün denemesi başlatılmış veya ikinci deneme oluşturulmuş; mevcut sorular değiştirilemez.' }, { status: 409 });
    const first = existing.find(item => item.number === 1);
    if (first && (first.code !== code || body.replaceCode !== code)) return NextResponse.json({ error: 'Düzeltme için mevcut ilk denemenin aynı kodu zorunludur.' }, { status: 409 });
    const { bank, selected, report } = await selection(tx);
    if (selected.length !== 50 || report.distributionDiffers || !report.secondExamFeasible) return NextResponse.json({ error: 'Yeterli uygun konu sorusu veya kesişmeyen ikinci deneme kotası yok.', ...report }, { status: 503 });
    const random = mulberry32(parseExamCode(code)!.seed ^ 0x9e3779b9);
    const snapshots = selected.map(({ question: q }) => {
      const shuffled = shuffleQuestionOptions(q, random);
      return { questionId: q.id, questionGuid: q.guid, topic: q.topic, prompt: q.prompt,
        options: shuffled.options, correctIndex: shuffled.correctIndex, explanation: q.explanation };
    });
    if (first) await tx.update(schema.dailyExams).set({ bankId: bank.id, snapshots }).where(eq(schema.dailyExams.code, code));
    else await tx.insert(schema.dailyExams).values({ code, day: DAY, number: 1, bankId: bank.id, snapshots });
    return NextResponse.json({ prepared: true, replaced: !!first, attemptsBeforeUpdate: 0, ...report });
  });
}
