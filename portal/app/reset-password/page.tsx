import { redirect } from 'next/navigation';
import { resetPasswordAction } from '@/app/actions/auth';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;

  async function submit(formData: FormData) {
    'use server';
    const password = String(formData.get('password') ?? '');
    const result = await resetPasswordAction(token, password);
    if (result.ok) redirect('/admin');
  }

  return (
    <main style={{ maxWidth: 360, margin: '4rem auto', fontFamily: 'sans-serif' }}>
      <h1>Yeni parola belirle</h1>
      {!token && <p>Bağlantı geçersiz; e-postandaki bağlantıyı kullan.</p>}
      <form action={submit} style={{ display: 'grid', gap: '0.5rem' }}>
        <input name="password" type="password" placeholder="Yeni parola (8-128 karakter)" required minLength={8} maxLength={128} />
        <button type="submit" disabled={!token}>Kaydet</button>
      </form>
    </main>
  );
}
