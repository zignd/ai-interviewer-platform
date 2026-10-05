import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { GATE_COOKIE, gateToken } from '../../lib/gate';

/** Synthesizes speech with ElevenLabs and returns 16 kHz mono PCM as base64. */
async function speak(text: string): Promise<string> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/stream?output_format=pcm_16000`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
    },
  );
  if (!res.ok) throw new Error(`TTS failed ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

const ANSWERS = [
  'In my last job I rebuilt our dashboard state management. We moved server data into React Query and kept form state local, which made the code far easier to follow.',
  'I measured it with the React Profiler. Commits on the list view dropped from about forty to twelve per interaction, and I added a regression test for it.',
  'The hardest part was convincing the team to migrate gradually, so I wrote a short guide and paired with two colleagues on the first screens.',
];

test('real browser pipeline: spoken answer, live captions, real Scribe, real models, spoken question', async ({
  page,
}) => {
  test.skip(
    !process.env.ELEVENLABS_API_KEY || !process.env.OPENROUTER_API_KEY,
    'needs real API keys',
  );
  const audio = await Promise.all(ANSWERS.map(speak));

  // Against a deployed site, pass the demo password gate the same way the gate page would.
  if (process.env.LIVE_BASE_URL && process.env.DEMO_PASSWORD) {
    await page.context().addCookies([
      {
        name: GATE_COOKIE,
        value: await gateToken(process.env.DEMO_PASSWORD, process.env.CRON_SECRET ?? 'gate'),
        url: process.env.LIVE_BASE_URL,
      },
    ]);
  }

  // Replace the microphone with a stream that plays the synthesized answers, one per listening round.
  await page.addInitScript((answers: string[]) => {
    let round = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      const bytes = Uint8Array.from(atob(answers[Math.min(round++, answers.length - 1)]), (c) =>
        c.charCodeAt(0),
      );
      const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
      const ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.resume();
      const buffer = ctx.createBuffer(1, pcm.length, 16000);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const destination = ctx.createMediaStreamDestination();
      source.connect(destination);
      source.start(ctx.currentTime + 0.3);
      return destination.stream;
    };
  }, audio);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on(
    'console',
    (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()),
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Start interview for Frontend Engineer' }).click();
  await page.getByTestId('begin-voice').click();

  const phase = page.getByTestId('voice-phase');
  const caption = page.getByTestId('live-caption');
  const timings: string[] = [];
  const rounds = process.env.LIVE_FULL ? 12 : ANSWERS.length;
  for (let round = 0; round < rounds; round++) {
    if (/\/sessions\//.test(page.url())) break;
    const reached = await Promise.race([
      expect(phase)
        .toHaveAttribute('data-phase', 'listening', { timeout: 60_000 })
        .then(() => 'listening' as const),
      page.waitForURL(/\/sessions\//, { timeout: 60_000 }).then(() => 'results' as const),
    ]);
    if (reached === 'results') break;
    // Live captions come from the real Scribe service.
    await expect(caption).not.toContainText('Listening…', { timeout: 30_000 });

    // Track when the transcript last changed, to measure from "candidate stopped talking".
    let lastText = '';
    let lastChange = Date.now();
    const started = Date.now();
    while (
      (await phase.getAttribute('data-phase')) === 'listening' &&
      Date.now() - started < 60_000
    ) {
      const text = (await caption.textContent()) ?? '';
      if (text !== lastText) {
        lastText = text;
        lastChange = Date.now();
      }
      await page.waitForTimeout(50);
    }
    const thinkingAt = Date.now();
    await expect(phase).toHaveAttribute('data-phase', 'speaking', { timeout: 60_000 });
    const speakingAt = Date.now();
    const sec = (ms: number) => (ms / 1000).toFixed(1) + 's';
    timings.push(
      `round ${round + 1}: heard "${lastText.slice(0, 50)}…" | silence wait ${sec(thinkingAt - lastChange)} + model/server ${sec(speakingAt - thinkingAt)} = ${sec(speakingAt - lastChange)} from last word to the next question being spoken`,
    );
    expect(lastText.toLowerCase()).toMatch(/react|state|profiler|team|guide|dashboard/);
  }
  console.log(timings.join('\n'));
  expect(errors).toEqual([]);
});
