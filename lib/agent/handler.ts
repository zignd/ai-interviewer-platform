import { z } from 'zod';
import type { Container } from '@/lib/container';
import { ServiceError, submitTurn } from '@/lib/engine/service';

/** What ElevenLabs Agents POST to a Custom LLM (only the parts we use). */
export const agentRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.string(), content: z.unknown().optional() }).passthrough())
    .min(1),
  elevenlabs_extra_body: z.object({ session_id: z.string().uuid() }).passthrough(),
});

export const APOLOGY = "Sorry, I didn't catch that. Could you say it again?";

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === 'object' && p && 'text' in p ? String((p as { text: unknown }).text) : '',
      )
      .join(' ');
  }
  return '';
}

/** The last thing the candidate said, as transcribed by ElevenLabs. */
export function lastUserText(messages: { role: string; content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return textOf(messages[i].content).trim();
  }
  return '';
}

export type AgentTurnResult = { text: string; done: boolean };

/**
 * Turns one Custom LLM request into the interviewer's next words by running the same engine
 * as the browser-driven transport. Failures become a short spoken apology so the call never goes silent.
 */
export async function handleAgentTurn(
  c: Container,
  body: z.infer<typeof agentRequestSchema>,
): Promise<AgentTurnResult> {
  const transcript = lastUserText(body.messages);
  const sessionId = body.elevenlabs_extra_body.session_id;
  if (!transcript) return { text: APOLOGY, done: false };
  try {
    const r = await submitTurn(c, sessionId, { transcript });
    return { text: r.question.text, done: r.done };
  } catch (err) {
    if (err instanceof ServiceError && err.code === 'session_not_active') {
      return { text: 'This interview has ended. Thank you for your time.', done: true };
    }
    console.warn('agent turn failed', err instanceof Error ? err.message : err);
    return { text: APOLOGY, done: false };
  }
}
