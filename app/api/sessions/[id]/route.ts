import { getContainer } from '@/lib/container';
import { getSessionView } from '@/lib/engine/service';
import { handle, json, parseSessionId } from '@/lib/http';

export async function GET(_request: Request, ctx: RouteContext<'/api/sessions/[id]'>) {
  return handle(async () => {
    const { id } = await ctx.params;
    return json(await getSessionView(getContainer(), parseSessionId(id)));
  });
}
