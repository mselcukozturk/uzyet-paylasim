import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
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

  const db = getDb();

  const attemptsRows = await db
    .select({
      examCode: schema.examAttempts.examCode,
      mode: schema.examAttempts.mode,
      dailyDay: schema.examAttempts.dailyDay,
      dailyNumber: schema.examAttempts.dailyNumber,
      username: schema.profiles.username,
      finishedAt: schema.examAttempts.finishedAt,
      correctCount: schema.examAttempts.correctCount,
      wrongCount: schema.examAttempts.wrongCount,
      blankCount: schema.examAttempts.blankCount,
      scorePercent: schema.examAttempts.scorePercent,
    })
    .from(schema.examAttempts)
    .leftJoin(schema.profiles, eq(schema.examAttempts.userId, schema.profiles.userId))
    .where(eq(schema.examAttempts.status, 'finished'))
    .orderBy(asc(schema.examAttempts.finishedAt));

  const attempts = attemptsRows.map((row) => ({
    examCode: row.examCode,
    mode: row.mode,
    dailyDay: row.dailyDay,
    dailyNumber: row.dailyNumber,
    username: row.username ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    correctCount: row.correctCount,
    wrongCount: row.wrongCount,
    blankCount: row.blankCount,
    scorePercent: row.scorePercent,
  }));

  const fixedExams = await db
    .select({
      code: schema.fixedExams.code,
      title: schema.fixedExams.title,
    })
    .from(schema.fixedExams);

  return NextResponse.json({ attempts, fixedExams });
}
