import 'server-only';
import { cookies } from 'next/headers';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const COOKIE_NAME = 'uzy_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function hashToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

export function newProfileId() {
  return randomUUID();
}

// Basit cihaz-değiştirme PIN'i — gerçek parola değil, düşük riskli arkadaş grubu
// kullanımı için hafif bir kurtarma mekanizması. Yönetici sayfasında gösterilebilmesi
// gerektiğinden (kullanıcı unuttuğunda telefonla söyleyebilmek için) hash değil,
// PIN_ENCRYPTION_KEY ile AES-256-GCM şifrelenir — DB sızsa bile anahtar olmadan
// çözülemez, ama sunucu (ve dolayısıyla /admin) anahtarı bildiği için gösterebilir.
function pinKey() {
  const raw = process.env.PIN_ENCRYPTION_KEY;
  if (!raw) throw new Error('PIN_ENCRYPTION_KEY yapılandırılmamış.');
  return createHash('sha256').update(raw).digest(); // 32 bayt anahtar
}

export function encryptPin(pin: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', pinKey(), iv);
  const enc = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptPin(stored: string) {
  const buf = Buffer.from(stored, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', pinKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// index.html (GitHub Pages / Artifact) başka bir origin'den çağırdığı için çerez
// güvenilmez (üçüncü taraf çerez engelleme). Token hem çereze yazılır (aynı origin'den
// -admin gibi- test için) hem de çağırana JSON içinde döner; asıl istemci Authorization
// header'ıyla gönderir.
export async function createUserSession(userId: string) {
  const raw = randomBytes(32).toString('base64url');
  const db = getDb();
  await db.insert(schema.userSessions).values({ tokenHash: hashToken(raw), userId });
  const store = await cookies();
  store.set(COOKIE_NAME, raw, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return raw;
}

function bearerToken(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

export async function getSessionProfile(request: Request) {
  const store = await cookies();
  const raw = bearerToken(request) ?? store.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const tokenHash = hashToken(raw);
  const db = getDb();
  const [row] = await db.select({
    userId: schema.profiles.userId,
    username: schema.profiles.username,
    displayName: schema.profiles.displayName,
    isActive: schema.profiles.isActive,
    disclaimerAcceptedAt: schema.profiles.disclaimerAcceptedAt,
  }).from(schema.userSessions)
    .innerJoin(schema.profiles, eq(schema.userSessions.userId, schema.profiles.userId))
    .where(eq(schema.userSessions.tokenHash, tokenHash)).limit(1);
  if (!row) return null;

  await db.update(schema.userSessions).set({ lastSeenAt: new Date() })
    .where(eq(schema.userSessions.tokenHash, tokenHash));
  return row;
}

export async function clearUserSession() {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (raw) {
    const db = getDb();
    await db.delete(schema.userSessions).where(eq(schema.userSessions.tokenHash, hashToken(raw)));
  }
  store.delete(COOKIE_NAME);
}
