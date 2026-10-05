import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { GATE_COOKIE, gateToken } from '../../lib/gate';

/**
 * Video mode on the deployed site with the app's own recorder (set LIVE_BASE_URL). Not part of CI.
 * Chromium's fake camera provides the video; a synthetic tone stands in for the microphone.
 * Checks: consent, call layout, recording, private upload at the end, and replay on the results page.
 */
const BASE = process.env.LIVE_BASE_URL;

const ANSWER =
  'On my last project the checkout page was slow because it fetched too much data on every render. I profiled it, moved the state down and cached the API response, which cut the load time from four seconds to one, and I added a regression test.';

test('video interview: recorded in the browser, uploaded privately, replayed on the results page', async ({
  page,
  context,
}) => {
  test.skip(!BASE || !process.env.OPENROUTER_API_KEY, 'set LIVE_BASE_URL');
  test.setTimeout(420_000);
  if (process.env.DEMO_PASSWORD) {
    await context.addCookies([
      {
        name: GATE_COOKIE,
        value: await gateToken(process.env.DEMO_PASSWORD, process.env.CRON_SECRET ?? 'gate'),
        url: BASE!,
      },
    ]);
  }

  // Fake camera video + a tone as the microphone, in one stream.
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.02;
    const destination = ctx.createMediaStreamDestination();
    osc.connect(gain).connect(destination);
    osc.start();
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      void ctx.resume();
      const c = constraints as MediaStreamConstraints;
      if (c?.video) {
        const cam = await original({ video: c.video });
        return new MediaStream([
          ...cam.getVideoTracks(),
          ...(c.audio ? destination.stream.getAudioTracks() : []),
        ]);
      }
      return new MediaStream(destination.stream.getAudioTracks());
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Start video interview for Frontend Engineer' }).click();
  await expect(page.getByTestId('recording-consent')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('start-with-recording').click();
  await expect(page.getByTestId('video-stage')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('self-view')).toBeVisible({ timeout: 20_000 });

  const begin = page.getByTestId('begin-voice');
  if (await begin.isVisible().catch(() => false)) await begin.click();

  // Answer by typing to keep the run short; the recorder keeps running the whole time.
  const phase = page.getByTestId('voice-phase');
  for (let i = 0; i < 12 && !/\/sessions\//.test(page.url()); i++) {
    const reached = await Promise.race([
      expect(phase)
        .toHaveAttribute('data-phase', 'listening', { timeout: 90_000 })
        .then(() => 'listening' as const),
      page.waitForURL(/\/sessions\//, { timeout: 90_000 }).then(() => 'results' as const),
    ]);
    if (reached === 'results') break;
    // The typing box closes after every answer, so open it again when needed.
    const toggle = page.getByRole('button', { name: /Prefer to type/ });
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
    await page.getByLabel('Type your answer').fill(ANSWER);
    await page.getByRole('button', { name: 'Send answer' }).click();
    await expect(phase).not.toHaveAttribute('data-phase', 'listening', { timeout: 30_000 });
  }

  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const sessionId = page.url().match(/sessions\/([0-9a-f-]{36})/)![1];

  // The upload happens as the interview ends; the replay appears once the recording is stored.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('replay')).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 90_000, intervals: [4000] });

  const video = page.getByTestId('replay').locator('video, audio');
  await expect
    .poll(() => video.evaluate((m: HTMLMediaElement) => m.readyState), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1);
  const src = await video.getAttribute('src');
  expect(src).toMatch(/^\/api\/recordings\/[0-9a-f-]{36}\/media$/);
  const res = await page.request.get(src!, { headers: { Range: 'bytes=0-1023' } });
  expect(res.status()).toBe(206);
  console.log(
    `session ${sessionId}: recording replayed from ${src}, ${res.headers()['content-range']}, type ${res.headers()['content-type']}`,
  );
  expect(errors).toEqual([]);
});
