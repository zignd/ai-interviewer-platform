import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { GATE_COOKIE, gateToken } from '../../lib/gate';

/** A complete typed interview on the deployed site, with the real models (set LIVE_BASE_URL). Not part of CI. */
const BASE = process.env.LIVE_BASE_URL;

const ANSWERS = [
  'At my last company our checkout page was slow because it fetched far too much data on every render. I profiled it, found three components re-rendering on every keystroke, moved the state down and cached the API response, which cut load time from four seconds to under one.',
  'I measured it with the React Profiler and Lighthouse. Commits dropped from about forty to twelve per interaction, and I added a regression test so it would not creep back. The team adopted the profiling checklist afterwards.',
  'The hardest part was convincing the team to migrate gradually instead of rewriting everything. I wrote a short guide, paired with two colleagues on the first screens, and we shipped the migration in three small steps over six weeks.',
  'We had a disagreement with design about an animated dropdown that failed keyboard users. I showed the problem with a screen reader, proposed a simpler pattern, and we agreed to test both with five users before deciding.',
  'After a release broke the login for Safari users I rolled back within ten minutes, wrote a post-mortem, and added a cross-browser smoke test to the pipeline so the same class of bug is caught before shipping.',
];

test.describe('deployed site', () => {
  test.skip(!BASE || !process.env.OPENROUTER_API_KEY, 'set LIVE_BASE_URL');

  test('a typed interview ends with 6+ questions, 2+ follow-ups, a transcript and a structured evaluation', async ({
    page,
    context,
  }) => {
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
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(3);
    await page.getByRole('button', { name: 'Answer by typing for Frontend Engineer' }).click();
    await expect(page.getByTestId('current-question')).toContainText(
      'Hello, and thanks for making the time',
      { timeout: 30_000 },
    );

    const questions: string[] = [];
    for (let i = 0; i < 12 && !/\/sessions\//.test(page.url()); i++) {
      questions.push((await page.getByTestId('current-question').textContent()) ?? '');
      await page.getByLabel('Your answer').fill(ANSWERS[i % ANSWERS.length]);
      await page.getByRole('button', { name: 'Send answer' }).click();
      await Promise.race([
        page.waitForURL(/\/sessions\//, { timeout: 60_000 }).catch(() => undefined),
        expect(page.getByLabel('Your answer'))
          .toHaveValue('', { timeout: 60_000 })
          .catch(() => undefined),
      ]);
    }
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByRole('img', { name: /Overall score \d+ out of 100/ })).toBeVisible({
      timeout: 90_000,
    });

    const transcript = page.getByTestId('transcript');
    expect(await transcript.getByText(/^Question \d+$/).count()).toBeGreaterThanOrEqual(6);
    const followUps = await transcript.getByText('Follow-up', { exact: true }).count();
    expect(followUps).toBeGreaterThanOrEqual(2);
    await page.getByText('Show raw evaluation JSON').click();
    const evaluation = JSON.parse(
      (await page.getByTestId('evaluation-json').textContent()) ?? '{}',
    );
    expect(typeof evaluation.overall_score).toBe('number');
    expect(evaluation.strengths.length).toBeGreaterThan(0);
    expect(Array.isArray(evaluation.concerns)).toBe(true);
    console.log(
      `questions asked: ${questions.length}, follow-ups: ${followUps}, score: ${evaluation.overall_score}, recommendation: ${evaluation.recommendation}`,
    );
    console.log(questions.map((q, i) => `  Q${i + 1}: ${q.slice(0, 140)}`).join('\n'));
  });
});
