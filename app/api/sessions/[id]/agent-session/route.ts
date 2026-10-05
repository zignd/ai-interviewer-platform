import { getContainer } from '@/lib/container';
import { createAgentSession } from '@/lib/engine/service';
import { handle, json, parseSessionId } from '@/lib/http';

/** Starts (or resumes) the interview and returns what the browser needs to join the ElevenLabs agent. */
export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/sessions/[id]/agent-session'>,
) {
  return handle(async () => {
    const { id } = await ctx.params;
    return json(await createAgentSession(getContainer(), parseSessionId(id)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}
