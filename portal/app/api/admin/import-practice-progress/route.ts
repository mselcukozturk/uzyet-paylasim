import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Kişisel Artifact'ten (uzyet_quiz_dist.html) taşınan pratik ilerlemesini (pStats) ve
// işaretleri (question_flags) tek yönetici hesabına yazan tek seferlik göç ucu (#24).
// Hedef her zaman is_admin=true tek profildir — tasarım gereği bu site tek yöneticilidir.

function checkAuth(req: Request) {
  const token = process.env.FLAGS_EXPORT_TOKEN;
  if (!token) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${token}`;
}

async function adminUserId() {
  const db = getDb();
  const admins = await db.select({ userId: schema.profiles.userId }).from(schema.profiles).where(eq(schema.profiles.isAdmin, true));
  if (admins.length !== 1) throw new Error(`admin sayısı 1 değil: ${admins.length}`);
  return admins[0].userId;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = getDb();
  const userId = await adminUserId();
  const stats = await db.select({ questionGuid: schema.practiceStats.questionGuid }).from(schema.practiceStats).where(eq(schema.practiceStats.userId, userId));
  const flags = await db.select({ questionGuid: schema.questionFlags.questionGuid }).from(schema.questionFlags).where(eq(schema.questionFlags.userId, userId));
  return NextResponse.json({
    userId,
    practiceStatsCount: stats.length,
    practiceStatsGuids: stats.map((r) => r.questionGuid),
    flagsCount: flags.length,
    flagsGuids: flags.map((r) => r.questionGuid),
  });
}

type ImportPayload = {
  pStats?: { guid: string; shown: number; correct: number; wrong: number; lastResult: boolean | null; lastSeenAt: string | null }[];
  flags?: { guid: string; note: string; category: string | null; isReported: boolean; isReminder: boolean; updatedAt: string }[];
};

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as ImportPayload | null;
  if (!body || (!body.pStats && !body.flags)) return NextResponse.json({ error: 'pStats veya flags gerekli' }, { status: 400 });

  const userId = await adminUserId();
  const db = getDb();

  let statsWritten = 0;
  let flagsWritten = 0;

  await db.transaction(async (tx) => {
    for (const item of body.pStats ?? []) {
      if (!item.guid) continue;
      await tx.insert(schema.practiceStats).values({
        userId,
        questionGuid: item.guid,
        shownCount: item.shown,
        correctCount: item.correct,
        wrongCount: item.wrong,
        lastResult: item.lastResult,
        lastSeenAt: item.lastSeenAt ? new Date(item.lastSeenAt) : null,
      }).onConflictDoUpdate({
        target: [schema.practiceStats.userId, schema.practiceStats.questionGuid],
        set: {
          shownCount: item.shown, correctCount: item.correct, wrongCount: item.wrong,
          lastResult: item.lastResult, lastSeenAt: item.lastSeenAt ? new Date(item.lastSeenAt) : null,
        },
      });
      statsWritten += 1;
    }

    for (const item of body.flags ?? []) {
      if (!item.guid) continue;
      await tx.insert(schema.questionFlags).values({
        userId,
        questionGuid: item.guid,
        note: item.note ?? '',
        category: item.category ?? null,
        isReported: !!item.isReported,
        isReminder: !!item.isReminder,
        updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
      }).onConflictDoUpdate({
        target: [schema.questionFlags.userId, schema.questionFlags.questionGuid],
        set: {
          note: item.note ?? '', category: item.category ?? null,
          isReported: !!item.isReported, isReminder: !!item.isReminder,
          updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
        },
      });
      flagsWritten += 1;
    }
  });

  return NextResponse.json({ ok: true, userId, statsWritten, flagsWritten });
}
