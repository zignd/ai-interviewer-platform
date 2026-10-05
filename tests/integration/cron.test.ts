import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as keepAlive } from '@/app/api/cron/keep-alive/route';
import { TEST_DATABASE_URL } from './db-url';

const SECRET = 'cron-secret-0123456789abcdef';

beforeAll(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
});
afterAll(() => {
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

const call = (token?: string) =>
  keepAlive(
    new Request('http://localhost/api/cron/keep-alive', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );

describe('keep-alive cron route', () => {
  it('rejects missing or wrong credentials', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('wrong')).status).toBe(401);
  });
  it('runs a trivial query with the right secret', async () => {
    const res = await call(SECRET);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
