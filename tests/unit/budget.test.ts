import { describe, expect, it } from 'vitest';
import { decideRecording, startOfMonth, type BudgetInput } from '@/lib/storage/budget';

const MB = 1_000_000;
const base: BudgetInput = {
  kind: 'video',
  sizeBytes: 20 * MB,
  usageBytes: 0,
  stored: [],
  budgetBytes: 100 * MB,
  maxVideoBytes: 40 * MB,
  maxMonthlyUploads: 1500,
  uploadsThisMonth: 0,
};
const rec = (id: string, mb: number, day: number) => ({
  id,
  sizeBytes: mb * MB,
  createdAt: new Date(Date.UTC(2026, 0, day)),
});

describe('decideRecording', () => {
  it('allows a recording that fits without deleting anything', () => {
    expect(decideRecording(base)).toEqual({ action: 'allow', deleteIds: [] });
  });

  it('deletes the oldest recordings first until the new one fits', () => {
    const stored = [rec('new', 30, 9), rec('old', 30, 1), rec('mid', 30, 5)];
    expect(decideRecording({ ...base, usageBytes: 90 * MB, stored })).toEqual({
      action: 'allow',
      deleteIds: ['old'],
    });
    expect(decideRecording({ ...base, sizeBytes: 40 * MB, usageBytes: 90 * MB, stored })).toEqual({
      action: 'allow',
      deleteIds: ['old'],
    });
    expect(
      decideRecording({ ...base, kind: 'audio', sizeBytes: 60 * MB, usageBytes: 90 * MB, stored }),
    ).toEqual({ action: 'allow', deleteIds: ['old', 'mid'] });
  });

  it('counts pending uploads as used space that cannot be deleted', () => {
    // 90 MB used but only 10 MB is deletable, so a 40 MB file cannot fit.
    const stored = [rec('a', 10, 1)];
    const input = { ...base, sizeBytes: 40 * MB, usageBytes: 90 * MB, stored };
    expect(decideRecording(input)).toEqual({ action: 'use_audio' });
    expect(decideRecording({ ...input, kind: 'audio' })).toEqual({
      action: 'skip',
      reason: 'too_large',
    });
  });

  it('falls back to audio when the video is over the video cap', () => {
    expect(decideRecording({ ...base, sizeBytes: 41 * MB })).toEqual({ action: 'use_audio' });
  });

  it('does not apply the video cap to audio', () => {
    expect(decideRecording({ ...base, kind: 'audio', sizeBytes: 50 * MB })).toEqual({
      action: 'allow',
      deleteIds: [],
    });
  });

  it('skips recording when the monthly upload guard is reached', () => {
    expect(decideRecording({ ...base, uploadsThisMonth: 1500 })).toEqual({
      action: 'skip',
      reason: 'monthly_limit',
    });
    expect(decideRecording({ ...base, uploadsThisMonth: 1499 }).action).toBe('allow');
  });

  it('rejects invalid sizes', () => {
    expect(decideRecording({ ...base, sizeBytes: 0 })).toEqual({
      action: 'skip',
      reason: 'invalid_size',
    });
    expect(decideRecording({ ...base, sizeBytes: Number.NaN })).toEqual({
      action: 'skip',
      reason: 'invalid_size',
    });
  });

  it('a file larger than the whole budget never fits', () => {
    expect(decideRecording({ ...base, kind: 'audio', sizeBytes: 101 * MB })).toEqual({
      action: 'skip',
      reason: 'too_large',
    });
  });
});

describe('startOfMonth', () => {
  it('returns the first instant of the UTC month', () => {
    expect(startOfMonth(new Date('2026-10-17T13:45:00Z')).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });
});
