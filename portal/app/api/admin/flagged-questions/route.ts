import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Günlük bakım akışı için: question_flags tablosunu DATABASE_URL olmadan, token korumalı
// bir HTTP ucundan okunabilir/güncellenebilir hale getirir. GET işaretli soruları döner,
// POST belirtilen (userId, questionGuid) çiftlerini "çözüldü" (isReported=false) işaretler.
// Token yalnız bu iki işleme yetkilidir — DATABASE_URL'i veya başka bir tabloyu açığa çıkarmaz.

function checkAuth(req: Request) {
  const token = process.env.FLAGS_EXPORT_TOKEN;
  if (!token) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${token}`;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const includeResolved = url.searchParams.get('all') === '1';

  const db = getDb();
  const rows = await db
    .select({
      userId: schema.questionFlags.userId,
      questionGuid: schema.questionFlags.questionGuid,
      note: schema.questionFlags.note,
      category: schema.questionFlags.category,
      isReported: schema.questionFlags.isReported,
      updatedAt: schema.questionFlags.updatedAt,
      username: schema.profiles.username,
      displayName: schema.profiles.displayName,
    })
    .from(schema.questionFlags)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.questionFlags.userId))
    .where(includeResolved ? undefined : eq(schema.questionFlags.isReported, true))
    .orderBy(desc(schema.questionFlags.updatedAt));

  return NextResponse.json({ flags: rows });
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as { items?: { userId: string; questionGuid: string }[] } | null;
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: 'items gerekli' }, { status: 400 });

  const db = getDb();
  let updated = 0;
  for (const item of items) {
    if (!item?.userId || !item?.questionGuid) continue;
    const rows = await db
      .update(schema.questionFlags)
      .set({ isReported: false, updatedAt: new Date() })
      .where(and(eq(schema.questionFlags.userId, item.userId), eq(schema.questionFlags.questionGuid, item.questionGuid)))
      .returning({ questionGuid: schema.questionFlags.questionGuid });
    updated += rows.length;
  }
  return NextResponse.json({ updated });
}
