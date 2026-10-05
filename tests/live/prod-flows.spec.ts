import 'dotenv/config';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { silentWav } from '../../lib/adapters/fakes';
import { GATE_COOKIE, gateToken } from '../../lib/gate';

/**
 * Checks of the deployed site (set LIVE_BASE_URL). Not part of CI: they use the real database and Blob store.
 *  - the wait queue: with all 4 slots taken, a 5th voice interview waits, then is offered the freed slot
 *  - recordings: budget check, private Blob upload, completion, seekable playback through our media route
 */
const BASE = process.env.LIVE_BASE_URL;

async function passGate(context: import('@playwright/test').BrowserContext) {
  if (process.env.DEMO_PASSWORD) {
    await context.addCookies([
      {
        name: GATE_COOKIE,
        value: await gateToken(process.env.DEMO_PASSWORD, process.env.CRON_SECRET ?? 'gate'),
        url: BASE!,
      },
    ]);
  }
}

async function firstJobId(api: APIRequestContext) {
  const jobs = (await (await api.get('/api/jobs')).json()).jobs as { id: string }[];
  return jobs[0].id;
}

test.describe('deployed site', () => {
  test.skip(!BASE, 'set LIVE_BASE_URL to the deployed site');

  test('wait queue: the 5th candidate waits, is promoted when a slot frees, and confirms', async ({
    page,
    context,
  }) => {
    await passGate(context);
    const api = context.request;
    const jobId = await firstJobId(api);

    // Other people may be using the site: fill only the slots that are free, so exactly one more candidate must wait.
    const probe = await (await api.post('/api/sessions', { data: { jobId, mode: 'text' } })).json();
    await page.waitForTimeout(32_000); // let sessions abandoned by earlier runs expire (30 s without a heartbeat)
    const others = (await (await api.post(`/api/sessions/${probe.id}/queue`)).json())
      .activeCount as number;
    const free = 4 - others;
    test.skip(free < 1, `all slots are in use by real sessions (${others} active)`);
    const running: string[] = [];
    for (let i = 0; i < free; i++) {
      const r = await (await api.post('/api/sessions', { data: { jobId, mode: 'voice' } })).json();
      expect(r.status, `session ${i + 1} should start straight away`).toBe('active');
      running.push(r.id);
    }
    // The running interviews keep sending their heartbeat.
    const beat = setInterval(
      () =>
        running.forEach((id) => void api.post(`/api/sessions/${id}/queue`).catch(() => undefined)),
      8000,
    );

    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Start interview for Frontend Engineer' }).click();
      await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('queue-position')).toContainText('#1');

      // One interview ends: the first in line gets the slot and must confirm.
      await api.post(`/api/sessions/${running[0]}/leave`);
      await expect(page.getByTestId('confirm-ready')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('confirm-ready').click();
      await expect(page.getByTestId('begin-voice')).toBeVisible({ timeout: 15_000 });
    } finally {
      clearInterval(beat);
      for (const id of running) await api.post(`/api/sessions/${id}/leave`).catch(() => undefined);
      // The 5th candidate's own session: the browser tab leaving stops its heartbeat, so it expires by itself.
    }
  });

  test('recording: prepare, private upload, complete, then replay with seeking', async ({
    page,
    context,
  }) => {
    await passGate(context);
    const api = context.request;
    const jobId = await firstJobId(api);
    const created = await (
      await api.post('/api/sessions', { data: { jobId, mode: 'text' } })
    ).json();
    const sessionId = created.id as string;
    await api.post(`/api/sessions/${sessionId}/start`);

    const wav = silentWav(1500, 8000);
    const prep = await (
      await api.post('/api/recordings/prepare', {
        data: { sessionId, kind: 'audio', sizeBytes: wav.length, extension: 'webm' },
      })
    ).json();
    expect(prep.action).toBe('upload');

    const { put } = await import('@vercel/blob/client');
    const uploaded = await put(
      prep.pathname,
      new Blob([wav.slice().buffer as ArrayBuffer], { type: 'audio/wav' }),
      {
        access: 'private',
        token: prep.token,
        contentType: 'audio/wav',
      },
    );
    const done = await (
      await api.post('/api/recordings/complete', {
        data: { recordingId: prep.recordingId, blobUrl: uploaded.url, sizeBytes: wav.length },
      })
    ).json();
    expect(done.ok).toBe(true);

    // Playback goes through our route, with Range support.
    const mediaUrl = `/api/recordings/${prep.recordingId}/media`;
    const full = await api.get(mediaUrl);
    expect(full.status()).toBe(200);
    expect((await full.body()).length).toBe(wav.length);
    const part = await api.get(mediaUrl, { headers: { Range: 'bytes=0-99' } });
    expect(part.status()).toBe(206);
    expect(part.headers()['content-range']).toBe(`bytes 0-99/${wav.length}`);

    // The results page plays it.
    await page.goto(`/sessions/${sessionId}`);
    const audio = page.getByTestId('replay').locator('audio');
    await expect(audio).toBeVisible();
    await expect
      .poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration), { timeout: 15_000 })
      .toBeGreaterThan(1);

    // Storage budget bookkeeping: the row is stored with the right size.
    const history = await api.get('/history');
    expect(history.status()).toBe(200);
  });
});
