// drizzle/*.sql dosyalarını lib/db/migrations.generated.ts içine gömer.
// Neden: /api/admin/migrate bu SQL'lere deploy edilmiş ortamda erişmek zorunda; runtime
// `fs` okuması Turbopack'in bağımlılık izlemesinde statik olarak çözülemediği için
// ("Dynamic path in fs call" uyarısı) paketlenmeme riski taşıyordu. Build zamanında
// gömülen modülde bu risk yok. `prebuild` ile Vercel'de de otomatik çalışır.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const migrationDir = resolve(root, 'drizzle');
const outFile = resolve(root, 'lib', 'db', 'migrations.generated.ts');

const names = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();
if (names.length === 0) throw new Error('drizzle/ altında .sql migration bulunamadı.');

const entries = [];
for (const name of names) {
  // Satır sonlarını LF'e sabitle: git bu .sql dosyalarını Windows'ta CRLF'e çeviriyor,
  // Vercel'de (Linux) LF kalıyor. Normalize etmezsek üretilen modül platforma göre
  // farklı çıkar — SQL anlamı değişmez ama dosya gereksiz yere oynar ve karşılaştırma
  // yapan test yanlış yere alarm verir.
  const content = (await readFile(resolve(migrationDir, name), 'utf8')).replace(/\r\n/g, '\n');
  entries.push(
    `  {\n    name: ${JSON.stringify(name)},\n    content: ${JSON.stringify(content)},\n  },`,
  );
}

const out = `// OTOMATİK ÜRETİLDİ — elle düzenlemeyin.
// Kaynak: portal/drizzle/*.sql · Üretici: portal/scripts/gen-migrations.mjs
// Yeni migration ekledikten sonra \`npm run db:gen\` çalıştırın (build sırasında da üretilir).

export type Migration = { name: string; content: string };

export const MIGRATIONS: readonly Migration[] = [
${entries.join('\n')}
];
`;

await writeFile(outFile, out, 'utf8');
console.log(`${names.length} migration gömüldü → lib/db/migrations.generated.ts`);
