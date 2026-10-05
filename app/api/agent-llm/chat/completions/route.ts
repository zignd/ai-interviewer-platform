import { timingSafeEqual } from 'node:crypto';
import { handleAgentTurn, agentRequestSchema } from '@/lib/agent/handler';
import { sseResponse } from '@/lib/agent/sse';
import { getContainer } from '@/lib/container';
import { errorResponse, readJson } from '@/lib/http';

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.AGENT_LLM_SECRET;
  if (!secret) return false;
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Custom LLM endpoint for ElevenLabs Agents (OpenAI chat-completions compatible, streaming).
 * ElevenLabs handles speech-to-text, turn-taking and text-to-speech; our interview engine decides what to say.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return errorResponse(401, 'unauthorized', 'Invalid credentials');
  const parsed = agentRequestSchema.safeParse(await readJson(request));
  if (!parsed.success)
    return errorResponse(400, 'invalid_request', 'Missing session_id in elevenlabs_extra_body');
  const result = await handleAgentTurn(getContainer(), parsed.data);
  return sseResponse(result.text);
}
