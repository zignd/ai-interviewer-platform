import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../lib/db/client';
import { resolveDbUrl } from './db-url';

/** Applies SQL migrations from ./drizzle. */
async function main() {
  const url = await resolveDbUrl(process.argv[2]);
  const { db, sql } = createDb(url, { max: 1 });
  await migrate(db, { migrationsFolder: './drizzle' });
  await sql.end();
  console.log('Migrations applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
