import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { fixedExamCode } from '@/lib/exam-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function checkAuth(req: Request) {
  const token = process.env.FLAGS_EXPORT_TOKEN;
  if (!token) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${token}`;
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: { title?: unknown; guids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz JSON.' }, { status: 400 });
  }
  if (typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'Başlık zorunludur.' }, { status: 400 });
  }
  if (!Array.isArray(body.guids) || body.guids.length !== 50
    || body.guids.some((guid) => typeof guid !== 'string' || !guid.trim())
    || new Set(body.guids).size !== 50) {
    return NextResponse.json({ error: 'guids tam 50 benzersiz string olmalıdır.' }, { status: 400 });
  }
  const guids = body.guids as string[];
  const db = getDb();
  const [bank] = await db.select().from(schema.questionBanks).where(eq(schema.questionBanks.isActive, true)).limit(1);
  if (!bank) return NextResponse.json({ error: 'Aktif soru bankası bulunamadı.' }, { status: 503 });
  const rows = await db.select({ guid: schema.questions.guid }).from(schema.questions)
    .where(eq(schema.questions.bankId, bank.id));
  const activeGuids = new Set(rows.map((row) => row.guid));
  const missing = [...new Set(guids.filter((guid) => !activeGuids.has(guid)))];
  if (missing.length) return NextResponse.json({ error: 'Sorular aktif bankada bulunamadı.', missing }, { status: 400 });

  while (true) {
    const seed = randomBytes(4).readUInt32BE(0);
    const code = fixedExamCode(seed);
    const [existing] = await db.select({ code: schema.fixedExams.code }).from(schema.fixedExams)
      .where(eq(schema.fixedExams.code, code)).limit(1);
    if (existing) continue;
    const [created] = await db.insert(schema.fixedExams)
      .values({ code, title: body.title.trim(), questionGuids: guids })
      .onConflictDoNothing({ target: schema.fixedExams.code })
      .returning();
    if (!created) continue;
    return NextResponse.json({ code: created.code, title: created.title, count: created.questionGuids.length });
  }
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const rows = await getDb().select().from(schema.fixedExams).orderBy(schema.fixedExams.createdAt);
  return NextResponse.json(rows.map((row) => ({
    code: row.code, title: row.title, count: row.questionGuids.length, createdAt: row.createdAt,
  })));
}
