import { createClient } from '@supabase/supabase-js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes('@')) throw new Error('Kullanım: npm run user:invite -- kullanici@example.com');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const portalUrl = process.env.PORTAL_URL;
if (!url || !secret || !portalUrl) throw new Error('Supabase ve PORTAL_URL ayarları gerekli.');

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: portalUrl });
if (error) throw error;
console.log(`Davet oluşturuldu: ${data.user.email}`);

