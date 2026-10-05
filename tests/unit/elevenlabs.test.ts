import { describe, expect, it, vi } from 'vitest';
import {
  ElevenLabsSpeechTokens,
  ElevenLabsSynthesizer,
  TTS_MODEL,
} from '@/lib/adapters/elevenlabs';
import { silentWav } from '@/lib/adapters/fakes';

describe('ElevenLabsSpeechTokens', () => {
  it('requests a realtime_scribe single-use token with the API key', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ token: 'sutkn_abc' }), { status: 200 }));
    const tokens = new ElevenLabsSpeechTokens({ apiKey: 'secret', fetchImpl });
    const result = await tokens.createScribeToken();
    expect(result.token).toBe('sutkn_abc');
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe');
    expect(init.method).toBe('POST');
    expect(init.headers['xi-api-key']).toBe('secret');
  });

  it('throws without leaking the key when the request fails or has no token', async () => {
    const failing = new ElevenLabsSpeechTokens({
      apiKey: 'secret',
      fetchImpl: vi.fn().mockResolvedValue(new Response('no', { status: 401 })),
    });
    await expect(failing.createScribeToken()).rejects.toThrow(/401/);
    const empty = new ElevenLabsSpeechTokens({
      apiKey: 'secret',
      fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    });
    await expect(empty.createScribeToken()).rejects.toThrow(/no token/);
  });
});

describe('ElevenLabsSynthesizer', () => {
  it('streams Flash audio for the configured voice', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const synth = new ElevenLabsSynthesizer({ apiKey: 'secret', voiceId: 'voice 1', fetchImpl });
    const out = await synth.synthesize('Hello there');
    expect(out.contentType).toBe('audio/mpeg');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/text-to-speech/voice%201/stream');
    expect(url).toContain('output_format=mp3_44100_64');
    expect(JSON.parse(init.body)).toEqual({ text: 'Hello there', model_id: TTS_MODEL });
    const chunks: number[] = [];
    const reader = out.stream.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(...r.value);
    expect(chunks).toEqual([1, 2, 3]);
  });

  it('throws when the service refuses', async () => {
    const synth = new ElevenLabsSynthesizer({
      apiKey: 'k',
      voiceId: 'v',
      fetchImpl: vi.fn().mockResolvedValue(new Response('x', { status: 429 })),
    });
    await expect(synth.synthesize('hi')).rejects.toThrow(/429/);
  });
});

describe('silentWav', () => {
  it('produces a well-formed WAV header', () => {
    const wav = silentWav(100, 8000);
    const text = (a: number, b: number) => String.fromCharCode(...wav.slice(a, b));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 12)).toBe('WAVE');
    expect(text(36, 40)).toBe('data');
    expect(wav.length).toBe(44 + 800 * 2);
  });
});
