'use server';

import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';
import { getDb, schema } from '@/lib/db';

async function resolveEmail(identifier: string) {
  const normalized = identifier.trim().toLocaleLowerCase('tr-TR');
  if (!normalized) return null;
  if (normalized.includes('@')) return normalized;

  const db = getDb();
  const [profile] = await db.select({ email: schema.profiles.email }).from(schema.profiles)
    .where(eq(schema.profiles.username, normalized)).limit(1);
  return profile?.email ?? null;
}

function applicationBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/$/, '')}`;
  return 'http://localhost:3000';
}

export async function signInAction(identifier: string, password: string) {
  if (!identifier.trim() || !password) return { ok: false, message: 'E-posta veya kullanıcı adı ile parola gerekli.' };

  const email = await resolveEmail(identifier);
  if (!email) return { ok: false, message: 'Giriş bilgileri doğrulanamadı.' };

  const result = await auth.signIn.email({ email, password });
  if (result.error) return { ok: false, message: 'Giriş bilgileri doğrulanamadı.' };
  return { ok: true };
}

export async function requestPasswordResetAction(identifier: string) {
  const email = await resolveEmail(identifier);
  if (!email) return { ok: true };

  const result = await auth.requestPasswordReset({
    email,
    redirectTo: `${applicationBaseUrl()}/reset-password`,
  });
  if (result.error) return { ok: false, message: 'Şifre bağlantısı şu anda gönderilemedi.' };
  return { ok: true };
}

export async function resetPasswordAction(token: string, password: string) {
  if (!token) return { ok: false, message: 'Şifre bağlantısı geçersiz veya süresi dolmuş.' };
  if (password.length < 8 || password.length > 128) {
    return { ok: false, message: 'Parola 8–128 karakter arasında olmalı.' };
  }

  const result = await auth.resetPassword({ newPassword: password, token });
  if (result.error) return { ok: false, message: 'Şifre bağlantısı geçersiz veya süresi dolmuş.' };
  return { ok: true };
}

export async function signOutAction() {
  await auth.signOut();
  return { ok: true };
}
