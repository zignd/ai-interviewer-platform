import { getContainer } from '@/lib/container';
import { ServiceError } from '@/lib/engine/service';
import { handle, json, parseSessionId } from '@/lib/http';
import { touchGate } from '@/lib/queue/service';

export async function POST(_request: Request, ctx: RouteContext<'/api/sessions/[id]/queue'>) {
  return handle(async () => {
    const { id } = await ctx.params;
    const sessionId = parseSessionId(id);
    const c = getContainer();
    if (!(await c.repos.sessions.byId(sessionId))) {
      throw new ServiceError(404, 'session_not_found', 'Session not found');
    }
    return json(await touchGate(c.repos.db, sessionId, c.clock.now()), {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}
