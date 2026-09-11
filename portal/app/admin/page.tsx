import { desc, eq, max } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';
import { decryptPin } from '@/lib/auth/session';
import { getDb, schema } from '@/lib/db';
import { requestPasswordResetAction, signInAction, signOutAction } from '@/app/actions/auth';
import { approveUserAction, deleteUserAction, rejectUserAction, toggleAiAccessAction } from '@/app/actions/admin';
import KullaniciSilFormu from './kullanici-sil-formu';

// index.html ile aynı görsel dil (renk tokenları, fontlar) — orada <style id="app-style"> içinde
// tanımlı, burada admin sayfası için gerekenler tekrarlanıyor (ayrı bir root layout yok).
const ADMIN_STYLES = `
  :root {
    --bg: #f6f3ec; --surface: #ffffff; --surface-2: #eeeadf; --border: #ddd6c4;
    --text: #23262d; --text-muted: #62636c; --accent: #2b3a67; --accent-strong: #1f2a4a; --accent-contrast: #ffffff;
    --good: #2f7a4f; --good-bg: #e4f2e9; --bad: #b3423a; --bad-bg: #f7e6e4;
    --shadow: 0 1px 2px rgba(30, 30, 20, 0.06), 0 4px 14px rgba(30, 30, 20, 0.06);
    --font-display: "Source Serif 4", Georgia, serif; --font-body: "Public Sans", -apple-system, "Segoe UI", Roboto, sans-serif;
    --radius: 10px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161c; --surface: #1b1e26; --surface-2: #232733; --border: #343947;
      --text: #e9e7de; --text-muted: #9a9dac; --accent: #8493c9; --accent-strong: #a9b5dd; --accent-contrast: #12141b;
      --good: #6cc492; --good-bg: #1c3327; --bad: #e18077; --bad-bg: #3a231f;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.35);
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  button, input, select { color: inherit; font: inherit; }
  body { background: var(--bg); color: var(--text); font-family: var(--font-body); line-height: 1.5; -webkit-font-smoothing: antialiased; }
  .shell { max-width: 880px; margin: 0 auto; padding: 28px 20px 64px; }
  .shell.narrow { max-width: 400px; }
  .kicker { font-weight: 700; font-size: 0.72rem; letter-spacing: 0.09em; text-transform: uppercase; color: var(--accent); margin-bottom: 5px; }
  .hero-band { background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%); border-radius: var(--radius); padding: 24px 26px; margin-bottom: 22px; box-shadow: var(--shadow); }
  .hero-band .kicker { color: var(--accent-contrast); opacity: 0.72; }
  .masthead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .masthead h1 { font-family: var(--font-display); font-weight: 700; font-size: 1.85rem; margin: 0; color: var(--accent-contrast); }
  .masthead .sub { color: var(--accent-contrast); opacity: 0.82; font-size: 0.92rem; margin-top: 4px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px; margin-bottom: 22px; }
  .section-title { font-family: var(--font-display); font-weight: 700; font-size: 1.15rem; margin: 0 0 12px; }
  .muted { color: var(--text-muted); }
  .field { width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-family: var(--font-body); font-size: 0.94rem; }
  .btn { font-family: var(--font-body); font-weight: 600; font-size: 0.88rem; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
  .btn:hover { border-color: var(--accent); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
  .btn.primary:hover { background: var(--accent-strong); border-color: var(--accent-strong); }
  .btn.danger { color: var(--bad); border-color: var(--bad); background: var(--bad-bg); }
  .btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border); gap: 10px; flex-wrap: wrap; }
  .row:last-child { border-bottom: none; }
  .badge { display: inline-block; font-size: 0.72rem; font-weight: 600; padding: 2px 7px; border-radius: 5px; margin-left: 6px; vertical-align: middle; background: var(--surface-2); color: var(--accent-strong); }
  table.uzy-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  table.uzy-table th, table.uzy-table td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  table.uzy-table th { color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; }
`;

const FONT_LINKS = (
  <>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
    <link
      href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,700&family=Public+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </>
);

const ISTANBUL_TZ = 'Europe/Istanbul';

