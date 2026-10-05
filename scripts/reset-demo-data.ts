/**
 * Wipes all interview data (sessions, turns, decisions, evaluations, recordings) from the database in DATABASE_URL
 * and deletes the stored recording files from Vercel Blob. Jobs and question banks are kept.
 *
 *   npx tsx scripts/reset-demo-data.ts --yes
 *
 * Use it to clear test runs before handing the demo over. It refuses to run without --yes.
 */
import 'dotenv/config';
import { del } from '@vercel/blob';
import { sql } from 'drizzle-orm';
import { createDb } from '../lib/db/client';

async function main() {
  if (!process.argv.includes('--yes')) {
    console.log('This deletes ALL interview data and recordings. Run again with --yes to confirm.');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db, sql: client } = createDb(url, { max: 1 });
  const rows = await db.execute<{ blob_url: string }>(
    sql`select blob_url from recordings where blob_url is not null and status <> 'deleted'`,
  );
  const urls = [...rows].map((r) => r.blob_url);
  if (urls.length && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(urls, { token: process.env.BLOB_READ_WRITE_TOKEN });
  }
  await db.execute(
    sql`truncate table recordings, decisions, evaluations, turns, sessions restart identity cascade`,
  );
  await client.end();
  console.log(`Deleted all interview data and ${urls.length} recording file(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
