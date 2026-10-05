import { expect, test } from '@playwright/test';
import { ANSWER } from './helpers';

test.describe('text interview, job to results', () => {
  test('home lists at least three roles with a title and description', async ({ page }) => {
    await page.goto('/');
    const cards = page.getByRole('heading', { level: 2 });
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'Frontend Engineer' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data Analyst' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Customer Success Manager' })).toBeVisible();
    await expect(page.getByText(/Build fast, accessible/)).toBeVisible();
  });

  test('a full interview asks 6+ questions with 2+ follow-ups and ends with a transcript and evaluation', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Answer by typing for Frontend Engineer' }).click();
    await expect(page).toHaveURL(/\/interview\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('current-question')).toContainText(
      'Hello, and thanks for making the time',
    );

    // Keep answering until the interview sends us to the results page.
    for (let i = 0; i < 12; i++) {
      if (/\/sessions\//.test(page.url())) break;
      await page.getByLabel('Your answer').fill(ANSWER);
      await page.getByRole('button', { name: 'Send answer' }).click();
      await Promise.race([
        page.waitForURL(/\/sessions\//, { timeout: 15_000 }).catch(() => undefined),
        expect(page.getByLabel('Your answer'))
          .toHaveValue('', { timeout: 15_000 })
          .catch(() => undefined),
      ]);
    }

    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Full transcript')).toBeVisible();
    await expect(page.getByRole('img', { name: /Overall score \d+ out of 100/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: 'Strengths' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Concerns' })).toBeVisible();

    const transcript = page.getByTestId('transcript');
    const questions = transcript.getByText(/^Question \d+$/);
    expect(await questions.count()).toBeGreaterThanOrEqual(6);
    expect(await transcript.getByText('Follow-up', { exact: true }).count()).toBeGreaterThanOrEqual(
      2,
    );

    await page.getByText('Show raw evaluation JSON').click();
    const raw = await page.getByTestId('evaluation-json').textContent();
    const parsed = JSON.parse(raw ?? '{}');
    expect(typeof parsed.overall_score).toBe('number');
    expect(Array.isArray(parsed.strengths)).toBe(true);
    expect(Array.isArray(parsed.concerns)).toBe(true);
  });

  test('an unknown session shows a not found page', async ({ page }) => {
    const res = await page.goto('/sessions/00000000-0000-4000-8000-000000000000');
    expect(res?.status()).toBe(404);
  });
});
