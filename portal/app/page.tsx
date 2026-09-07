import ExamPortal from './exam-portal';
import { auth } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const configured = Boolean(process.env.DATABASE_URL && process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);
  if (!configured) return <ExamPortal demoMode initialIdentity={null} />;
  const { data: session } = await auth.getSession();
  return <ExamPortal demoMode={false} initialIdentity={session?.user?.email ?? null} />;
}
