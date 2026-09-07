import type {
  ActiveAttempt,
  DashboardData,
  ExamApiRequest,
  ExamResult,
} from './portal-types';
import { demoApi } from './exam-demo';

export type ExamApiResponse = DashboardData | ActiveAttempt | ExamResult | { ok: true };

export async function callExamApi(request: ExamApiRequest, demo = false): Promise<ExamApiResponse> {
  if (demo) return demoApi(request);
  const response = await fetch('/api/exam', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    cache: 'no-store',
  });
  const data = await response.json() as ExamApiResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Sınav servisine ulaşılamadı.');
  return data;
}
