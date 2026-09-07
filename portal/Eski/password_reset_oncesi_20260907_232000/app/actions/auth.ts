'use server';

import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';
import { getDb, schema } from '@/lib/db';

export async function signInAction(identifier: string, password: string) {
  const normalized = identifier.trim().toLocaleLowerCase('tr-TR');
  if (!normalized || !password) return { ok: false, message: 'E-posta veya kullanıcı adı ile parola gerekli.' };

  let email = normalized;
  if (!normalized.includes('@')) {
    const db = getDb();
    const [profile] = await db.select({ email: schema.profiles.email }).from(schema.profiles)
      .where(eq(schema.profiles.username, normalized)).limit(1);
    if (!profile) return { ok: false, message: 'Giriş bilgileri doğrulanamadı.' };
    email = profile.email;
  }

  const result = await auth.signIn.email({ email, password });
  if (result.error) return { ok: false, message: 'Giriş bilgileri doğrulanamadı.' };
  return { ok: true };
}

export async function signOutAction() {
  await auth.signOut();
  return { ok: true };
}

