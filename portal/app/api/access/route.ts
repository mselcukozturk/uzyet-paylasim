import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { createUserSession, getSessionProfile, newProfileId } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ authenticated: false });
  return NextResponse.json({ authenticated: true, username: profile.username, isActive: profile.isActive });
}

export async function POST(request: Request) {
  const existing = await getSessionProfile();
  if (existing) {
    return NextResponse.json({ authenticated: true, username: existing.username, isActive: existing.isActive });
  }

  const body = await request.json().catch(() => null) as { username?: string } | null;
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
  await createUserSession(userId);
  return NextResponse.json({ authenticated: true, username, isActive: false });
}
