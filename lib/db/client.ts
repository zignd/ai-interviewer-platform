import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * Builds a Drizzle client. `prepare: false` is required for Supabase's transaction pooler,
 * which doesn't support prepared statements. Keep the pool tiny: functions are short-lived.
 */
export function createDb(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, { prepare: false, max: options.max ?? 3, idle_timeout: 20 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

let shared: ReturnType<typeof createDb> | undefined;

/** Process-wide client used by route handlers. */
export function getDb(): Db {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    shared = createDb(url);
  }
  return shared.db;
}

export { schema };
