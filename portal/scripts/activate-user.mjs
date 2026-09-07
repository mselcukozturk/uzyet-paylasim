import postgres from 'postgres';

const email = process.argv[2]?.trim().toLocaleLowerCase('tr-TR');
const username = process.argv[3]?.trim().toLocaleLowerCase('tr-TR');
const isAdmin = process.argv.includes('--admin');
if (!email?.includes('@') || !username || !/^[a-z0-9._-]{3,40}$/.test(username)) {
  throw new Error('Kullanım: npm run user:activate -- eposta@example.com kullaniciadi [--admin]');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL gerekli.');

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const [user] = await sql`
    select id::text as id, email, name
    from neon_auth."user"
    where lower(email) = ${email}
    limit 1
  `;
  if (!user) throw new Error('Neon Auth kullanıcısı bulunamadı. Önce kullanıcıyı Neon Auth üzerinden oluşturun.');
  await sql`
    insert into profiles (user_id, email, username, display_name, is_active, is_admin)
    values (${user.id}, ${email}, ${username}, ${user.name || username}, true, ${isAdmin})
    on conflict (user_id) do update set
      email = excluded.email,
      username = excluded.username,
      display_name = excluded.display_name,
      is_active = true,
      is_admin = excluded.is_admin,
      updated_at = now()
  `;
  console.log(`Kullanıcı etkinleştirildi: ${username}${isAdmin ? ' (yönetici)' : ''}`);
} finally {
  await sql.end();
}
