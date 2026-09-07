'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpenCheck, Check, CircleAlert, History, LockKeyhole, Mail, Play, RotateCcw, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { callExamApi } from '@/lib/exam-api';
import { getSupabaseBrowserClient, isDemoMode } from '@/lib/supabase-browser';
import type { ActiveAttempt, DashboardData, ExamMode, ExamResult } from '@/lib/portal-types';
import { ExamTimer, MetricCard, PageHeading, PortalShell, StatusNotice } from '@/components/portal/shared';

type View = 'login' | 'dashboard' | 'exam' | 'result';

const modeCopy: Record<ExamMode, { title: string; description: string }> = {
  rastgele: { title: 'Yeni Sınav', description: 'Resmî dağılıma göre 50 soruluk yeni deneme.' },
  azgorulen: { title: 'Az Görülenler', description: 'Öncelik daha az karşılaştığın sorularda.' },
  yanlislar: { title: 'Yanlışlar', description: 'Öncelik son denemelerde yanlış yaptıklarında.' },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function LoginView({ onDemoEnter }: { onDemoEnter: () => void }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = isDemoMode();

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (demo) return onDemoEnter();
    const client = getSupabaseBrowserClient();
    if (!client) return setError('Giriş servisi yapılandırılmamış.');
    setBusy(true);
    const { error: signInError } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (signInError) setError('Bu adres davetli olmayabilir veya giriş bağlantısı gönderilemedi.');
    else setMessage('Giriş bağlantısı e-posta adresine gönderildi.');
  }

  return (
    <PortalShell>
      <div className="login-layout">
        <section className="login-intro">
          <div className="kicker">25 Ekim 2026</div>
          <h1 className="mt-3 max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Denemelerin, kaldığın yerden devam eder.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
            50 soru, 60 dakika ve resmî konu dağılımı. Sonuçların yalnız senin hesabında saklanır.
          </p>
          <div className="mt-8 grid max-w-lg gap-3 sm:grid-cols-3">
            <MetricCard value="50" label="Soru" />
            <MetricCard value="60:00" label="Süre" />
            <MetricCard value="9" label="Konu" />
          </div>
        </section>

        <section className="surface-card login-card" aria-labelledby="login-title">
          <div className="mb-6 flex size-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <LockKeyhole aria-hidden="true" />
          </div>
          <h2 id="login-title" className="text-xl font-semibold">Hesabına giriş yap</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Yalnız davetli e-posta adresleri erişebilir. Parola gerekmez.
          </p>
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <label className="form-field" htmlFor="login-email">
              <span>E-posta adresi</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input id="login-email" className="h-11 pl-10" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ad.soyad@example.com" required={!demo} autoComplete="email" />
              </div>
            </label>
            <Button className="h-11 w-full" type="submit" disabled={busy}>
              {demo ? 'Yerel önizlemeye geç' : busy ? 'Gönderiliyor…' : 'Giriş bağlantısı gönder'}
            </Button>
          </form>
          {demo && <StatusNotice>Yerel önizleme modu: gerçek kullanıcı veya soru verisi kullanılmıyor.</StatusNotice>}
          {message && <StatusNotice tone="success">{message}</StatusNotice>}
          {error && <StatusNotice tone="error">{error}</StatusNotice>}
        </section>
      </div>
    </PortalShell>
  );
}

