import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { handle, json, readJson } from '@/lib/http';
import { prepareRecording } from '@/lib/storage/service';

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  kind: z.enum(['video', 'audio']),
  sizeBytes: z.number().int().positive().max(2_000_000_000),
  extension: z.enum(['webm', 'mp4']).default('webm'),
});

/**
 * Checks the storage budget (deleting the oldest recordings if needed) and returns a size-capped upload token.
 * Recording is optional: every problem is reported as `skip` or `use_audio`, never as a failed interview.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = bodySchema.parse(await readJson(request));
    const c = getContainer();
    const session = await c.repos.sessions.byId(body.sessionId);
    if (!session) return json({ action: 'skip', reason: 'unavailable' });
    return json(await prepareRecording(c, body), { headers: { 'Cache-Control': 'no-store' } });
  });
}
