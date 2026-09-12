import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Aktif soru bankasını Excel'de açılabilir CSV olarak döner — sitenin güncel halini
// yerel pipeline'dan (08 Sorular/birlestir) bağımsız olarak dışa aktarmak için.
// DATABASE_URL gerekmez, FLAGS_EXPORT_TOKEN yeterli.

function checkAuth(req: Request) {
  const token = process.env.FLAGS_EXPORT_TOKEN;
  if (!token) return false;
  return req.headers.get('authorization') === `Bearer ${token}`;
}

function csvField(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getDb();
  const [activeBank] = await db.select().from(schema.questionBanks).where(eq(schema.questionBanks.isActive, true)).limit(1);
  if (!activeBank) return NextResponse.json({ error: 'aktif banka yok' }, { status: 404 });

  const rows = await db.select().from(schema.questions).where(eq(schema.questions.bankId, activeBank.id));

  const header = ['guid', 'konu', 'soru', 'a', 'b', 'c', 'd', 'cevap_harf', 'aciklama', 'kaynak', 'dogrulanmis'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const opts = row.options;
    const cevapHarf = 'ABCD'[row.correctIndex] ?? '';
    lines.push([
      row.guid, row.topic, row.prompt, opts[0] ?? '', opts[1] ?? '', opts[2] ?? '', opts[3] ?? '',
      cevapHarf, row.explanation, row.source, row.verified ? 'evet' : 'hayır',
    ].map((v) => csvField(String(v))).join(','));
  }

  return new NextResponse('﻿' + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="uzyet-soru-bankasi-${activeBank.version}.csv"`,
    },
  });
}
