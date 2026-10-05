import { getContainer } from '@/lib/container';
import { startInterview } from '@/lib/engine/service';
import { handle, json, parseSessionId } from '@/lib/http';

export async function POST(_request: Request, ctx: RouteContext<'/api/sessions/[id]/start'>) {
  return handle(async () => {
    const { id } = await ctx.params;
    return json(await startInterview(getContainer(), parseSessionId(id)));
  });
}
