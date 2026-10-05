import { execSync } from 'node:child_process';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { seed } from '../../lib/seed';

export const LOCAL_TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/interviewer_test';

/** Wipes and refuses to touch anything that is not a local database. */
export function assertLocalDb(url: string) {
  const host = new URL(url).hostname;
  if (
    !['localhost', '127.0.0.1', '::1', 'db', 'postgres'].includes(host) &&
    process.env.ALLOW_REMOTE_TEST_DB !== '1'
  ) {
    throw new Error(`Refusing to wipe non-local database host "${host}".`);
  }
}

async function canConnect(url: string) {
  const sql = postgres(url, { max: 1, connect_timeout: 3, onnotice: () => undefined });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

/** Starts a throwaway Postgres if needed, then builds a fresh, migrated and seeded schema. */
export async function prepareDatabase(url = LOCAL_TEST_DATABASE_URL) {
  assertLocalDb(url);
  if (!(await canConnect(url))) {
    console.log('[tests] Postgres not reachable, starting it with docker compose...');
    execSync('docker compose up -d --wait db', { stdio: 'inherit' });
  }
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  await sql.unsafe(
    'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
  );
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: './drizzle' });
  await seed(db as never);
  await sql.end();
}
