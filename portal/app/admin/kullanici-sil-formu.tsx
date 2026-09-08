'use client';

import { useFormStatus } from 'react-dom';

function SilButonu() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? 'Siliniyor…' : 'Sil'}</button>;
}

export default function KullaniciSilFormu({ action, kullaniciAdi }: {
  action: () => Promise<void>;
  kullaniciAdi: string;
}) {
  return (
    <form action={action} onSubmit={(olay) => {
      if (!window.confirm(`${kullaniciAdi} adlı kullanıcı ve tüm sınav verileri silinecek. Bu işlem geri alınamaz. Emin misin?`)) {
        olay.preventDefault();
      }
    }}>
      <SilButonu />
    </form>
  );
}
