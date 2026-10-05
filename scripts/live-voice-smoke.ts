/**
 * Live voice smoke test (not part of CI): real ElevenLabs calls.
 *  1. mints a Scribe single-use token through our adapter
 *  2. synthesizes a sentence with Flash (PCM) through the same API we use for questions
 *  3. streams that audio into Scribe v2 Realtime with manual commit and keyterms, like the browser does
 *  4. checks that the committed transcript matches what was spoken
 * Run with `npm run smoke:voice`.
 */
import 'dotenv/config';
import { AudioFormat, CommitStrategy, RealtimeEvents, Scribe } from '@elevenlabs/client';
import { ElevenLabsSpeechTokens, TTS_MODEL } from '../lib/adapters/elevenlabs';

const SENTENCE =
  'I moved server data into React Query, kept form state local, and used the Profiler to measure the render count.';

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId)
    throw new Error('ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set');

  const t0 = Date.now();
  const { token } = await new ElevenLabsSpeechTokens({ apiKey }).createScribeToken();
  console.log(`token minted in ${Date.now() - t0} ms`);

  const t1 = Date.now();
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=pcm_16000`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: SENTENCE, model_id: TTS_MODEL }),
    },
  );
  if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
  const pcm = Buffer.from(await res.arrayBuffer());
  console.log(`synthesized ${(pcm.length / 32000).toFixed(1)} s of audio in ${Date.now() - t1} ms`);

  const connection = Scribe.connect({
    token,
    modelId: 'scribe_v2_realtime',
    audioFormat: AudioFormat.PCM_16000,
    sampleRate: 16000,
    commitStrategy: CommitStrategy.MANUAL,
    keyterms: ['React Query', 'Profiler'],
  });

  const result = await new Promise<{
    text: string;
    partials: number;
    firstPartialMs: number;
    commitMs: number;
  }>((resolve, reject) => {
    let partials = 0;
    let firstPartialMs = -1;
    const start = Date.now();
    let commitAt = 0;
    const timer = setTimeout(
      () => reject(new Error('timed out waiting for the committed transcript')),
      30_000,
    );
    connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, () => {
      partials++;
      if (firstPartialMs < 0) firstPartialMs = Date.now() - start;
    });
    connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (d) => {
      clearTimeout(timer);
      resolve({ text: d.text, partials, firstPartialMs, commitMs: Date.now() - commitAt });
    });
    connection.on(RealtimeEvents.ERROR, (e) =>
      reject(new Error(`Scribe error: ${JSON.stringify(e)}`)),
    );
    connection.on(RealtimeEvents.AUTH_ERROR, (e) =>
      reject(new Error(`Scribe auth error: ${JSON.stringify(e)}`)),
    );
    connection.on(RealtimeEvents.SESSION_STARTED, async () => {
      const chunk = 3200; // 100 ms of 16 kHz 16-bit mono
      for (let i = 0; i < pcm.length; i += chunk) {
        connection.send({ audioBase64: pcm.subarray(i, i + chunk).toString('base64') });
        await new Promise((r) => setTimeout(r, 40));
      }
      commitAt = Date.now();
      connection.commit();
    });
  });
  connection.close();

  console.log(
    `first partial after ${result.firstPartialMs} ms, ${result.partials} partials, commit returned in ${result.commitMs} ms`,
  );
  console.log('spoken:    ', SENTENCE);
  console.log('transcript:', result.text);
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const expected = norm(SENTENCE).split(' ');
  const got = new Set(norm(result.text).split(' '));
  const matched = expected.filter((w) => got.has(w)).length / expected.length;
  console.log(`word match: ${(matched * 100).toFixed(0)}%`);
  if (matched < 0.85)
    throw new Error('transcript does not match the spoken sentence closely enough');
  console.log('\nLive voice smoke test passed.');
}

main().catch((err) => {
  console.error('\nLive voice smoke test FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
