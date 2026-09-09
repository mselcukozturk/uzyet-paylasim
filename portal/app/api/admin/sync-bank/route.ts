import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { eq, ne, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Soru bankasını (web_quiz_bank.json'ın ham metni, body olarak) doğrudan HTTP üzerinden
// Neon'a aktarır — scripts/sync-question-bank.mjs ile birebir aynı dönüşüm/versiyonlama
// mantığı, ama DATABASE_URL hiçbir makinede/.env.local'da tutulmasın diye burada,
// zaten çalışan deploy ortamında çalışır. Yerel `.env.local` çekimi (Vercel'in Neon
// entegrasyonu bazen ham değeri değil iç referansı veriyor) tekrar tekrar başarısız
// olduğu için eklendi (9 Eyl 2026). Aynı token'ı flagged-questions ucuyla paylaşır —
// ayrı bir token yönetmek aynı sorunu tekrarlardı.
function checkAuth(req: Request) {
  const token = process.env.FLAGS_EXPORT_TOKEN;
  if (!token) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${token}`;
}

const LETTER_INDEX: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

type RawItem = {
  guid?: string; konu?: string; soru?: string;
  a?: string; b?: string; c?: string; d?: string;
  cevap_harf?: string; cevap_metni?: string;
  aciklama?: string; kaynak?: string; dogrulanmis?: string;
};

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sourceText = await req.text();
  let source: RawItem[];
  try {
    source = JSON.parse(sourceText);
  } catch {
    return NextResponse.json({ error: 'Geçersiz JSON.' }, { status: 400 });
  }
  if (!Array.isArray(source) || source.length === 0) {
    return NextResponse.json({ error: 'Soru bankası boş veya beklenen JSON dizisi değil.' }, { status: 400 });
  }

  const seen = new Set<string>();
  const questions: Array<{
    guid: string; topic: string; prompt: string; options: string[];
    correctIndex: number; explanation: string; source: string; verified: boolean;
  }> = [];

  for (let i = 0; i < source.length; i++) {
    const item = source[i];
    const guid = String(item.guid ?? '').trim();
    const rawOptions = [item.a, item.b, item.c, item.d].map((v) => String(v ?? '').trim());
    const letterIdx = LETTER_INDEX[String(item.cevap_harf ?? '').trim().toUpperCase()];
    const correctText = rawOptions[letterIdx] || String(item.cevap_metni ?? '').trim();
    const options = rawOptions.filter(Boolean);
    const correctIndex = options.indexOf(correctText);
    if (!guid || seen.has(guid)) return NextResponse.json({ error: `Eksik veya mükerrer GUID: satır ${i + 1}` }, { status: 400 });
    if (!String(item.konu ?? '').trim() || !String(item.soru ?? '').trim()) {
      return NextResponse.json({ error: `Eksik konu/soru: ${guid}` }, { status: 400 });
    }
    if (options.length < 2 || correctIndex < 0) {
      return NextResponse.json({ error: `Geçersiz cevap veya şıklar: ${guid}` }, { status: 400 });
    }
    seen.add(guid);
    questions.push({
      guid,
      topic: String(item.konu).trim(),
      prompt: String(item.soru).trim(),
      options,
      correctIndex,
      explanation: String(item.aciklama ?? '').trim(),
      source: String(item.kaynak ?? '').trim(),
      verified: String(item.dogrulanmis ?? '').trim().toLocaleLowerCase('tr-TR') === 'evet',
    });
  }

  const version = createHash('sha256').update(sourceText).digest('hex').slice(0, 16);
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    let [bank] = await tx.select().from(schema.questionBanks).where(eq(schema.questionBanks.version, version)).limit(1);
    if (!bank) {
      [bank] = await tx.insert(schema.questionBanks)
        .values({ version, questionCount: questions.length, isActive: false })
        .returning();
      for (let offset = 0; offset < questions.length; offset += 250) {
        const batch = questions.slice(offset, offset + 250).map((q) => ({
          bankId: bank.id,
          guid: q.guid,
          topic: q.topic,
          prompt: q.prompt,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          source: q.source,
          verified: q.verified,
        }));
        await tx.insert(schema.questions).values(batch);
      }
    }
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(schema.questions).where(eq(schema.questions.bankId, bank.id));
    if (count !== questions.length) {
      throw new Error(`Aktarım sayısı uyuşmuyor: ${count}/${questions.length}`);
    }
    await tx.update(schema.questionBanks).set({ isActive: false }).where(ne(schema.questionBanks.id, bank.id));
    await tx.update(schema.questionBanks).set({ isActive: true }).where(eq(schema.questionBanks.id, bank.id));
    return { version, questionCount: questions.length, bankId: bank.id };
  });

  return NextResponse.json({ ok: true, ...result });
}
