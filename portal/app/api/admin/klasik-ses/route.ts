import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function checkAuth(req: Request) {
  const token = process.env.FLAGS_EXPORT_TOKEN;
  if (!token) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${token}`;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getDb();
  const rows = await db
    .select({
      no: schema.klasikSes.soruNo,
      tur: schema.klasikSes.tur,
      surum: schema.klasikSes.surum,
    })
    .from(schema.klasikSes);

  return NextResponse.json({ items: rows });
}

export async function PUT(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const no = url.searchParams.get('no') ?? '';
  const tur = url.searchParams.get('tur') ?? '';
  const surum = url.searchParams.get('surum') ?? '';

  if (!/^S\d+$/.test(no)) {
    return NextResponse.json({ error: 'Geçersiz soru numarası.' }, { status: 400 });
  }
  if (tur !== 'soru' && tur !== 'cevap') {
    return NextResponse.json({ error: 'Geçersiz ses türü.' }, { status: 400 });
  }
  if (!/^[0-9a-f]{16}$/.test(surum)) {
    return NextResponse.json({ error: 'Geçersiz sürüm formatı.' }, { status: 400 });
  }

  const arrayBuffer = await req.arrayBuffer();
  if (!arrayBuffer || arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > 4_000_000) {
    return NextResponse.json({ error: 'Gövde boş olamaz ve 4 MB sınırını aşamaz.' }, { status: 400 });
  }

  const veri = Buffer.from(arrayBuffer);
  const db = getDb();

  await db
    .insert(schema.klasikSes)
    .values({
      soruNo: no,
      tur,
      surum,
      veri,
      guncellemeZamani: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.klasikSes.soruNo, schema.klasikSes.tur],
      set: {
        surum,
        veri,
        guncellemeZamani: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const no = url.searchParams.get('no') ?? '';
  const tur = url.searchParams.get('tur') ?? '';

  if (!/^S\d+$/.test(no) || (tur !== 'soru' && tur !== 'cevap')) {
    return NextResponse.json({ error: 'Geçersiz parametreler.' }, { status: 400 });
  }

  const db = getDb();
  await db
    .delete(schema.klasikSes)
    .where(and(eq(schema.klasikSes.soruNo, no), eq(schema.klasikSes.tur, tur)));

  return NextResponse.json({ ok: true });
}
