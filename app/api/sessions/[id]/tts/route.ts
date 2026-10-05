import { getContainer } from '@/lib/container';
import { getInterviewerTurnText } from '@/lib/engine/service';
import { errorResponse, handle, parseSessionId } from '@/lib/http';

/**
 * Streams the interviewer's spoken question. The text always comes from the saved turn,
 * so this route can't be used to synthesize arbitrary text.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/sessions/[id]/tts'>) {
  return handle(async () => {
    const { id } = await ctx.params;
    const sessionId = parseSessionId(id);
    const turn = new URL(request.url).searchParams.get('turn');
    if (turn === null || !/^\d{1,6}$/.test(turn)) {
      return errorResponse(400, 'invalid_request', 'turn must be a non-negative integer');
    }
    const idx = Number(turn);
    const c = getContainer();
    const text = await getInterviewerTurnText(c, sessionId, idx);
    let audio;
    try {
      audio = await c.synthesizer.synthesize(text);
    } catch (err) {
      console.warn('speech synthesis failed', err instanceof Error ? err.message : err);
      return errorResponse(502, 'speech_unavailable', 'Speech is unavailable right now');
    }
    return new Response(audio.stream, {
      headers: { 'Content-Type': audio.contentType, 'Cache-Control': 'private, max-age=3600' },
    });
  });
}
