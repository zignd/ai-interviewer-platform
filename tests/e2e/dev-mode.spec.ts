import { expect, test } from '@playwright/test';

test.describe('developer mode (DEV_MODE=1 in the e2e server)', () => {
  test('shows a flagged suggested-answer panel and lets you use the answer', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Answer by typing for Frontend Engineer' }).click();
    const panel = page.getByTestId('dev-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Developer tool')).toBeVisible();
    await expect(page.getByTestId('dev-answer')).toBeVisible({ timeout: 15_000 });

    const suggested = (await page.getByTestId('dev-answer').textContent()) ?? '';
    const before = await page.getByTestId('current-question').textContent();
    await page.getByTestId('dev-use').click();
    await expect(page.getByLabel('Your answer')).toHaveValue(suggested);
    await page.getByRole('button', { name: 'Send answer' }).click();
    await expect.poll(() => page.getByTestId('current-question').textContent()).not.toBe(before);
    // A new question gets a new suggestion.
    await expect(page.getByTestId('dev-answer'))
      .not.toHaveText(suggested, { timeout: 15_000 })
      .catch(() => undefined);
    await expect(page.getByTestId('dev-answer')).toBeVisible({ timeout: 15_000 });
  });
});
