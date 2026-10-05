import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/interviewer_test';

// The app runs for real, but every vendor (LLM, speech, blob) is swapped for a deterministic fake.
const appEnv = {
  USE_FAKES: '1',
  DATABASE_URL,
  OPENROUTER_API_KEY: 'test',
  ELEVENLABS_API_KEY: 'test',
  ELEVENLABS_VOICE_ID: 'test',
  BLOB_READ_WRITE_TOKEN: 'test',
  CRON_SECRET: 'test-cron-secret-0123456789',
  DEMO_PASSWORD: '',
  MAX_CONCURRENT_INTERVIEWS: '50',
  DEV_MODE: '1',
  PORT: String(PORT),
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
    permissions: ['microphone', 'camera'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Playwright starts the web server before any global setup, so the database is prepared here.
    command: `npx tsx tests/support/prepare-db-cli.ts && npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: appEnv,
  },
});
