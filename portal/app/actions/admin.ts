'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';
import { getDb, schema } from '@/lib/db';

async function requireAdmin() {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user?.id) return null;
  const db = getDb();
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).limit(1);
  return profile?.isAdmin ? profile : null;
}

export async function approveUserAction(userId: string) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: 'Yönetici girişi gerekli.' };
  const db = getDb();
  await db.update(schema.profiles).set({ isActive: true, updatedAt: new Date() })
    .where(eq(schema.profiles.userId, userId));
  revalidatePath('/admin');
  return { ok: true };
}

export async function rejectUserAction(userId: string) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: 'Yönetici girişi gerekli.' };
  const db = getDb();
  await db.delete(schema.profiles).where(eq(schema.profiles.userId, userId));
  revalidatePath('/admin');
  return { ok: true };
}
