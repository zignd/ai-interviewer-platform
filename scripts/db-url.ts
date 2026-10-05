import postgres from 'postgres';

async function reachable(url: string) {
  const sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

/**
 * Picks the database for maintenance scripts: an explicit URL argument, else DIRECT_URL if it is
 * reachable (it is IPv6-only on Supabase's free plan), else the pooled DATABASE_URL.
 */
export async function resolveDbUrl(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const direct = process.env.DIRECT_URL;
  const pooled = process.env.DATABASE_URL;
  if (direct && (await reachable(direct))) return direct;
  if (pooled) {
    if (direct) console.log('DIRECT_URL is not reachable from here, using DATABASE_URL instead.');
    return pooled;
  }
  throw new Error('Set DIRECT_URL or DATABASE_URL (or pass a URL as the first argument).');
}
