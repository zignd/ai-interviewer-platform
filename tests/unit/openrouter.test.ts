import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenRouterClient, extractJson } from '@/lib/adapters/openrouter';
import type { LlmRequest } from '@/lib/ports';

const schema = z.object({ ok: z.boolean() });
const request: LlmRequest<{ ok: boolean }> = {
  task: 'analyze',
  input: {},
  prompt: { system: 's', user: 'u' },
  model: 'm',
  temperature: 0,
  schema,
  reasoningEffort: 'minimal',
};

const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe('extractJson', () => {
  it('parses plain JSON, fenced JSON and JSON with chatter', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! Here you go: {"a":3} hope that helps')).toEqual({ a: 3 });
  });
  it('throws when there is no object', () => {
    expect(() => extractJson('nothing here')).toThrow(/No JSON/);
  });
});

describe('OpenRouterClient', () => {
  it('sends the key, model and reasoning effort, and returns validated JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('{"ok":true}'));
    const client = new OpenRouterClient({ apiKey: 'secret', fetchImpl });
    await expect(client.complete(request)).resolves.toEqual({ ok: true });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('m');
    expect(body.reasoning).toEqual({ effort: 'minimal' });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('repairs once when the JSON does not match the schema', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(reply('{"ok":"yes"}'))
      .mockResolvedValueOnce(reply('{"ok":true}'));
    const client = new OpenRouterClient({ apiKey: 'k', fetchImpl });
    await expect(client.complete(request)).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body as string).messages[1].content).toContain(
      'invalid',
    );
  });

  it('retries once when the reply is not JSON', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(reply('I cannot'))
      .mockResolvedValueOnce(reply('{"ok":false}'));
    const client = new OpenRouterClient({ apiKey: 'k', fetchImpl });
    await expect(client.complete(request)).resolves.toEqual({ ok: false });
  });

  it('gives up after the repair attempt fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('{"ok":"nope"}'));
    const client = new OpenRouterClient({ apiKey: 'k', fetchImpl });
    await expect(client.complete(request)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries without reasoning when the model rejects the option', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Reasoning is mandatory for this endpoint', { status: 400 }),
      )
      .mockResolvedValueOnce(reply('{"ok":true}'));
    const client = new OpenRouterClient({ apiKey: 'k', fetchImpl });
    await expect(client.complete(request)).resolves.toEqual({ ok: true });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body as string).reasoning).toBeUndefined();
  });

  it('surfaces HTTP errors without leaking the key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    const client = new OpenRouterClient({ apiKey: 'super-secret', fetchImpl });
    await expect(client.complete(request)).rejects.toThrow(/OpenRouter 500/);
    await client
      .complete(request)
      .catch((e: Error) => expect(e.message).not.toContain('super-secret'));
  });
});
