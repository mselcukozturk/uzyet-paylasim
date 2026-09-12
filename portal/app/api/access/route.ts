import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { createUserSession, decryptPin, encryptPin, getSessionProfile, newProfileId } from '@/lib/auth/session';
import { corsPreflight, withCors } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;
const PIN_PATTERN = /^\d{4}$/;

function fail(message: string, status: number) {
  return withCors(NextResponse.json({ error: message }, { status }));
}

function statusPayload(profile: {
  username: string; isActive: boolean; isAdmin?: boolean; canSeeAiSources: boolean;
  disclaimerAcceptedAt: Date | null; aiDisclaimerAcceptedAt?: Date | null;
}, token?: string) {
  return {
    authenticated: true,
    username: profile.username,
    isActive: profile.isActive,
    isAdmin: !!profile.isAdmin,
    canSeeAiSources: profile.canSeeAiSources,
    disclaimerAccepted: !!profile.disclaimerAcceptedAt,
    aiDisclaimerAccepted: !!profile.aiDisclaimerAcceptedAt,
    ...(token ? { token } : {}),
  };
}

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  const profile = await getSessionProfile(request);
  if (!profile) return withCors(NextResponse.json({ authenticated: false }));
  return withCors(NextResponse.json(statusPayload(profile, profile.token)));
}

export async function POST(request: Request) {
  const existing = await getSessionProfile(request);
  const body = await request.json().catch(() => null) as
    { username?: string; pin?: string; acceptDisclaimer?: boolean; acceptAiDisclaimer?: boolean } | null;

  if (existing) {
    if (body?.acceptDisclaimer) {
      const db = getDb();
      await db.update(schema.profiles).set({ disclaimerAcceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.profiles.userId, existing.userId));
      return withCors(NextResponse.json(statusPayload({ ...existing, disclaimerAcceptedAt: new Date() }, existing.token)));
    }
    if (body?.acceptAiDisclaimer) {
      const db = getDb();
      await db.update(schema.profiles).set({ aiDisclaimerAcceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.profiles.userId, existing.userId));
      return withCors(NextResponse.json(statusPayload({ ...existing, aiDisclaimerAcceptedAt: new Date() }, existing.token)));
    }
    return withCors(NextResponse.json(statusPayload(existing, existing.token)));
  }

  const username = body?.username?.trim().toLocaleLowerCase('tr-TR') ?? '';
  const pin = (body?.pin ?? '').trim();
  if (!USERNAME_PATTERN.test(username)) {
    return fail('Kullanıcı adı 3-40 karakter olmalı; yalnız küçük harf, rakam, nokta, tire ve alt çizgi.', 400);
  }
  if (!PIN_PATTERN.test(pin)) return fail('PIN 4 haneli rakam olmalı.', 400);

  const db = getDb();
  const [found] = await db.select({
    userId: schema.profiles.userId,
    username: schema.profiles.username,
    isActive: schema.profiles.isActive,
    isAdmin: schema.profiles.isAdmin,
    canSeeAiSources: schema.profiles.canSeeAiSources,
    disclaimerAcceptedAt: schema.profiles.disclaimerAcceptedAt,
    aiDisclaimerAcceptedAt: schema.profiles.aiDisclaimerAcceptedAt,
    pinEncrypted: schema.profiles.pinEncrypted,
  }).from(schema.profiles).where(sql`lower(${schema.profiles.username}) = ${username}`).limit(1);

  if (found) {
    // Aynı isim var — başka cihazdan giriş denemesi. PIN doğrulanırsa bu cihaza
    // yeni bir oturum tokenı verilir; hesap/ilerleme aynı kalır.
    let storedPin: string | null = null;
    if (found.pinEncrypted) {
      try { storedPin = decryptPin(found.pinEncrypted); } catch { storedPin = null; }
    }
    if (!storedPin) {
      // PIN özelliğinden önce oluşmuş (veya çözülemeyen) hesap: girilen PIN artık bu
      // hesabın PIN'i olarak kaydedilir — kimseyi kilitli bırakmaz.
      await db.update(schema.profiles).set({ pinEncrypted: encryptPin(pin), updatedAt: new Date() })
        .where(eq(schema.profiles.userId, found.userId));
    } else if (storedPin !== pin) {
      return fail('İsim veya PIN hatalı.', 401);
    }
    const token = await createUserSession(found.userId);
    return withCors(NextResponse.json(statusPayload(found, token)));
  }

  const userId = newProfileId();
  await db.insert(schema.profiles).values({ userId, username, isActive: false, pinEncrypted: encryptPin(pin) });
  const token = await createUserSession(userId);
  return withCors(NextResponse.json(statusPayload({ username, isActive: false, canSeeAiSources: false, disclaimerAcceptedAt: null }, token)));
}
