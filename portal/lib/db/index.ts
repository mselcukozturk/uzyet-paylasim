import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const globalDb = globalThis as unknown as {
  __uzyetSql?: ReturnType<typeof postgres>;
  __uzyetDb?: PostgresJsDatabase<typeof schema>;
};

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL yapılandırılmamış.');
  globalDb.__uzyetSql ??= postgres(url, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 5,
    prepare: false,
  });
  globalDb.__uzyetDb ??= drizzle(globalDb.__uzyetSql, { schema });
  return globalDb.__uzyetDb;
}

export { schema };
