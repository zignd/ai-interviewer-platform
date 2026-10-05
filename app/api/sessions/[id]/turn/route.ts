import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { submitTurn } from '@/lib/engine/service';
import { handle, json, parseSessionId, readJson } from '@/lib/http';

const bodySchema = z.object({
  transcript: z.string().min(1).max(8000),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  audioMs: z
    .number()
    .int()
    .nonnegative()
    .max(60 * 60 * 1000)
    .optional(),
});

/** The candidate's final transcript in, the next question (or the end of the interview) out. */
export async function POST(request: Request, ctx: RouteContext<'/api/sessions/[id]/turn'>) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = bodySchema.parse(await readJson(request));
    const result = await submitTurn(getContainer(), parseSessionId(id), {
      transcript: body.transcript,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
      endedAt: body.endedAt ? new Date(body.endedAt) : undefined,
      audioMs: body.audioMs,
    });
    return json(result);
  });
}
