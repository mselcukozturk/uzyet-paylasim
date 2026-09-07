'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';
import { resetPasswordAction } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PortalShell, StatusNotice } from '@/components/portal/shared';

export default function ResetPasswordForm({ token, tokenError }: { token: string | null; tokenError: string | null }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(tokenError ? 'Şifre bağlantısı geçersiz veya süresi dolmuş.' : null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!token) return setError('Şifre bağlantısı geçersiz veya süresi dolmuş.');
    if (password !== confirmation) return setError('Parolalar eşleşmiyor.');
    setBusy(true);
    try {
      const result = await resetPasswordAction(token, password);
      if (!result.ok) return setError(result.message ?? 'Parola değiştirilemedi.');
      setMessage('Parolan oluşturuldu. Artık hesabına giriş yapabilirsin.');
      setPassword('');
      setConfirmation('');
    } catch {
      setError('Parola şu anda değiştirilemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalShell>
      <div className="login-layout">
        <section className="login-intro">
          <div className="kicker">Güvenli hesap erişimi</div>
          <h1 className="mt-3 max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Yeni parolanı belirle.</h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">Parolan yalnızca hesabına giriş yapmak için kullanılır; sınav geçmişin ve sonuçların kullanıcı hesabında saklanır.</p>
        </section>

        <section className="surface-card login-card" aria-labelledby="reset-title">
          <div className="mb-6 flex size-11 items-center justify-center rounded-xl bg-primary/12 text-primary"><LockKeyhole aria-hidden="true" /></div>
          <h2 id="reset-title" className="text-xl font-semibold">Parola oluştur</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">En az 8 karakterlik yeni parolanı iki kez yaz.</p>
          {!message && (
            <form className="mt-6 space-y-4" onSubmit={submit}>
              <label className="form-field" htmlFor="new-password"><span>Yeni parola</span><Input id="new-password" className="h-11" type="password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="new-password" disabled={!token || Boolean(tokenError)} /></label>
              <label className="form-field" htmlFor="confirm-password"><span>Yeni parola tekrar</span><Input id="confirm-password" className="h-11" type="password" minLength={8} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required autoComplete="new-password" disabled={!token || Boolean(tokenError)} /></label>
              <Button className="h-11 w-full" type="submit" disabled={busy || !token || Boolean(tokenError)}>{busy ? 'Kaydediliyor…' : 'Parolayı kaydet'}</Button>
            </form>
          )}
          {message && <StatusNotice tone="success">{message}</StatusNotice>}
          {error && <StatusNotice tone="error">{error}</StatusNotice>}
          <Button className="mt-4 w-full" variant="ghost" render={<Link href="/" />}>Giriş ekranına dön</Button>
        </section>
      </div>
    </PortalShell>
  );
}
