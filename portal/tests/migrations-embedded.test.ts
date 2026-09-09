import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

// /api/admin/migrate, migration SQL'lerini diskten değil build zamanında üretilen
// lib/db/migrations.generated.ts modülünden okur. Bu test o modülün drizzle/ ile
// birebir aynı kaldığını doğrular — yeni bir .sql eklenip `npm run db:gen`
// unutulursa uç sessizce eski şemayı uygulamaya çalışırdı.
const generated = readFileSync(new URL('../lib/db/migrations.generated.ts', import.meta.url), 'utf8');
const sqlDir = new URL('../drizzle/', import.meta.url);
const sqlNames = readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();

void test('gömülü migration listesi drizzle/*.sql ile aynıdır', () => {
  const embedded = [...generated.matchAll(/^\s{4}name: "(.+?)",$/gm)].map((m) => m[1]);
  assert.deepEqual(embedded, sqlNames);
});

void test('gömülü her migration içeriği kaynak dosyayla birebir aynıdır', () => {
  for (const name of sqlNames) {
    const disk = readFileSync(new URL(name, sqlDir), 'utf8');
    // Üretici JSON.stringify kullanıyor; aynı kodlamayla karşılaştır.
    assert.ok(
      generated.includes(JSON.stringify(disk)),
      `${name} içeriği migrations.generated.ts ile uyuşmuyor — 'npm run db:gen' çalıştırın.`,
    );
  }
});

void test('migration adları sıralıdır ve numara tekrarı yoktur', () => {
  const prefixes = sqlNames.map((n) => n.slice(0, 4));
  assert.deepEqual(prefixes, [...prefixes].sort());
  assert.equal(new Set(prefixes).size, prefixes.length);
});
