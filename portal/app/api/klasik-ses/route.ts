import { NextResponse } from 'next/server';
import { and, eq, notLike } from 'drizzle-orm';
import { getSessionProfile } from '@/lib/auth/session';
import { withCors, corsPreflight } from '@/lib/cors';
import { getDb, schema } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  const profile = await getSessionProfile(req);
  if (!profile) return withCors(NextResponse.json({ error: 'Giriş gerekli.' }, { status: 401 }));
  if (!profile.isActive) return withCors(NextResponse.json({ error: 'Bu hesabın erişimi kapalı; onay bekleniyor.' }, { status: 403 }));

  const url = new URL(req.url);
  const no = url.searchParams.get('no') ?? '';
  const tur = url.searchParams.get('tur') ?? '';

  if (!/^S\d+$/.test(no) || (tur !== 'soru' && tur !== 'cevap')) {
    return withCors(NextResponse.json({ error: 'Geçersiz parametreler.' }, { status: 400 }));
  }

  const db = getDb();
  const [record] = await db
    .select({ veri: schema.klasikSes.veri })
    .from(schema.klasikSes)
    .where(and(eq(schema.klasikSes.soruNo, no), eq(schema.klasikSes.tur, tur), notLike(schema.klasikSes.surum, 'yukleniyor:%')))
    .limit(1);

  if (!record) {
    return withCors(NextResponse.json({ error: 'Ses kaydı bulunamadı.' }, { status: 404 }));
  }

  let konum = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (konum >= record.veri.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(record.veri.subarray(konum, konum + 64_000)));
      konum += 64_000;
    },
  });
  return withCors(
    new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    })
  );
}