function formatTarih(d: Date | null) {
  if (!d) return '—';
  return d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short', timeZone: ISTANBUL_TZ });
}

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
      <main className="shell narrow">
        <style>{ADMIN_STYLES}</style>
        {FONT_LINKS}
        <div className="hero-band">
          <div className="kicker">UZYET</div>
          <div className="masthead"><h1>Yönetici girişi</h1></div>
        </div>
        <div className="card">
          <form action={submitSignIn} style={{ display: 'grid', gap: '10px' }}>
            <input className="field" name="identifier" placeholder="E-posta" required />
            <input className="field" name="password" type="password" placeholder="Parola" required />
            <button className="btn primary" type="submit">Giriş yap</button>
          </form>
        </div>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>Parolan yoksa veya unuttuysan:</p>
          <form action={submitResetRequest} style={{ display: 'grid', gap: '10px' }}>
            <input className="field" name="identifier" placeholder="E-posta" required />
            <button className="btn" type="submit">Parola belirleme bağlantısı gönder</button>
          </form>
        </div>
      </main>
    );
  }

  const db = getDb();
  const pending = await db.select({
    userId: schema.profiles.userId,
    username: schema.profiles.username,
    createdAt: schema.profiles.createdAt,
  }).from(schema.profiles).where(eq(schema.profiles.isActive, false)).orderBy(schema.profiles.createdAt);

  const activeRows = await db.select({
    userId: schema.profiles.userId,
    username: schema.profiles.username,
    createdAt: schema.profiles.createdAt,
    isAdmin: schema.profiles.isAdmin,
    canSeeAiSources: schema.profiles.canSeeAiSources,
    pinEncrypted: schema.profiles.pinEncrypted,
  }).from(schema.profiles).where(eq(schema.profiles.isActive, true)).orderBy(desc(schema.profiles.createdAt));

  const lastLoginRows = await db.select({
    userId: schema.userSessions.userId,
    lastSeenAt: max(schema.userSessions.lastSeenAt),
  }).from(schema.userSessions).groupBy(schema.userSessions.userId);
  const lastLoginByUser = new Map(lastLoginRows.map((r) => [r.userId, r.lastSeenAt]));

  const active = activeRows.map((item) => {
    let pin: string | null = null;
    if (item.pinEncrypted) { try { pin = decryptPin(item.pinEncrypted); } catch { pin = null; } }
    return { ...item, pin, lastLoginAt: lastLoginByUser.get(item.userId) ?? null };
  });

  async function submitSignOut() {
    'use server';
    await signOutAction();
  }

  return (
    <main className="shell">
      <style>{ADMIN_STYLES}</style>
      {FONT_LINKS}
      <div className="hero-band">
        <div className="kicker">UZYET</div>
        <div className="masthead">
          <h1>Yönetim paneli</h1>
          <form action={submitSignOut}>
            <button className="btn" type="submit">Çıkış</button>
          </form>
        </div>
        <div className="sub">Onay bekleyen ve aktif kullanıcılar</div>
      </div>

      <div className="card">
        <h2 className="section-title">Onay bekleyen kullanıcılar</h2>
        {pending.length === 0 && <p className="muted">Bekleyen kullanıcı yok.</p>}
        {pending.map((item) => {
          async function submitApprove() {
            'use server';
            await approveUserAction(item.userId);
          }
          async function submitReject() {
            'use server';
            await rejectUserAction(item.userId);
          }
          async function submitDelete() {
            'use server';
            await deleteUserAction(item.userId);
          }
          return (
            <div key={item.userId} className="row">
              <span>{item.username}</span>
              <span style={{ display: 'flex', gap: '8px' }}>
                <form action={submitApprove}><button className="btn primary" type="submit">Onayla</button></form>
                <form action={submitReject}><button className="btn" type="submit">Reddet</button></form>
                {item.userId !== admin.userId && <KullaniciSilFormu action={submitDelete} kullaniciAdi={item.username} />}
              </span>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2 className="section-title">Kullanıcılar ({active.length})</h2>
        {active.length === 0 && <p className="muted">Henüz onaylı kullanıcı yok.</p>}
        {active.length > 0 && (
          <table className="uzy-table">
            <thead>
              <tr>
                <th>İsim</th>
                <th>Son giriş</th>
                <th>PIN</th>
                <th>Kayıt tarihi</th>
                <th>AI kaynakları</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {active.map((item) => {
                async function submitDelete() {
                  'use server';
                  await deleteUserAction(item.userId);
                }
                async function submitToggleAi() {
                  'use server';
                  await toggleAiAccessAction(item.userId, !item.canSeeAiSources);
                }
                return (
                  <tr key={item.userId}>
                    <td>{item.username}{item.isAdmin && <span className="badge">yönetici</span>}</td>
                    <td className="muted">{formatTarih(item.lastLoginAt)}</td>
                    <td>
                      {item.pin ? (
                        <details>
                          <summary style={{ cursor: 'pointer', display: 'inline' }}>Göster</summary>
                          <span style={{ fontFamily: 'monospace', marginLeft: '0.5rem' }}>{item.pin}</span>
                        </details>
                      ) : '—'}
                    </td>
                    <td className="muted">{formatTarih(item.createdAt)}</td>
                    <td>
                      <form action={submitToggleAi}>
                        <button
                          className="btn"
                          type="submit"
                          style={item.canSeeAiSources ? { borderColor: 'var(--good)', color: 'var(--good)' } : undefined}
                        >
                          {item.canSeeAiSources ? 'Açık — kapat' : 'Kapalı — aç'}
                        </button>
                      </form>
                    </td>
                    <td>
                      {item.userId !== admin.userId && <KullaniciSilFormu action={submitDelete} kullaniciAdi={item.username} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
