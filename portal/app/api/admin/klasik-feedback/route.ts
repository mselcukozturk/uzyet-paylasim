import { NextResponse } from 'next/server';
import { asc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function checkAuth(req: Request) {
  const token = process.env.FLAGS_EXPORT_TOKEN;
  return !!token && req.headers.get('authorization') === `Bearer ${token}`;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const items = await getDb().select({
    id: schema.klasikGeriBildirim.id, soruNo: schema.klasikGeriBildirim.soruNo,
    metin: schema.klasikGeriBildirim.metin, olusturmaZamani: schema.klasikGeriBildirim.olusturmaZamani,
    kullaniciAdi: schema.profiles.username,
  }).from(schema.klasikGeriBildirim)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.klasikGeriBildirim.userId))
    .where(eq(schema.klasikGeriBildirim.durum, 'bekliyor'))
    .orderBy(asc(schema.klasikGeriBildirim.olusturmaZamani));
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.ids) || !body.ids.every((id: unknown) => typeof id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    return NextResponse.json({ error: 'Geçerli ids dizisi gerekli.' }, { status: 400 });
  }
  if (!body.ids.length) return NextResponse.json({ ok: true, updated: 0 });
  const rows = await getDb().update(schema.klasikGeriBildirim).set({ durum: 'islendi' })
    .where(inArray(schema.klasikGeriBildirim.id, body.ids)).returning({ id: schema.klasikGeriBildirim.id });
  return NextResponse.json({ ok: true, updated: rows.length });
}
