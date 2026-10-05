import { timingSafeEqual } from 'node:crypto';
import { getDb } from '@/lib/db/client';
import { createRepos } from '@/lib/db/repos';
import { errorResponse } from '@/lib/http';

/** Daily Vercel Cron job: a trivial query so the free Supabase project never pauses from inactivity. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret ?? '');
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return errorResponse(401, 'unauthorized', 'Invalid credentials');
  }
  await createRepos(getDb()).health();
  return Response.json({ ok: true, at: new Date().toISOString() });
}
