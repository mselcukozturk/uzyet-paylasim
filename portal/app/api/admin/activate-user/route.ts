import { NextResponse } from 'next/server';
import { sql as drizzleSql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// scripts/activate-user.mjs'in HTTP karşılığı: tek yönetici hesabını (Neon Auth
// e-posta/parola) kurar. Sıradan kullanıcılar bu uçtan geçmez — onlar kendi kullanıcı
// adını /api/access ile ister, onayı yönetici /admin sayfasından verir.
//
// VARSAYILAN OLARAK KAPALIDIR. Diğer admin uçlarından farklı olarak FLAGS_EXPORT_TOKEN'ı
// KULLANMAZ; ayrı bir ADMIN_SETUP_TOKEN ister ve o ortam değişkeni tanımlı değilse uç
// hiç yokmuş gibi 404 döner. Gerekçe: bu uç `is_admin` verebiliyor, yani günlük işlerde
// kullanılan paylaşık token'a yetki yükseltme gücü kazandırmak istemedik. Kullanım:
// Vercel'de ADMIN_SETUP_TOKEN'ı geçici olarak tanımla → uca istek at → değişkeni sil.
function auth(req: Request) {
  const token = process.env.ADMIN_SETUP_TOKEN;
  if (!token) return 'disabled' as const;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${token}` ? ('ok' as const) : ('unauthorized' as const);
}

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

export async function POST(req: Request) {
  const state = auth(req);
  if (state === 'disabled') {
    return NextResponse.json(
      { error: 'Bu uç kapalı. Kurulum için ADMIN_SETUP_TOKEN ortam değişkenini geçici olarak tanımlayın.' },
      { status: 404 },
    );
  }
  if (state === 'unauthorized') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { email?: unknown; username?: unknown; admin?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz JSON.' }, { status: 400 });
  }

  // Betikle birebir aynı normalizasyon ve doğrulama (tr-TR küçültme dahil: "I" → "ı").
  const email = String(body.email ?? '').trim().toLocaleLowerCase('tr-TR');
  const username = String(body.username ?? '').trim().toLocaleLowerCase('tr-TR');
  const isAdmin = body.admin === true;
  if (!email.includes('@') || !USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: 'Geçersiz alan. Beklenen: {"email":"...@...","username":"a-z0-9._- 3-40","admin":true|false}' },
      { status: 400 },
    );
  }

  const db = getDb();
  const found = await db.execute<{ id: string; name: string | null }>(
    drizzleSql`select id::text as id, name from neon_auth."user" where lower(email) = ${email} limit 1`,
  );
  const user = Array.from(found as Iterable<{ id: string; name: string | null }>)[0];
  if (!user) {
    return NextResponse.json(
      { error: 'Neon Auth kullanıcısı bulunamadı. Önce kullanıcıyı Neon Auth üzerinden oluşturun.' },
      { status: 404 },
    );
  }

  await db.execute(drizzleSql`
    insert into profiles (user_id, email, username, display_name, is_active, is_admin)
    values (${user.id}, ${email}, ${username}, ${user.name || username}, true, ${isAdmin})
    on conflict (user_id) do update set
      email = excluded.email,
      username = excluded.username,
      display_name = excluded.display_name,
      is_active = true,
      is_admin = excluded.is_admin,
      updated_at = now()
  `);

  return NextResponse.json({
    ok: true,
    username,
    isAdmin,
    mesaj: `Kullanıcı etkinleştirildi: ${username}${isAdmin ? ' (yönetici)' : ''}`,
  });
}
