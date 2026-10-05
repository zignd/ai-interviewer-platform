import { describe, expect, it } from 'vitest';
import {
  activeTurnIdx,
  durationMs,
  formatDuration,
  replayOffsets,
  scoreTrend,
  sparklinePath,
  speakingMs,
  talkRatio,
  topicCoverage,
  type TurnLike,
} from '@/lib/analytics/metrics';

const t = (role: TurnLike['role'], text: string, extra: Partial<TurnLike> = {}): TurnLike => ({
  role,
  text,
  startedAt: null,
  endedAt: null,
  audioMs: null,
  ...extra,
});

describe('duration', () => {
  it('is ended minus started and null when unknown or negative', () => {
    expect(durationMs('2026-01-01T10:00:00Z', '2026-01-01T10:07:30Z')).toBe(450_000);
    expect(durationMs(null, '2026-01-01T10:07:30Z')).toBeNull();
    expect(durationMs('2026-01-01T10:08:00Z', '2026-01-01T10:07:30Z')).toBeNull();
    expect(durationMs('nope', '2026-01-01T10:07:30Z')).toBeNull();
  });
  it('formats as m:ss', () => {
    expect(formatDuration(450_000)).toBe('7:30');
    expect(formatDuration(5_000)).toBe('0:05');
    expect(formatDuration(null)).toBe('-');
  });
});

describe('talk ratio', () => {
  it('prefers audio length, then timestamps, then a word-count estimate', () => {
    expect(speakingMs(t('candidate', 'x', { audioMs: 4000 }))).toBe(4000);
    expect(
      speakingMs(t('candidate', 'x', { startedAt: new Date(0), endedAt: new Date(2500) })),
    ).toBe(2500);
    expect(speakingMs(t('interviewer', 'one two three four five'))).toBe(2000);
  });
  it('computes the candidate share from the turns', () => {
    const r = talkRatio([
      t('interviewer', 'q', { audioMs: 1000 }),
      t('candidate', 'a', { audioMs: 3000 }),
    ]);
    expect(r).toEqual({ candidateMs: 3000, interviewerMs: 1000, candidateShare: 0.75 });
  });
  it('is null when nobody spoke', () => {
    expect(talkRatio([]).candidateShare).toBeNull();
  });
});

describe('topic coverage', () => {
  it('is covered divided by total, ignoring unknown topics', () => {
    const c = topicCoverage({ topicsCovered: ['a', 'b', 'zzz'], allTopics: ['a', 'b', 'c', 'd'] });
    expect(c).toEqual({ covered: 2, total: 4, ratio: 0.5 });
  });
  it('handles missing snapshots', () => {
    expect(topicCoverage(null)).toEqual({ covered: 0, total: 0, ratio: null });
  });
});

describe('score trend and sparkline', () => {
  it('keeps numeric qualities in order', () => {
    expect(scoreTrend([{ quality: null }, { quality: 4 }, { quality: 8 }])).toEqual([4, 8]);
  });
  it('builds an SVG path scaled to the box', () => {
    expect(sparklinePath([])).toBe('');
    expect(sparklinePath([0, 10], 80, 24)).toBe('M0.0 24.0 L80.0 0.0');
    expect(sparklinePath([5], 80, 24)).toBe('M40.0 12.0');
    expect(sparklinePath([99, -5], 80, 24)).toBe('M0.0 0.0 L80.0 24.0');
  });
});

describe('replay offsets', () => {
  const turns = [
    { idx: 0, role: 'interviewer' as const, text: 'q1', startedAt: '2026-01-01T10:00:00Z' },
    { idx: 1, role: 'candidate' as const, text: 'a1', startedAt: '2026-01-01T10:00:20Z' },
    { idx: 2, role: 'interviewer' as const, text: 'q2', startedAt: '2026-01-01T10:01:05Z' },
  ];
  it('measures seconds from the origin and picks the active turn', () => {
    const r = replayOffsets(turns, '2026-01-01T10:00:00Z');
    expect(r.map((x) => x.offsetSec)).toEqual([0, 20, 65]);
    expect(activeTurnIdx(r, 0)).toBe(0);
    expect(activeTurnIdx(r, 30)).toBe(1);
    expect(activeTurnIdx(r, 999)).toBe(2);
  });
  it('defaults the origin to the first turn and never goes negative', () => {
    const r = replayOffsets(turns);
    expect(r[0].offsetSec).toBe(0);
    expect(replayOffsets(turns, '2026-01-01T10:00:30Z')[0].offsetSec).toBe(0);
  });
});
