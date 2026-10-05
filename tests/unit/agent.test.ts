import { describe, expect, it } from 'vitest';
import { APOLOGY, agentRequestSchema, lastUserText } from '@/lib/agent/handler';
import { chunkLines, splitSentences, sseResponse } from '@/lib/agent/sse';

describe('splitSentences', () => {
  it('splits into sentence-sized pieces and keeps every character', () => {
    const text = 'Tell me about a project. What went wrong? And what did you change!';
    const parts = splitSentences(text);
    expect(parts).toHaveLength(3);
    expect(parts.join('')).toBe(text);
  });
  it('keeps text without punctuation as one piece', () => {
    expect(splitSentences('no punctuation here')).toEqual(['no punctuation here']);
  });
});

describe('chunkLines', () => {
  it('produces OpenAI chat.completion.chunk events ending with a stop chunk and [DONE]', () => {
    const lines = chunkLines('One. Two.', 'id-1', 1700000000);
    expect(lines.at(-1)).toBe('data: [DONE]\n\n');
    const events = lines.slice(0, -1).map((l) => JSON.parse(l.replace(/^data: /, '').trim()));
    expect(events[0].choices[0].delta.role).toBe('assistant');
    expect(events.every((e) => e.object === 'chat.completion.chunk' && e.id === 'id-1')).toBe(true);
    expect(
      events
        .slice(1, -1)
        .map((e) => e.choices[0].delta.content)
        .join(''),
    ).toBe('One. Two.');
    expect(events.at(-1).choices[0].finish_reason).toBe('stop');
    expect(lines.every((l) => l.endsWith('\n\n'))).toBe(true);
  });

  it('streams as text/event-stream', async () => {
    const res = sseResponse('Hello there.');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await res.text();
    expect(body).toContain('"content":"Hello there."');
    expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });
});

describe('lastUserText', () => {
  it('returns the latest user message, handling string and array content', () => {
    expect(
      lastUserText([
        { role: 'system', content: 's' },
        { role: 'user', content: ' first ' },
        { role: 'assistant', content: 'q' },
        { role: 'user', content: ' second answer ' },
      ]),
    ).toBe('second answer');
    expect(
      lastUserText([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'array' },
            { type: 'text', text: 'content' },
          ],
        },
      ]),
    ).toBe('array content');
    expect(lastUserText([{ role: 'system', content: 's' }])).toBe('');
  });
});

describe('agentRequestSchema', () => {
  const sessionId = '00000000-0000-4000-8000-000000000000';
  it('requires messages and a session id in the extra body', () => {
    expect(
      agentRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'x' }],
        elevenlabs_extra_body: { session_id: sessionId },
      }).success,
    ).toBe(true);
    expect(
      agentRequestSchema.safeParse({ messages: [{ role: 'user', content: 'x' }] }).success,
    ).toBe(false);
    expect(
      agentRequestSchema.safeParse({
        messages: [],
        elevenlabs_extra_body: { session_id: sessionId },
      }).success,
    ).toBe(false);
    expect(
      agentRequestSchema.safeParse({
        messages: [{ role: 'user' }],
        elevenlabs_extra_body: { session_id: 'nope' },
      }).success,
    ).toBe(false);
  });
  it('has a friendly apology', () => {
    expect(APOLOGY.length).toBeGreaterThan(10);
  });
});
