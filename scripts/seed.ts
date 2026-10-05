import 'dotenv/config';
import { createDb } from '../lib/db/client';
import { seed } from '../lib/seed';
import { resolveDbUrl } from './db-url';

async function main() {
  const url = await resolveDbUrl(process.argv[2]);
  const { db, sql } = createDb(url, { max: 1 });
  await seed(db);
  await sql.end();
  console.log('Seed complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
