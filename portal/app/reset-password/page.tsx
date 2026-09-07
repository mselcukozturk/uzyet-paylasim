import ResetPasswordForm from './reset-password-form';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  return <ResetPasswordForm token={params.token ?? null} tokenError={params.error ?? null} />;
}
