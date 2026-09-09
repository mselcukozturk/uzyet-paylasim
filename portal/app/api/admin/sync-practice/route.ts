import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { parsePracticeSync } from '@/lib/practice-sync';

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
  let payload: ReturnType<typeof parsePracticeSync>;
  try {
    payload = parsePracticeSync(sourceText);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const { version, questions, checkpoints } = payload;
  await getDb().transaction(async (tx) => {
    // Serialize replacements, including the initial import when both tables are empty.
    await tx.execute(sql`LOCK TABLE ${schema.practiceQuestions}, ${schema.practiceCheckpoints} IN SHARE ROW EXCLUSIVE MODE`);
    const currentQuestions = await tx.select({ version: schema.practiceQuestions.version }).from(schema.practiceQuestions);
    const currentCheckpoints = await tx.select({ version: schema.practiceCheckpoints.version }).from(schema.practiceCheckpoints);
    if (currentQuestions.length === questions.length && currentCheckpoints.length === checkpoints.length
      && currentQuestions.every((row) => row.version === version)
      && currentCheckpoints.every((row) => row.version === version)) return;

    await tx.delete(schema.practiceQuestions);
    await tx.delete(schema.practiceCheckpoints);
    for (let offset = 0; offset < questions.length; offset += 250) {
      await tx.insert(schema.practiceQuestions).values(questions.slice(offset, offset + 250));
    }
    for (let offset = 0; offset < checkpoints.length; offset += 250) {
      await tx.insert(schema.practiceCheckpoints).values(checkpoints.slice(offset, offset + 250));
    }
  });
  return NextResponse.json({ ok: true, version, questionCount: questions.length, checkpointCount: checkpoints.length });
}
