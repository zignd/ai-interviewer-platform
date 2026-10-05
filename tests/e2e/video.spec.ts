import { expect, test } from '@playwright/test';

// Fake transcriber, fake vendors, and Chromium's fake camera (video capture works headless, unlike audio).
test.describe('video mode', () => {
  test('consent screen, call layout with self-view and subtitles, and a camera-free fallback', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__fakeSpeech = ['I rebuilt the checkout page and cut the load time a lot.'];
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start video interview for Frontend Engineer' }).click();
    await expect(page).toHaveURL(/\/interview\//);
    await expect(page.getByTestId('recording-consent')).toBeVisible();
    await page.getByTestId('start-without-recording').click();

    await expect(page.getByTestId('video-stage')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('subtitles')).toBeVisible();
    // Either the live self-view or the initials tile: the camera is optional.
    await expect(page.getByTestId('self-view').or(page.getByTestId('self-initials'))).toBeVisible();
  });

  test('works without a camera: initials tile instead of self-view', async ({ page }) => {
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) =>
        c && (c as MediaStreamConstraints).video
          ? Promise.reject(Object.assign(new Error('no camera'), { name: 'NotFoundError' }))
          : original(c);
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start video interview for Data Analyst' }).click();
    await page.getByTestId('start-without-recording').click();
    await expect(page.getByTestId('video-stage')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('self-initials')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId('current-question').or(page.getByTestId('subtitles')),
    ).toBeVisible();
  });
});
