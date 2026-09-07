import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

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

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL gerekli.');
const sql = postgres(url, { max: 1, prepare: false });

try {
  await sql.begin(async (tx) => {
    let [bank] = await tx`select * from question_banks where version = ${version} limit 1`;
    if (!bank) {
      [bank] = await tx`
        insert into question_banks (version, question_count, is_active)
        values (${version}, ${questions.length}, false)
        returning *
      `;
      for (let offset = 0; offset < questions.length; offset += 250) {
        const batch = questions.slice(offset, offset + 250).map((item) => ({ ...item, bank_id: bank.id }));
        await tx`insert into questions ${tx(batch, 'bank_id', 'guid', 'topic', 'prompt', 'options', 'correct_index', 'explanation', 'source', 'verified')}`;
        console.log(`${Math.min(offset + batch.length, questions.length)}/${questions.length} soru aktarıldı.`);
      }
    }
    const [{ count }] = await tx`select count(*)::int as count from questions where bank_id = ${bank.id}`;
    if (count !== questions.length) throw new Error(`Aktarım sayısı uyuşmuyor: ${count}/${questions.length}`);
    await tx`update question_banks set is_active = false where is_active = true and id <> ${bank.id}`;
    await tx`update question_banks set is_active = true where id = ${bank.id}`;
  });
  console.log(`Aktif banka: ${version} (${questions.length} soru)`);
} finally {
  await sql.end();
}
