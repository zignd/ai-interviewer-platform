import { expect, type Page } from '@playwright/test';

export const ANSWER =
  'On my last project we had a checkout page that became slow because we fetched too much data on every render. ' +
  'I profiled it with the browser tools, found that three components re-rendered on every keystroke, and moved the state down. ' +
  'However, the real win came from caching the API response, which cut the load time from four seconds to under one. ' +
  'I then added a regression test and documented the decision for the team.';

/** Answers the current question and waits for the next one (or the results page). */
export async function answerCurrentQuestion(page: Page, text = ANSWER) {
  const before = await page.getByTestId('current-question').textContent();
  await page.getByLabel('Your answer').fill(text);
  await page.getByRole('button', { name: 'Send answer' }).click();
  await expect
    .poll(
      async () =>
        (await page
          .getByTestId('current-question')
          .textContent()
          .catch(() => null)) ?? '__done__',
      { timeout: 20_000 },
    )
    .not.toBe(before ?? '');
}
