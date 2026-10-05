import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { parseKlasikSync } from '@/lib/klasik-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function checkAuth(req: Request) {
  const token = process.env.FLAGS_EXPORT_TOKEN;
  if (!token) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${token}`;
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sourceText = await req.text();
  let payload: ReturnType<typeof parseKlasikSync>;
  try {
    payload = parseKlasikSync(sourceText);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const { version, questions } = payload;
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${schema.klasikSorular} IN SHARE ROW EXCLUSIVE MODE`);
    const currentQuestions = await tx.select({ version: schema.klasikSorular.version }).from(schema.klasikSorular);
    if (currentQuestions.length === questions.length && currentQuestions.every((row) => row.version === version)) {
      return;
    }

    await tx.delete(schema.klasikSorular);
    for (let offset = 0; offset < questions.length; offset += 250) {
      await tx.insert(schema.klasikSorular).values(questions.slice(offset, offset + 250));
    }
  });

  return NextResponse.json({ ok: true, version, questionCount: questions.length });
}
