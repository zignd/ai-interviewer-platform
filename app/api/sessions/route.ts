import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { createAndJoin } from '@/lib/engine/service';
import { handle, json, readJson } from '@/lib/http';

const bodySchema = z.object({
  jobId: z.string().uuid(),
  mode: z.enum(['text', 'voice', 'video']).default('text'),
});

export async function POST(request: Request) {
  return handle(async () => {
    const body = bodySchema.parse(await readJson(request));
    const session = await createAndJoin(getContainer(), body);
    return json({ id: session.id, status: session.status, queue: session.queue }, { status: 201 });
  });
}
