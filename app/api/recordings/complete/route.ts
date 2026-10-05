import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { handle, json, readJson } from '@/lib/http';
import { completeRecording } from '@/lib/storage/service';

const bodySchema = z.union([
  z.object({
    recordingId: z.string().uuid(),
    blobUrl: z.string().url(),
    sizeBytes: z.number().int().positive(),
  }),
  z.object({ recordingId: z.string().uuid(), failed: z.literal(true) }),
]);

/** Called by the browser after the upload finished (or failed) so the budget bookkeeping is accurate. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = bodySchema.parse(await readJson(request));
    return json(await completeRecording(getContainer(), body));
  });
}
