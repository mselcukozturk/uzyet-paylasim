import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL gerekli.');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const migrationDir = resolve(import.meta.dirname, '..', 'drizzle');

try {
  await sql`create table if not exists _migrations (ad text primary key, uygulandi timestamptz not null default now())`;
  const applied = new Set((await sql`select ad from _migrations`).map((row) => row.ad));
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const content = await readFile(resolve(migrationDir, file), 'utf8');
    await sql.begin(async (tx) => {
      for (const statement of content.split('--> statement-breakpoint')) {
        if (statement.trim()) await tx.unsafe(statement);
      }
      await tx`insert into _migrations (ad) values (${file})`;
    });
    console.log(`✓ ${file}`);
    count += 1;
  }
  console.log(count ? `${count} migration uygulandı.` : 'Veritabanı şeması güncel.');
} finally {
  await sql.end();
}
