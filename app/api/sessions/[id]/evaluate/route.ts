import { getContainer } from '@/lib/container';
import { evaluateSession } from '@/lib/engine/service';
import { handle, json, parseSessionId } from '@/lib/http';

export const maxDuration = 60;

export async function POST(_request: Request, ctx: RouteContext<'/api/sessions/[id]/evaluate'>) {
  return handle(async () => {
    const { id } = await ctx.params;
    return json(await evaluateSession(getContainer(), parseSessionId(id)));
  });
}
