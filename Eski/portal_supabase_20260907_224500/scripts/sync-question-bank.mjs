import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const sourceUrl = process.env.QUESTION_BANK_PATH
  ? pathToFileURL(resolve(process.env.QUESTION_BANK_PATH))
  : new URL('../../../web_quiz_bank.json', import.meta.url);
const sourceText = await readFile(sourceUrl, 'utf8');
const source = JSON.parse(sourceText);

if (!Array.isArray(source) || source.length === 0) throw new Error('Soru bankası boş veya beklenen JSON dizisi değil.');

const letterIndex = { A: 0, B: 1, C: 2, D: 3 };
const seen = new Set();
const questions = source.map((item, index) => {
  const guid = String(item.guid ?? '').trim();
  const rawCorrectIndex = letterIndex[String(item.cevap_harf ?? '').trim().toUpperCase()];
  const rawOptions = [item.a, item.b, item.c, item.d].map((value) => String(value ?? '').trim());
  const correctText = rawOptions[rawCorrectIndex] || String(item.cevap_metni ?? '').trim();
  const options = rawOptions.filter(Boolean);
  const correctIndex = options.indexOf(correctText);
  if (!guid || seen.has(guid)) throw new Error(`Eksik veya mükerrer GUID: satır ${index + 1}`);
  if (!String(item.konu ?? '').trim() || !String(item.soru ?? '').trim()) throw new Error(`Eksik konu/soru: ${guid}`);
  if (options.length < 2 || correctIndex < 0) throw new Error(`Geçersiz cevap veya şıklar: ${guid}`);
  seen.add(guid);
  return {
    guid,
    topic: String(item.konu).trim(),
    prompt: String(item.soru).trim(),
    options,
    correct_index: correctIndex,
    explanation: String(item.aciklama ?? '').trim(),
    source: String(item.kaynak ?? '').trim(),
    verified: String(item.dogrulanmis ?? '').trim().toLocaleLowerCase('tr-TR') === 'evet',
  };
});

const version = createHash('sha256').update(sourceText).digest('hex').slice(0, 16);
const topicCounts = Object.fromEntries([...new Set(questions.map((item) => item.topic))].sort().map((topic) => [topic, questions.filter((item) => item.topic === topic).length]));

console.log(JSON.stringify({ version, questionCount: questions.length, topicCounts }, null, 2));
if (process.argv.includes('--check')) process.exit(0);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) throw new Error('NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SECRET_KEY gerekli.');

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const bankLookup = await admin.from('question_banks').select('*').eq('version', version).maybeSingle();
if (bankLookup.error) throw bankLookup.error;
let bank = bankLookup.data;

if (!bank) {
  const { data, error } = await admin.from('question_banks').insert({ version, question_count: questions.length, is_active: false }).select('*').single();
  if (error) throw error;
  bank = data;
  for (let offset = 0; offset < questions.length; offset += 250) {
    const batch = questions.slice(offset, offset + 250).map((item) => ({ ...item, bank_id: bank.id }));
    const { error: insertError } = await admin.from('questions').insert(batch);
    if (insertError) throw insertError;
    console.log(`${Math.min(offset + batch.length, questions.length)}/${questions.length} soru aktarıldı.`);
  }
}

const { count, error: countError } = await admin.from('questions').select('id', { count: 'exact', head: true }).eq('bank_id', bank.id);
if (countError) throw countError;
if (count !== questions.length) throw new Error(`Aktarım sayısı uyuşmuyor: ${count}/${questions.length}`);

const { error: deactivateError } = await admin.from('question_banks').update({ is_active: false }).eq('is_active', true).neq('id', bank.id);
if (deactivateError) throw deactivateError;
const { error: activateError } = await admin.from('question_banks').update({ is_active: true }).eq('id', bank.id);
if (activateError) throw activateError;
console.log(`Aktif banka: ${version} (${questions.length} soru)`);
