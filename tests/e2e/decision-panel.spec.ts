import { expect, test } from '@playwright/test';
import { ANSWER } from './helpers';

const SHALLOW = 'I fixed it quickly and it worked fine.';

test.describe('decision panel', () => {
  test('shows why each question was chosen, skills, topic coverage, gaps and the follow-up rule', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Answer by typing for Frontend Engineer' }).click();
    const panel = page.getByRole('complementary', { name: 'Decision panel' });
    await expect(panel).toBeVisible();

    // Opening question: reasoning and the full topic checklist are visible straight away.
    await expect(panel.getByTestId('decision-reason')).toContainText('Opening question');
    await expect(panel.getByTestId('decision-topics').getByRole('listitem')).toHaveCount(8);
    await expect(panel.getByText('Topics covered (1 of 8)')).toBeVisible();
    await expect(panel.locator('[data-status="current"]')).toHaveCount(1);

    // A shallow answer: the panel explains the follow-up and lists gaps.
    const first = await page.getByTestId('current-question').textContent();
    await page.getByLabel('Your answer').fill(SHALLOW);
    await page.getByRole('button', { name: 'Send answer' }).click();
    await expect.poll(() => page.getByTestId('current-question').textContent()).not.toBe(first);
    await expect(panel.getByTestId('decision-reason')).toContainText('shallow');
    await expect(panel.getByText('Shallow answer', { exact: true })).toBeVisible();
    await expect(panel.getByText(/Built on your words/)).toBeVisible();
    await expect(panel.getByTestId('decision-gaps')).toContainText('A concrete example');

    // A detailed answer: skills with evidence show up.
    const second = await page.getByTestId('current-question').textContent();
    await page.getByLabel('Your answer').fill(ANSWER + ' We used React and TypeScript throughout.');
    await page.getByRole('button', { name: 'Send answer' }).click();
    await expect.poll(() => page.getByTestId('current-question').textContent()).not.toBe(second);
    await expect(panel.getByTestId('decision-skills')).toContainText('React');
    await expect(panel.getByText(/Follow-ups: \d of 2 required/)).toBeVisible();
  });

  test('can be hidden and shown again', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Answer by typing for Data Analyst' }).click();
    await expect(page.getByRole('complementary', { name: 'Decision panel' })).toBeVisible();
    await page.getByRole('button', { name: 'Hide decision panel' }).click();
    await expect(page.getByRole('complementary', { name: 'Decision panel' })).toBeHidden();
    await page.getByRole('button', { name: 'Show decision panel' }).click();
    await expect(page.getByRole('complementary', { name: 'Decision panel' })).toBeVisible();
  });

  test('the forced follow-up is explained when the minimum requires it', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Answer by typing for Customer Success Manager' })
      .click();
    const panel = page.getByRole('complementary', { name: 'Decision panel' });
    // Strong, hook-free answers never trigger a normal follow-up, so the floor must.
    const strong = Array(80).fill('detail').join(' ') + '.';
    let sawForced = false;
    for (let i = 0; i < 8 && !sawForced; i++) {
      const before = await page.getByTestId('current-question').textContent();
      await page.getByLabel('Your answer').fill(strong);
      await page.getByRole('button', { name: 'Send answer' }).click();
      await expect
        .poll(() => page.getByTestId('current-question').textContent(), { timeout: 15_000 })
        .not.toBe(before);
      sawForced = await panel.getByText('Required by the follow-up minimum').isVisible();
    }
    expect(sawForced).toBe(true);
    await expect(panel.getByTestId('decision-reason')).toContainText('Follow-up floor');
  });
});

test('the results page explains each question', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Answer by typing for Frontend Engineer' }).click();
  for (let i = 0; i < 12 && !/\/sessions\//.test(page.url()); i++) {
    await page.getByLabel('Your answer').fill(ANSWER);
    await page.getByRole('button', { name: 'Send answer' }).click();
    await Promise.race([
      page.waitForURL(/\/sessions\//, { timeout: 15_000 }).catch(() => undefined),
      expect(page.getByLabel('Your answer'))
        .toHaveValue('', { timeout: 15_000 })
        .catch(() => undefined),
    ]);
  }
  await expect(page).toHaveURL(/\/sessions\//);
  const why = page.getByTestId('transcript').getByText('Why this question?');
  expect(await why.count()).toBeGreaterThanOrEqual(7);
  await why.first().click();
  await expect(page.getByText(/Opening question/).first()).toBeVisible();
});
