import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * Live browser test (NOT part of CI): the real app talking to the real OpenRouter and ElevenLabs.
 * Only the microphone is simulated: the test feeds synthesized speech into getUserMedia.
 * The database is a local throwaway Postgres, never Supabase.
 */
const PORT = 3200;
/** Set LIVE_BASE_URL to run the same test against a deployed site instead of a local build. */
const REMOTE = process.env.LIVE_BASE_URL;
const LOCAL_DB =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/interviewer_test';

export default defineConfig({
  testDir: './tests/live',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  reporter: [['list']],
  use: {
    baseURL: REMOTE ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
    permissions: ['microphone'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: REMOTE
    ? undefined
    : {
        command: `npx tsx tests/support/prepare-db-cli.ts && npm run build && npx next start -p ${PORT}`,
        url: `http://localhost:${PORT}`,
        timeout: 240_000,
        reuseExistingServer: false,
        env: { DATABASE_URL: LOCAL_DB, USE_FAKES: '', PORT: String(PORT) },
      },
});
