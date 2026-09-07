import 'server-only';
import { cookies } from 'next/headers';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
}

export async function getSessionProfile() {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const tokenHash = hashToken(raw);
  const db = getDb();
  const [row] = await db.select({
    userId: schema.profiles.userId,
    username: schema.profiles.username,
    displayName: schema.profiles.displayName,
    isActive: schema.profiles.isActive,
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
