import { describe, expect, it } from 'vitest';
import { getEnv } from '@/lib/env';

const base = {
  OPENROUTER_API_KEY: 'k',
  ELEVENLABS_API_KEY: 'k',
  ELEVENLABS_VOICE_ID: 'v',
  DATABASE_URL: 'postgres://x',
  BLOB_READ_WRITE_TOKEN: 't',
  CRON_SECRET: '0123456789abcdef',
};

describe('getEnv', () => {
  it('applies defaults and converts numbers', () => {
    const env = getEnv({ ...base });
    expect(env.MAX_CONCURRENT_INTERVIEWS).toBe(4);
    expect(env.MAX_SESSION_MINUTES).toBe(25);
    expect(env.STORAGE_BUDGET_BYTES).toBe(800_000_000);
    expect(env.USE_FAKES).toBe(false);
    expect(env.DEMO_PASSWORD).toBeUndefined();
  });

  it('treats empty strings as unset for optional values and parses overrides', () => {
    const env = getEnv({
      ...base,
      DEMO_PASSWORD: '',
      ELEVENLABS_AGENT_ID: '',
      MAX_CONCURRENT_INTERVIEWS: '2',
      USE_FAKES: '1',
    });
    expect(env.DEMO_PASSWORD).toBeUndefined();
    expect(env.ELEVENLABS_AGENT_ID).toBeUndefined();
    expect(env.MAX_CONCURRENT_INTERVIEWS).toBe(2);
    expect(env.USE_FAKES).toBe(true);
  });

  it('fails with a readable message that names every missing variable', () => {
    expect(() => getEnv({})).toThrowError(/OPENROUTER_API_KEY.*ELEVENLABS_API_KEY/s);
  });

  it('rejects non-numeric limits and short cron secrets', () => {
    expect(() => getEnv({ ...base, MAX_SESSION_MINUTES: 'abc' })).toThrow(/MAX_SESSION_MINUTES/);
    expect(() => getEnv({ ...base, CRON_SECRET: 'short' })).toThrow(/CRON_SECRET/);
  });
});
