import { NextResponse } from 'next/server';
import { sql as drizzleSql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { MIGRATIONS } from '@/lib/db/migrations.generated';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Şema migration'larını (portal/drizzle/*.sql) HTTP üzerinden, zaten çalışan deploy
// ortamında uygular — scripts/migrate.mjs ile birebir aynı mantık ve aynı _migrations
// tablosu, ama DATABASE_URL hiçbir makinede/.env.local'da tutulmasın diye burada.
// Aynı gerekçeyle eklenen /api/admin/sync-bank ucunun kardeşi; token'ı da onunla
// ortaktır (FLAGS_EXPORT_TOKEN).
//
// Güvenlik: uç HİÇBİR ZAMAN gövdeden SQL almaz. Yalnız bu deploy'un içine build
// zamanında gömülmüş (yani git + Vercel deploy sürecinden geçmiş) migration'ları
// çalıştırabilir; uygulanmışlar atlanır. Token sızsa bile etki alanı "repodaki
// migration'ları tekrar dene" ile sınırlı kalır.
//
// SQL'ler runtime `fs` ile değil, build zamanında üretilen migrations.generated.ts
// modülünden gelir: dinamik fs yolu Turbopack'in izlemesinde statik çözülemediği için
// paketlenmeme riski taşıyordu ("Dynamic path in fs call" uyarısı).
function checkAuth(req: Request) {
  const token = process.env.FLAGS_EXPORT_TOKEN;
  if (!token) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${token}`;
}

async function appliedNames(db: ReturnType<typeof getDb>) {
  await db.execute(
    drizzleSql`create table if not exists _migrations (ad text primary key, uygulandi timestamptz not null default now())`,
  );
  const rows = await db.execute<{ ad: string }>(drizzleSql`select ad from _migrations`);
  return new Set(Array.from(rows as Iterable<{ ad: string }>).map((r) => r.ad));
}

// Durum: hiçbir şey yazmaz (yalnız _migrations tablosunu oluşturur), bekleyenleri listeler.
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const applied = await appliedNames(getDb());
  const bekleyen = MIGRATIONS.map((m) => m.name).filter((n) => !applied.has(n));
  return NextResponse.json({
    ok: true,
    toplam: MIGRATIONS.length,
    uygulanmis: MIGRATIONS.length - bekleyen.length,
    bekleyen,
  });
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getDb();
  const applied = await appliedNames(db);
  const uygulandi: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    try {
      // scripts/migrate.mjs ile aynı: her dosya tek transaction, drizzle-kit'in
      // ürettiği "--> statement-breakpoint" ayracına göre bölünür.
      await db.transaction(async (tx) => {
        for (const statement of migration.content.split('--> statement-breakpoint')) {
          if (statement.trim()) await tx.execute(drizzleSql.raw(statement));
        }
        await tx.execute(drizzleSql`insert into _migrations (ad) values (${migration.name})`);
      });
    } catch (err) {
      // Sıralı migration'da bir dosya başarısızsa sonrakiler geçersiz varsayımla
      // çalışacağı için kalanlar denenmez.
      return NextResponse.json(
        {
          error: `Migration başarısız: ${migration.name}`,
          detay: err instanceof Error ? err.message : String(err),
          uygulandi,
        },
        { status: 500 },
      );
    }
    uygulandi.push(migration.name);
  }

  return NextResponse.json({
    ok: true,
    uygulandi,
    mesaj: uygulandi.length ? `${uygulandi.length} migration uygulandı.` : 'Veritabanı şeması güncel.',
  });
}
