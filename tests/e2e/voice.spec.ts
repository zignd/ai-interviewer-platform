import { expect, test, type Page } from '@playwright/test';

const SPEECH =
  'On my last project we had a checkout page that became slow because we fetched too much data on every render. ' +
  'I profiled it with the browser tools, moved the state down and cached the API response, which cut the load time from four seconds to one. ' +
  'I then added a regression test and documented the decision for the team.';

async function startVoiceInterview(page: Page, role = 'Frontend Engineer') {
  await page.goto('/');
  await page.getByRole('button', { name: `Start interview for ${role}` }).click();
  await expect(page).toHaveURL(/\/interview\/[0-9a-f-]{36}$/);
}

const phase = (page: Page) => page.getByTestId('voice-phase');

/** Answers each question with the fake speech, using "I'm done" unless the answer already ended by silence. */
async function answerUntilResults(page: Page, { autoFinishFirst = false } = {}) {
  for (let turn = 0; turn < 14; turn++) {
    if (/\/sessions\//.test(page.url())) return;
    await Promise.race([
      expect(phase(page)).toHaveAttribute('data-phase', 'listening', { timeout: 20_000 }),
      page.waitForURL(/\/sessions\//, { timeout: 20_000 }),
    ]).catch(() => undefined);
    if (/\/sessions\//.test(page.url())) return;
    await expect(page.getByTestId('live-caption')).toContainText('checkout page', {
      timeout: 10_000,
    });
    if (autoFinishFirst && turn === 0) {
      // No click: the answer must end by itself after a pause.
      await expect(phase(page)).toHaveAttribute('data-phase', /thinking|speaking/, {
        timeout: 15_000,
      });
    } else {
      await page.getByTestId('done-speaking').click();
    }
    await Promise.race([
      expect(phase(page)).toHaveAttribute('data-phase', /speaking|finishing/, { timeout: 20_000 }),
      page.waitForURL(/\/sessions\//, { timeout: 20_000 }),
    ]).catch(() => undefined);
  }
}

test.describe('voice interview', () => {
  test('the microphone stays closed while the interviewer is speaking', async ({ page }) => {
    // Block the spoken question from finishing so we can observe the "speaking" phase.
    await page.route('**/api/sessions/*/tts*', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const tokenRequests: number[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/speech-token')) tokenRequests.push(Date.now());
    });
    await startVoiceInterview(page);
    await page.getByTestId('begin-voice').click();
    await expect(phase(page)).toHaveAttribute('data-phase', 'speaking', { timeout: 15_000 });
    await page.waitForTimeout(800);
    expect(tokenRequests).toHaveLength(0); // no speech connection while the AI talks
    await expect(phase(page)).toHaveAttribute('data-phase', 'listening', { timeout: 15_000 });
    await expect.poll(() => tokenRequests.length).toBe(1);
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((speech) => {
      // The fake transcriber replays this for every answer.
      window.__fakeSpeech = Array.from({ length: 20 }, () => speech);
    }, SPEECH);
  });

  test('a spoken interview ends by itself or on "I\'m done", with 6+ questions and 2+ follow-ups', async ({
    page,
  }) => {
    await startVoiceInterview(page);
    await expect(page.getByTestId('begin-voice')).toBeVisible();
    await page.getByTestId('begin-voice').click();

    await expect(page.getByTestId('current-question')).toContainText(
      'Hello, and thanks for making the time',
    );
    await expect(phase(page)).toHaveAttribute('data-phase', /speaking|listening/);
    await answerUntilResults(page, { autoFinishFirst: true });

    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole('img', { name: /Overall score \d+ out of 100/ })).toBeVisible({
      timeout: 20_000,
    });
    const transcript = page.getByTestId('transcript');
    expect(await transcript.getByText(/^Question \d+$/).count()).toBeGreaterThanOrEqual(6);
    expect(await transcript.getByText('Follow-up', { exact: true }).count()).toBeGreaterThanOrEqual(
      2,
    );
    // The spoken answers are what was saved.
    await expect(transcript.getByText(/checkout page that became slow/).first()).toBeVisible();
  });

  test('shows the live transcript and keeps the answer when the candidate pauses to think', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__fakeSpeech = [
        'I think the answer starts with a profile',
        'second answer words here please',
      ];
    });
    await startVoiceInterview(page);
    await page.getByTestId('begin-voice').click();
    await expect(phase(page)).toHaveAttribute('data-phase', 'listening', { timeout: 15_000 });
    await expect(page.getByTestId('live-caption')).toContainText(
      'I think the answer starts with a profile',
    );
    // Still listening a second later: a short pause does not end the answer.
    await page.waitForTimeout(1000);
    await expect(phase(page)).toHaveAttribute('data-phase', 'listening');
  });

  test('asks again when nothing was heard instead of sending an empty answer', async ({ page }) => {
    await page.addInitScript(() => {
      window.__fakeSpeech = [' ', 'a proper answer with enough words to count'];
    });
    await startVoiceInterview(page);
    await page.getByTestId('begin-voice').click();
    await expect(phase(page)).toHaveAttribute('data-phase', 'listening', { timeout: 15_000 });
    await page.getByTestId('done-speaking').click();
    await expect(page.getByText("I didn't hear anything")).toBeVisible();
    await expect(page.getByTestId('live-caption')).toContainText('a proper answer', {
      timeout: 10_000,
    });
  });

  test('falls back to typing when microphone access is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      window.__fakeMicProbe = true;
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    });
    await startVoiceInterview(page);
    await page.getByTestId('begin-voice').click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Microphone access is blocked' }),
    ).toBeVisible({ timeout: 15_000 });
    const before = await page.getByTestId('current-question').textContent();
    await page.getByLabel('Type your answer').fill(SPEECH);
    await page.getByRole('button', { name: 'Send answer' }).click();
    await expect
      .poll(() => page.getByTestId('current-question').textContent(), { timeout: 15_000 })
      .not.toBe(before);
  });

  test('keeps going with on-screen text when the interviewer voice is unavailable', async ({
    page,
  }) => {
    await page.route('**/api/sessions/*/tts*', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: '{"error":{"code":"speech_unavailable","message":"x"}}',
      }),
    );
    await startVoiceInterview(page);
    await page.getByTestId('begin-voice').click();
    await expect(page.getByText('Voice playback is unavailable')).toBeVisible({ timeout: 15_000 });
    await expect(phase(page)).toHaveAttribute('data-phase', 'listening', { timeout: 15_000 });
  });

  test('switching to typing before the interview starts uses the text room', async ({ page }) => {
    await startVoiceInterview(page);
    await page.getByRole('button', { name: /rather type my answers/ }).click();
    await expect(page.getByLabel('Your answer')).toBeVisible();
    await expect(page.getByTestId('current-question')).toContainText(
      'Hello, and thanks for making the time',
    );
  });
});
