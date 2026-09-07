import type {
  ActiveAttempt,
  DashboardData,
  ExamApiRequest,
  ExamResult,
} from './portal-types';
import { demoApi } from './exam-demo';
import { getSupabaseBrowserClient, isDemoMode } from './supabase-browser';

export type ExamApiResponse = DashboardData | ActiveAttempt | ExamResult | { ok: true };

export async function callExamApi(request: ExamApiRequest): Promise<ExamApiResponse> {
  if (isDemoMode()) return demoApi(request);

  const client = getSupabaseBrowserClient();
  if (!client) throw new Error('Bağlantı ayarları bulunamadı.');

  const { data, error } = await client.functions.invoke('exam-api', { body: request });
  if (error) throw new Error(error.message || 'Sınav servisine ulaşılamadı.');
  if (data?.error) throw new Error(data.error);
  return data as ExamApiResponse;
}

