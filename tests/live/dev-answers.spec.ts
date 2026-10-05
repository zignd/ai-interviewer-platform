import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { GATE_COOKIE, gateToken } from '../../lib/gate';

/** Developer mode on the deployed site: answering only with the suggested answers should score well. */
const BASE = process.env.LIVE_BASE_URL;

test('suggested answers earn a high score on the deployed site', async ({ context }) => {
  test.skip(!BASE, 'set LIVE_BASE_URL');
  test.setTimeout(300_000);
  if (process.env.DEMO_PASSWORD) {
    await context.addCookies([
      {
        name: GATE_COOKIE,
        value: await gateToken(process.env.DEMO_PASSWORD, process.env.CRON_SECRET ?? 'gate'),
        url: BASE!,
      },
    ]);
  }
  const api = context.request;
  const jobs = (await (await api.get('/api/jobs')).json()).jobs as { id: string; slug: string }[];
  const job = jobs.find((j) => j.slug === 'frontend-engineer')!;
  const { id } = await (
    await api.post('/api/sessions', { data: { jobId: job.id, mode: 'text' } })
  ).json();
  await api.post(`/api/sessions/${id}/start`);

  let done = false;
  let turns = 0;
  while (!done && turns++ < 12) {
    const sample = await api.post(`/api/sessions/${id}/dev-answer`);
    expect(sample.status()).toBe(200);
    const { answer } = await sample.json();
    const res = await (
      await api.post(`/api/sessions/${id}/turn`, { data: { transcript: answer } })
    ).json();
    done = res.done;
  }
  const evaluation = await (await api.post(`/api/sessions/${id}/evaluate`)).json();
  console.log(
    `score ${evaluation.overall_score}, ${evaluation.recommendation}: ${evaluation.summary}`,
  );
  expect(evaluation.overall_score).toBeGreaterThanOrEqual(70);
});
