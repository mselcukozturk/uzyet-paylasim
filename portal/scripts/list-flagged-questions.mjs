// Run: node --env-file=.env.local scripts/list-flagged-questions.mjs (portal/ klasöründe, DATABASE_URL gerektirir).
// question_flags tablosundaki tüm işaretleri, işaretleyen kullanıcı adı ve (bulunabilirse)
// soru metniyle birlikte listeler. /admin panelinde henüz bir görünümü yok — bu script o
// boşluğu dolduruyor.
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL tanımlı değil — .env.local dosyasını kontrol et.');
const sql = postgres(url, { max: 1, prepare: false });

let bankByGuid = new Map();
try {
  const bankUrl = new URL(process.env.QUESTION_BANK_PATH ?? '../../../web_quiz_bank.json', import.meta.url);
  const bank = JSON.parse(await readFile(bankUrl, 'utf8'));
  bankByGuid = new Map(bank.map((q) => [String(q.guid ?? '').trim(), q]));
} catch {
  console.warn('Uyarı: web_quiz_bank.json okunamadı — soru metni gösterilmeyecek, yalnız GUID.');
}

const rows = await sql`
  select f.user_id, f.question_guid, f.note, f.category, f.is_reported, f.updated_at,
         p.username, p.display_name
  from question_flags f
  left join profiles p on p.user_id = f.user_id
  order by f.updated_at desc
`;

if (rows.length === 0) {
  console.log('Hiç işaretli soru yok.');
} else {
  console.log(`${rows.length} işaret bulundu:\n`);
  for (const r of rows) {
    const q = bankByGuid.get(r.question_guid);
    const kim = r.display_name || r.username || r.user_id;
    console.log(`— ${r.updated_at.toISOString()} · ${kim} · kategori: ${r.category ?? '(yok)'} · rapor: ${r.is_reported ? 'evet' : 'hayır'}`);
    console.log(`  GUID: ${r.question_guid}`);
    if (q) console.log(`  Konu: ${q.konu}\n  Soru: ${q.soru.replace(/\n/g, ' ')}`);
    else console.log('  (Soru metni yerel bankada bulunamadı — GUID silinmiş/değişmiş olabilir.)');
    if (r.note) console.log(`  Not: ${r.note}`);
    console.log('');
  }
}

await sql.end();
