'use client';

import type { ReactNode } from 'react';
import { Clock3, LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PortalShell({
  children,
  identity,
  onSignOut,
}: {
  children: ReactNode;
  identity?: string;
  onSignOut?: () => void;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="portal-header">
        <div className="portal-container flex h-16 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="brand-mark" aria-hidden="true">U</div>
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-[0.16em]">UZYET</div>
              <div className="truncate text-xs text-muted-foreground">Deneme Portalı</div>
            </div>
          </div>
          {identity && onSignOut ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden max-w-56 truncate text-sm text-muted-foreground sm:block">{identity}</span>
              <Button variant="ghost" size="sm" onClick={onSignOut} aria-label="Oturumu kapat">
                <LogOut aria-hidden="true" />
                <span className="hidden sm:inline">Çıkış</span>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-positive" aria-hidden="true" />
              Davetli erişim
            </div>
          )}
        </div>
      </header>
      <main className="portal-container py-6 sm:py-9">{children}</main>
    </div>
  );
}

export function MetricCard({ value, label, tone }: { value: ReactNode; label: string; tone?: 'positive' | 'warning' }) {
  const toneClass = tone === 'positive' ? 'text-positive' : tone === 'warning' ? 'text-warning' : '';
  return (
    <div className="metric-card">
      <div className={`metric-value ${toneClass}`}>{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export function StatusNotice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }) {
  return <div className={`status-notice status-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function ExamTimer({ seconds }: { seconds: number }) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  const urgent = seconds >= 50 * 60;
  return (
    <span className={`exam-timer ${urgent ? 'text-warning' : ''}`} title="Resmî sınav süresi 60 dakika">
      <Clock3 className="size-4" aria-hidden="true" />
      {minutes}:{remainder}
    </span>
  );
}

export function PageHeading({ kicker, title, actions }: { kicker: string; title: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="kicker">{kicker}</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      </div>
      {actions}
    </div>
  );
}
