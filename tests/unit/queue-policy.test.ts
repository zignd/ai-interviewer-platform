import { describe, expect, it } from 'vitest';
import {
  confirmSecondsLeft,
  defaultQueueConfig,
  estimateWaitSeconds,
  findExpired,
  freeSlots,
  nextToPromote,
  queuePosition,
  type SessionSlot,
} from '@/lib/queue/policy';

const cfg = { ...defaultQueueConfig, maxActive: 4 };
const T0 = new Date('2026-01-01T12:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

const slot = (id: string, over: Partial<SessionSlot> = {}): SessionSlot => ({
  id,
  status: 'queued',
  queuedAt: T0,
  startedAt: null,
  lastHeartbeatAt: T0,
  promotedAt: null,
  confirmedAt: null,
  ...over,
});

describe('capacity policy', () => {
  it('frees slots only up to the maximum', () => {
    expect(freeSlots(0, cfg)).toBe(4);
    expect(freeSlots(3, cfg)).toBe(1);
    expect(freeSlots(4, cfg)).toBe(0);
    expect(freeSlots(9, cfg)).toBe(0);
  });

  it('promotes the oldest queued sessions first (FIFO), ties broken by id', () => {
    const q = [
      slot('c', { queuedAt: at(3000) }),
      slot('a', { queuedAt: at(1000) }),
      slot('b', { queuedAt: at(1000) }),
    ];
    expect(nextToPromote(q, 2).map((s) => s.id)).toEqual(['a', 'b']);
    expect(nextToPromote(q, 0)).toEqual([]);
    expect(nextToPromote(q, 10)).toHaveLength(3);
  });

  it('computes a 1-based queue position', () => {
    const q = [slot('a', { queuedAt: at(1) }), slot('b', { queuedAt: at(2) })];
    expect(queuePosition(q, 'a')).toBe(1);
    expect(queuePosition(q, 'b')).toBe(2);
    expect(queuePosition(q, 'zzz')).toBeNull();
  });

  it('estimates waits in waves of maxActive interviews', () => {
    expect(estimateWaitSeconds(1, cfg)).toBe(600);
    expect(estimateWaitSeconds(4, cfg)).toBe(600);
    expect(estimateWaitSeconds(5, cfg)).toBe(1200);
  });

  it('counts down the confirmation window', () => {
    expect(confirmSecondsLeft(null, T0, cfg)).toBeNull();
    expect(confirmSecondsLeft(T0, at(10_000), cfg)).toBe(20);
    expect(confirmSecondsLeft(T0, at(99_000), cfg)).toBe(0);
  });
});

describe('findExpired', () => {
  it('drops sessions whose heartbeat stopped (closed tab or crash), queued or active', () => {
    const rows = [
      slot('queued-gone', { lastHeartbeatAt: at(0) }),
      slot('active-gone', {
        status: 'active',
        startedAt: at(0),
        confirmedAt: at(0),
        lastHeartbeatAt: at(0),
      }),
      slot('alive', {
        status: 'active',
        startedAt: at(0),
        confirmedAt: at(0),
        lastHeartbeatAt: at(25_000),
      }),
    ];
    const out = findExpired(rows, at(31_000), cfg);
    expect(out.map((o) => [o.id, o.reason])).toEqual([
      ['queued-gone', 'heartbeat'],
      ['active-gone', 'heartbeat'],
    ]);
  });

  it('drops a promoted candidate who never confirmed', () => {
    const rows = [
      slot('idle', { status: 'active', promotedAt: at(0), lastHeartbeatAt: at(29_000) }),
    ];
    expect(findExpired(rows, at(29_000), cfg)).toEqual([]);
    expect(findExpired(rows, at(30_000), cfg)).toEqual([{ id: 'idle', reason: 'confirm_timeout' }]);
  });

  it('cuts off interviews that run too long even if the heartbeat is fine', () => {
    const rows = [
      slot('long', {
        status: 'active',
        startedAt: at(0),
        confirmedAt: at(0),
        lastHeartbeatAt: at(cfg.maxSessionMs - 1000),
      }),
    ];
    expect(findExpired(rows, at(cfg.maxSessionMs), cfg)).toEqual([
      { id: 'long', reason: 'max_duration' },
    ]);
  });

  it('ignores finished sessions', () => {
    expect(
      findExpired(
        [slot('done', { status: 'completed', lastHeartbeatAt: at(0) })],
        at(999_999),
        cfg,
      ),
    ).toEqual([]);
  });
});
