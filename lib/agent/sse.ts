/**
 * OpenAI-compatible streaming for ElevenLabs Agents' Custom LLM.
 * ElevenLabs expects Server-Sent Events: `data: {chat.completion.chunk}` lines ending with `data: [DONE]`.
 */

export const AGENT_MODEL = 'interviewer-engine';

type Chunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: 0;
    delta: { role?: 'assistant'; content?: string };
    finish_reason: 'stop' | null;
  }[];
};

/** Splits text into sentence-sized pieces so speech can start before the whole reply is sent. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  return parts.map((p) => p).filter((p) => p.trim().length > 0);
}

export function chunkLines(
  text: string,
  id = `chatcmpl-${Date.now()}`,
  created = Math.floor(Date.now() / 1000),
): string[] {
  const base = { id, object: 'chat.completion.chunk' as const, created, model: AGENT_MODEL };
  const make = (delta: Chunk['choices'][0]['delta'], finish: 'stop' | null): Chunk => ({
    ...base,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  const lines = [`data: ${JSON.stringify(make({ role: 'assistant', content: '' }, null))}\n\n`];
  for (const sentence of splitSentences(text)) {
    lines.push(`data: ${JSON.stringify(make({ content: sentence }, null))}\n\n`);
  }
  lines.push(`data: ${JSON.stringify(make({}, 'stop'))}\n\n`, 'data: [DONE]\n\n');
  return lines;
}

export function sseResponse(text: string): Response {
  const encoder = new TextEncoder();
  const lines = chunkLines(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
