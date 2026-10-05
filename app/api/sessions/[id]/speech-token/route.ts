import { getContainer } from '@/lib/container';
import { createSpeechSession } from '@/lib/engine/service';
import { handle, json, parseSessionId } from '@/lib/http';

/** Mints a short-lived speech-to-text token. Only active sessions get one. */
export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/sessions/[id]/speech-token'>,
) {
  return handle(async () => {
    const { id } = await ctx.params;
    return json(await createSpeechSession(getContainer(), parseSessionId(id)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}