function DashboardView({
  data,
  onStart,
  onResume,
  onCancel,
  busy,
}: {
  data: DashboardData;
  onStart: (mode: ExamMode, code?: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  busy: boolean;
}) {
  const [code, setCode] = useState('');
  return (
    <>
      <PageHeading kicker="Deneme merkezi" title={`Merhaba, ${data.displayName}`} />
      {data.activeAttempt && (
        <section className="resume-card mb-6">
          <div>
            <div className="kicker text-warning">Yarım kalan deneme</div>
            <h2 className="mt-1 text-lg font-semibold">{modeCopy[data.activeAttempt.mode].title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.activeAttempt.answeredCount}/{data.activeAttempt.totalCount} soru cevaplandı · {formatDate(data.activeAttempt.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onResume(data.activeAttempt!.id)} disabled={busy}><Play aria-hidden="true" />Devam et</Button>
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="ghost" disabled={busy} />}>Sil</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Yarım kalan sınav silinsin mi?</AlertDialogTitle>
                  <AlertDialogDescription>Bu sınavdaki cevaplar kalıcı olarak silinecek. Tamamlanmış sınav geçmişi etkilenmez.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Vazgeç</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => onCancel(data.activeAttempt!.id)}>Sınavı sil</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </section>
      )}

      <div className="metric-grid">
        <MetricCard value={data.bankQuestionCount.toLocaleString('tr-TR')} label="Havuzdaki soru" />
        <MetricCard value={data.completedCount} label="Tamamlanan deneme" />
        <MetricCard value={data.overallPercent === null ? '—' : `%${data.overallPercent}`} label="Genel doğruluk" tone={data.overallPercent !== null && data.overallPercent >= 70 ? 'positive' : undefined} />
        <MetricCard value={data.lastScore ? `${data.lastScore.correct}/${data.lastScore.correct + data.lastScore.wrong + data.lastScore.blank}` : '—'} label="Son sınav" />
      </div>

      <section className="mt-8">
        <div className="kicker">Sınav başlat</div>
        <div className="mode-grid mt-3">
          {(Object.keys(modeCopy) as ExamMode[]).map((mode) => (
            <button key={mode} className="mode-card" type="button" onClick={() => onStart(mode)} disabled={busy || Boolean(data.activeAttempt)}>
              <div className="flex items-center justify-between gap-3">
                <span className="mode-icon"><BookOpenCheck aria-hidden="true" /></span>
                <ArrowRight className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>
              <h2>{modeCopy[mode].title}</h2>
              <p>{modeCopy[mode].description}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="surface-card mt-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="form-field min-w-56 flex-1" htmlFor="exam-code">
            <span>Deneme kodu</span>
            <Input id="exam-code" className="h-11 font-mono uppercase" value={code} onChange={(event) => setCode(event.target.value)} placeholder="UZY-…" />
          </label>
          <Button variant="secondary" className="h-11" disabled={!code.trim() || busy || Boolean(data.activeAttempt)} onClick={() => onStart('rastgele', code.trim())}>
            Kodla çöz
          </Button>
        </div>
      </section>

      <section className="surface-card mt-6">
        <div className="mb-4 flex items-center gap-2">
          <History className="size-5 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Son denemeler</h2>
        </div>
        {data.recentAttempts.length ? (
          <div className="divide-y divide-border">
            {data.recentAttempts.slice(0, 6).map((attempt) => (
              <div className="history-row" key={attempt.id}>
                <div><div className="font-medium">{modeCopy[attempt.mode].title}</div><div className="text-sm text-muted-foreground">{formatDate(attempt.updatedAt)}</div></div>
                <div className="text-right tabular-nums"><div className="font-semibold">{attempt.score?.correct}/{attempt.totalCount}</div><div className="text-sm text-muted-foreground">{attempt.score?.percent}%</div></div>
              </div>
            ))}
          </div>
        ) : <div className="empty-state">Henüz tamamlanmış deneme yok.</div>}
      </section>
    </>
  );
}

function ExamView({ attempt, onAnswer, onPause, onFinish, onFlag, busy }: {
  attempt: ActiveAttempt;
  onAnswer: (questionId: string, index: number) => void;
  onPause: () => void;
  onFinish: () => void;
  onFlag: (questionId: string, note: string) => Promise<void>;
  busy: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(attempt.elapsedSeconds);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [reported, setReported] = useState(false);
  const question = attempt.questions[index];

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(attempt.elapsedSeconds + Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [attempt.elapsedSeconds, attempt.id]);

  useEffect(() => {
    if (elapsed < 3600 || busy) return;
    onFinish();
  }, [busy, elapsed, onFinish]);

  const answered = Object.keys(attempt.answers).length;
  const selected = attempt.answers[question.id];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onPause} disabled={busy}><Save aria-hidden="true" />Kaydet ve çık</Button>
        <ExamTimer seconds={elapsed} />
      </div>
      <Progress value={((index + 1) / attempt.questions.length) * 100} className="mb-4" />
      <section className="question-card">
        <div className="question-meta">
          <span>{index + 1} / {attempt.questions.length}</span>
          <span>{question.topic}</span>
          <span>{answered} cevaplandı</span>
        </div>
        <h1 className="question-prompt">{question.prompt}</h1>
        <div className="mt-6 space-y-3" aria-label="Cevap seçenekleri">
          {question.options.map((option, optionIndex) => (
            <button key={`${question.id}-${optionIndex}`} type="button" aria-pressed={selected === optionIndex} className={`answer-option ${selected === optionIndex ? 'selected' : ''}`} onClick={() => onAnswer(question.id, optionIndex)} disabled={busy}>
              <span className="answer-letter">{String.fromCharCode(65 + optionIndex)}</span>
              <span>{option}</span>
            </button>
          ))}
        </div>
        <div className="mt-5">
          {!reportOpen ? (
            <Button variant="ghost" size="sm" onClick={() => setReportOpen(true)}><CircleAlert aria-hidden="true" />Soruda hata bildir</Button>
          ) : (
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <label className="form-field" htmlFor={`report-${question.id}`}>
                <span>Soruyla ilgili not</span>
                <Textarea id={`report-${question.id}`} value={reportNote} onChange={(event) => setReportNote(event.target.value)} maxLength={1000} placeholder="Eksik şık, güncel olmayan bilgi veya başka bir sorun…" />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={async () => { await onFlag(question.id, reportNote); setReported(true); setReportOpen(false); setReportNote(''); }}>Gönder</Button>
                <Button size="sm" variant="ghost" onClick={() => setReportOpen(false)}>Vazgeç</Button>
              </div>
            </div>
          )}
          {reported && <p className="mt-2 text-sm text-positive">Bildirim kaydedildi.</p>}
        </div>
        <div className="question-grid mt-7" aria-label="Soru numaraları">
          {attempt.questions.map((item, itemIndex) => (
            <button key={item.id} type="button" aria-current={itemIndex === index ? 'step' : undefined} className={`${attempt.answers[item.id] !== undefined ? 'answered' : ''} ${itemIndex === index ? 'current' : ''}`} onClick={() => setIndex(itemIndex)}>{itemIndex + 1}</button>
          ))}
        </div>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <Button variant="secondary" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0 || busy}><ArrowLeft aria-hidden="true" />Önceki</Button>
          <div className="flex gap-2">
            {index < attempt.questions.length - 1 && <Button variant="secondary" onClick={() => setIndex((value) => value + 1)} disabled={busy}>Sonraki<ArrowRight aria-hidden="true" /></Button>}
            <Button onClick={onFinish} disabled={busy}>{busy ? 'Kaydediliyor…' : `Sınavı bitir${answered < attempt.questions.length ? ` (${attempt.questions.length - answered} boş)` : ''}`}</Button>
          </div>
        </div>
      </section>
    </>
  );
}

function ResultView({ result, onDashboard }: { result: ExamResult; onDashboard: () => void }) {
  const [reviewIndex, setReviewIndex] = useState(0);
  const item = result.review[reviewIndex];
  return (
    <>
      <PageHeading kicker="Deneme tamamlandı" title={`%${result.score.percent} başarı`} actions={<Button variant="secondary" onClick={onDashboard}><RotateCcw aria-hidden="true" />Ana ekrana dön</Button>} />
      <div className="metric-grid">
        <MetricCard value={result.score.correct} label="Doğru" tone="positive" />
        <MetricCard value={result.score.wrong} label="Yanlış" />
        <MetricCard value={result.score.blank} label="Boş" />
        <MetricCard value={result.examCode} label="Deneme kodu" />
      </div>
      <section className="question-card mt-6">
        <div className="question-meta"><span>{reviewIndex + 1} / {result.review.length}</span><span>{item.topic}</span></div>
        <h2 className="question-prompt">{item.prompt}</h2>
        <div className="mt-5 space-y-3">
          {item.options.map((option, index) => {
            const correct = index === item.correctIndex;
            const selectedWrong = index === item.selectedIndex && !correct;
            return <div key={option} className={`review-option ${correct ? 'correct' : ''} ${selectedWrong ? 'wrong' : ''}`}><span className="answer-letter">{correct ? <Check /> : selectedWrong ? <X /> : String.fromCharCode(65 + index)}</span><span>{option}</span></div>;
          })}
        </div>
        <StatusNotice tone={item.isCorrect ? 'success' : item.isCorrect === false ? 'error' : 'info'}>
          <strong>{item.isCorrect ? 'Doğru.' : item.isCorrect === false ? 'Yanlış.' : 'Boş bırakıldı.'}</strong> {item.explanation}
        </StatusNotice>
        <div className="mt-5 flex justify-between">
          <Button variant="secondary" disabled={reviewIndex === 0} onClick={() => setReviewIndex((value) => value - 1)}><ArrowLeft />Önceki</Button>
          <Button variant="secondary" disabled={reviewIndex === result.review.length - 1} onClick={() => setReviewIndex((value) => value + 1)}>Sonraki<ArrowRight /></Button>
        </div>
      </section>
    </>
  );
}

export default function ExamPortal() {
  const demo = isDemoMode();
  const [view, setView] = useState<View>('login');
  const [identity, setIdentity] = useState('');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [attempt, setAttempt] = useState<ActiveAttempt | null>(null);
  const [result, setResult] = useState<ExamResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const data = await callExamApi({ action: 'dashboard' }) as DashboardData;
      setDashboard(data); setView('dashboard');
    } catch (err) { setError(err instanceof Error ? err.message : 'Veriler alınamadı.'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (demo) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    void client.auth.getSession().then(({ data }) => {
      if (data.session) { setIdentity(data.session.user.email ?? 'Kullanıcı'); void loadDashboard(); }
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (session) { setIdentity(session.user.email ?? 'Kullanıcı'); void loadDashboard(); }
      else { setIdentity(''); setView('login'); }
    });
    return () => listener.subscription.unsubscribe();
  }, [demo, loadDashboard]);

  const startAttempt = useCallback(async (mode: ExamMode, examCode?: string) => {
    const data = await callExamApi({ action: 'start', mode, examCode }) as ActiveAttempt;
    setAttempt(data);
    setView('exam');
    return data;
  }, []);

  const start = useCallback(async (mode: ExamMode, examCode?: string) => {
    setBusy(true); setError(null);
    try { await startAttempt(mode, examCode); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sınav başlatılamadı.'); }
    finally { setBusy(false); }
  }, [startAttempt]);

  useEffect(() => {
    if (view !== 'dashboard' || !dashboard) return;
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const reportRegistrationError = (registrationError: unknown) => {
      console.warn('WebMCP aracı kaydedilemedi.', registrationError);
    };

    try {
      void Promise.resolve(context.registerTool({
        name: 'read_exam_dashboard',
        title: 'Deneme özetini oku',
        description: 'Giriş yapan kullanıcının deneme sayısını, başarı oranını ve yarım sınav durumunu okur.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute() {
          return {
            completedCount: dashboard.completedCount,
            overallPercent: dashboard.overallPercent,
            activeAttempt: dashboard.activeAttempt ? {
              id: dashboard.activeAttempt.id,
              answeredCount: dashboard.activeAttempt.answeredCount,
              totalCount: dashboard.activeAttempt.totalCount,
            } : null,
          };
        },
      }, { signal: lifecycle.signal })).catch(reportRegistrationError);

      void Promise.resolve(context.registerTool({
        name: 'start_exam',
        title: 'Deneme başlat',
        description: 'Seçilen modda yeni bir deneme başlatır ve görünür arayüzü ilk soruya geçirir.',
        inputSchema: {
          type: 'object',
          properties: { mode: { type: 'string', enum: ['rastgele', 'azgorulen', 'yanlislar'] } },
          required: ['mode'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          const mode = (input as { mode?: unknown })?.mode;
          if (mode !== 'rastgele' && mode !== 'azgorulen' && mode !== 'yanlislar') throw new Error('Geçerli bir sınav modu gerekli.');
          if (dashboard.activeAttempt) throw new Error('Önce yarım kalan sınav tamamlanmalı.');
          setBusy(true); setError(null);
          try {
            const created = await startAttempt(mode);
            return { status: 'started', mode, attemptId: created.id, totalCount: created.totalCount };
          } catch (toolError) {
            setError(toolError instanceof Error ? toolError.message : 'Sınav başlatılamadı.');
            throw toolError;
          } finally {
            setBusy(false);
          }
        },
      }, { signal: lifecycle.signal })).catch(reportRegistrationError);
    } catch (registrationError) {
      reportRegistrationError(registrationError);
    }
    return () => lifecycle.abort();
  }, [dashboard, startAttempt, view]);

  const resume = useCallback(async (attemptId: string) => {
    setBusy(true); setError(null);
    try { setAttempt(await callExamApi({ action: 'resume', attemptId }) as ActiveAttempt); setView('exam'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sınava devam edilemedi.'); }
    finally { setBusy(false); }
  }, []);

  const cancelAttempt = useCallback(async (attemptId: string) => {
    setBusy(true); setError(null);
    try { await callExamApi({ action: 'cancel', attemptId }); await loadDashboard(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sınav silinemedi.'); }
    finally { setBusy(false); }
  }, [loadDashboard]);

  const answer = useCallback(async (questionId: string, selectedIndex: number) => {
    if (!attempt) return;
    const previous = attempt.answers[questionId];
    setAttempt({ ...attempt, answers: { ...attempt.answers, [questionId]: selectedIndex }, answeredCount: Object.keys({ ...attempt.answers, [questionId]: selectedIndex }).length });
    try { await callExamApi({ action: 'answer', attemptId: attempt.id, questionId, selectedIndex }); }
    catch (err) {
      setAttempt((current) => {
        if (!current) return current;
        const answers = { ...current.answers };
        if (previous === undefined) delete answers[questionId];
        else answers[questionId] = previous;
        return { ...current, answers, answeredCount: Object.keys(answers).length };
      });
      setError(err instanceof Error ? err.message : 'Cevap kaydedilemedi.');
    }
  }, [attempt]);

  const flagQuestion = useCallback(async (questionId: string, note: string) => {
    if (!attempt) return;
    setError(null);
    try { await callExamApi({ action: 'flag', attemptId: attempt.id, questionId, note }); }
    catch (err) {
      const message = err instanceof Error ? err.message : 'Bildirim kaydedilemedi.';
      setError(message);
      throw err;
    }
  }, [attempt]);

  async function pause() {
    if (!attempt) return;
    setBusy(true);
    try { await callExamApi({ action: 'pause', attemptId: attempt.id }); await loadDashboard(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sınav kaydedilemedi.'); }
    finally { setBusy(false); }
  }

  async function finish() {
    if (!attempt) return;
    setBusy(true); setError(null);
    try { const data = await callExamApi({ action: 'finish', attemptId: attempt.id }) as ExamResult; setResult(data); setAttempt(null); setView('result'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sınav tamamlanamadı.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!demo) await getSupabaseBrowserClient()?.auth.signOut();
    setIdentity(''); setDashboard(null); setAttempt(null); setResult(null); setView('login');
  }

  let content = null;
  if (view === 'exam' && attempt) content = <ExamView attempt={attempt} onAnswer={answer} onPause={pause} onFinish={finish} onFlag={flagQuestion} busy={busy} />;
  else if (view === 'result' && result) content = <ResultView result={result} onDashboard={loadDashboard} />;
  else if (dashboard) content = <DashboardView data={dashboard} onStart={start} onResume={resume} onCancel={cancelAttempt} busy={busy} />;

  if (view === 'login') return <LoginView onDemoEnter={() => { setIdentity('Yerel Önizleme'); void loadDashboard(); }} />;

  return (
    <PortalShell identity={identity || 'Yerel Önizleme'} onSignOut={signOut}>
      {error && <div className="mb-5"><StatusNotice tone="error"><span className="inline-flex items-center gap-2"><CircleAlert className="size-4" />{error}</span></StatusNotice></div>}
      {busy && !content ? <div className="empty-state">Yükleniyor…</div> : content}
    </PortalShell>
  );
}
