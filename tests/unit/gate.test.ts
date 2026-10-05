import { describe, expect, it } from 'vitest';
import { gateToken, safeEqual, safeNext } from '@/lib/gate';

describe('demo password gate helpers', () => {
  it('derives a stable token that does not contain the password', async () => {
    const a = await gateToken('hunter2', 'secret');
    expect(a).toBe(await gateToken('hunter2', 'secret'));
    expect(a).not.toContain('hunter2');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(await gateToken('hunter3', 'secret'));
    expect(a).not.toBe(await gateToken('hunter2', 'other'));
  });
  it('compares tokens exactly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('only allows redirects inside the site', () => {
    expect(safeNext('/history?role=x')).toBe('/history?role=x');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
