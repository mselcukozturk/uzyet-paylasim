import { desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';
import { getDb, schema } from '@/lib/db';
import { requestPasswordResetAction, signInAction, signOutAction } from '@/app/actions/auth';
import { approveUserAction, rejectUserAction } from '@/app/actions/admin';

async function currentAdmin() {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user?.id) return null;
  const db = getDb();
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).limit(1);
  return profile?.isAdmin ? profile : null;
}

export default async function AdminPage() {
  const admin = await currentAdmin();

  if (!admin) {
    async function submitSignIn(formData: FormData) {
      'use server';
      await signInAction(String(formData.get('identifier') ?? ''), String(formData.get('password') ?? ''));
    }

    async function submitResetRequest(formData: FormData) {
      'use server';
      await requestPasswordResetAction(String(formData.get('identifier') ?? ''));
    }

    return (
      <main style={{ maxWidth: 360, margin: '4rem auto', fontFamily: 'sans-serif' }}>
        <h1>Yönetici girişi</h1>
        <form action={submitSignIn} style={{ display: 'grid', gap: '0.5rem' }}>
          <input name="identifier" placeholder="E-posta" required />
          <input name="password" type="password" placeholder="Parola" required />
          <button type="submit">Giriş yap</button>
        </form>
        <form action={submitResetRequest} style={{ display: 'grid', gap: '0.5rem', marginTop: '1.5rem' }}>
          <p>Parolan yoksa veya unuttuysan:</p>
          <input name="identifier" placeholder="E-posta" required />
          <button type="submit">Parola belirleme bağlantısı gönder</button>
        </form>
      </main>
    );
  }

  const db = getDb();
  const pending = await db.select({
    userId: schema.profiles.userId,
    username: schema.profiles.username,
    createdAt: schema.profiles.createdAt,
  }).from(schema.profiles).where(eq(schema.profiles.isActive, false)).orderBy(schema.profiles.createdAt);

  const active = await db.select({
    userId: schema.profiles.userId,
    username: schema.profiles.username,
    createdAt: schema.profiles.createdAt,
    isAdmin: schema.profiles.isAdmin,
  }).from(schema.profiles).where(eq(schema.profiles.isActive, true)).orderBy(desc(schema.profiles.createdAt));

  function formatTarih(d: Date) {
    return d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function submitSignOut() {
    'use server';
    await signOutAction();
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>Onay bekleyen kullanıcılar</h1>
        <form action={submitSignOut}>
          <button type="submit">Çıkış</button>
        </form>
      </div>
      {pending.length === 0 && <p>Bekleyen kullanıcı yok.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {pending.map((item) => {
          async function submitApprove() {
            'use server';
            await approveUserAction(item.userId);
          }
          async function submitReject() {
            'use server';
            await rejectUserAction(item.userId);
          }
          return (
            <li key={item.userId} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.5rem 0', borderBottom: '1px solid #ddd',
            }}>
              <span>{item.username}</span>
              <span style={{ display: 'flex', gap: '0.4rem' }}>
                <form action={submitApprove}>
                  <button type="submit">Onayla</button>
                </form>
                <form action={submitReject}>
                  <button type="submit">Reddet</button>
                </form>
              </span>
            </li>
          );
        })}
      </ul>

      <h2 style={{ marginTop: '2rem' }}>Kullanıcılar ({active.length})</h2>
      {active.length === 0 && <p>Henüz onaylı kullanıcı yok.</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={{ padding: '0.4rem 0' }}>İsim</th>
            <th style={{ padding: '0.4rem 0' }}>Kayıt tarihi</th>
          </tr>
        </thead>
        <tbody>
          {active.map((item) => (
            <tr key={item.userId} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '0.4rem 0' }}>{item.username}{item.isAdmin ? ' (yönetici)' : ''}</td>
              <td style={{ padding: '0.4rem 0', color: '#666' }}>{formatTarih(item.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
