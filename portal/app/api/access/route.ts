import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { createUserSession, getSessionProfile, newProfileId } from '@/lib/auth/session';
import { corsPreflight, withCors } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;

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
  const body = await request.json().catch(() => null) as { username?: string; acceptDisclaimer?: boolean } | null;

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
  if (!USERNAME_PATTERN.test(username)) {
    return fail('Kullanıcı adı 3-40 karakter olmalı; yalnız küçük harf, rakam, nokta, tire ve alt çizgi.', 400);
  }

  const db = getDb();
  const [taken] = await db.select({ userId: schema.profiles.userId }).from(schema.profiles)
    .where(sql`lower(${schema.profiles.username}) = ${username}`).limit(1);
  if (taken) return fail('Bu kullanıcı adı alınmış.', 409);

  const userId = newProfileId();
  await db.insert(schema.profiles).values({ userId, username, isActive: false });
  const token = await createUserSession(userId);
  return withCors(NextResponse.json(statusPayload({ username, isActive: false, disclaimerAcceptedAt: null }, token)));
}
