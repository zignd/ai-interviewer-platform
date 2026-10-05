import { getContainer } from '@/lib/container';
import { getSampleAnswer } from '@/lib/engine/service';
import { errorResponse, handle, json, parseSessionId } from '@/lib/http';

export const maxDuration = 60;

/** Developer mode only (DEV_MODE=1): a strong sample answer for the current question. */
export async function POST(_request: Request, ctx: RouteContext<'/api/sessions/[id]/dev-answer'>) {
  return handle(async () => {
    if (process.env.DEV_MODE !== '1') return errorResponse(404, 'not_found', 'Not found');
    const { id } = await ctx.params;
    return json(await getSampleAnswer(getContainer(), parseSessionId(id)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}
