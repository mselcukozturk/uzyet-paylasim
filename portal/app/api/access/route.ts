import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { createUserSession, getSessionProfile, hashPin, newProfileId } from '@/lib/auth/session';
import { corsPreflight, withCors } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;
const PIN_PATTERN = /^\d{4}$/;

function fail(message: string, status: number) {
  return withCors(NextResponse.json({ error: message }, { status }));
}

function statusPayload(profile: { username: string; isActive: boolean; disclaimerAcceptedAt: Date | null }, token?: string) {
  return {
    authenticated: true,
    username: profile.username,
    isActive: profile.isActive,
    disclaimerAccepted: !!profile.disclaimerAcceptedAt,
    ...(token ? { token } : {}),
  };
}

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  const profile = await getSessionProfile(request);
  if (!profile) return withCors(NextResponse.json({ authenticated: false }));
  return withCors(NextResponse.json(statusPayload(profile)));
}

export async function POST(request: Request) {
  const existing = await getSessionProfile(request);
  const body = await request.json().catch(() => null) as
    { username?: string; pin?: string; acceptDisclaimer?: boolean } | null;

  if (existing) {
    if (body?.acceptDisclaimer) {
      const db = getDb();
      await db.update(schema.profiles).set({ disclaimerAcceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.profiles.userId, existing.userId));
      return withCors(NextResponse.json(statusPayload({ ...existing, disclaimerAcceptedAt: new Date() })));
    }
    return withCors(NextResponse.json(statusPayload(existing)));
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
    disclaimerAcceptedAt: schema.profiles.disclaimerAcceptedAt,
    pinHash: schema.profiles.pinHash,
  }).from(schema.profiles).where(sql`lower(${schema.profiles.username}) = ${username}`).limit(1);

  if (found) {
    // Aynı isim var — başka cihazdan giriş denemesi. PIN doğrulanırsa bu cihaza
    // yeni bir oturum tokenı verilir; hesap/ilerleme aynı kalır.
    if (!found.pinHash) {
      // PIN özelliğinden önce oluşmuş hesap: girilen PIN artık bu hesabın PIN'i
      // olarak kaydedilir (bir daha bu dala düşmez) — kimseyi kilitli bırakmaz.
      const db2 = getDb();
      await db2.update(schema.profiles).set({ pinHash: hashPin(pin, found.userId), updatedAt: new Date() })
        .where(eq(schema.profiles.userId, found.userId));
    } else if (hashPin(pin, found.userId) !== found.pinHash) {
      return fail('İsim veya PIN hatalı.', 401);
    }
    const token = await createUserSession(found.userId);
    return withCors(NextResponse.json(statusPayload(found, token)));
  }

  const userId = newProfileId();
  await db.insert(schema.profiles).values({ userId, username, isActive: false, pinHash: hashPin(pin, userId) });
  const token = await createUserSession(userId);
  return withCors(NextResponse.json(statusPayload({ username, isActive: false, disclaimerAcceptedAt: null }, token)));
}
