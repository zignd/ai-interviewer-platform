import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createSessionRoute } from '@/app/api/sessions/route';
import { POST as queueRoute } from '@/app/api/sessions/[id]/queue/route';
import { POST as readyRoute } from '@/app/api/sessions/[id]/ready/route';
import { POST as leaveRoute } from '@/app/api/sessions/[id]/leave/route';
import { POST as speechTokenRoute } from '@/app/api/sessions/[id]/speech-token/route';
import { createAndJoin, startInterview } from '@/lib/engine/service';
import { confirmReady, joinGate, leaveGate, touchGate } from '@/lib/queue/service';
import { createTestContainer, ctx, jsonRequest } from './helpers';

const t = createTestContainer();
const CFG = {
  maxActive: 4,
  heartbeatTimeoutMs: 30_000,
  confirmTimeoutMs: 30_000,
  maxSessionMs: 25 * 60_000,
  averageSessionMs: 600_000,
};
afterAll(() => t.close());
beforeEach(() => t.reset());

async function jobId() {
  return (await t.repos.jobs.bySlug('frontend-engineer'))!.id;
}

async function newVoice(offsetMs = 0) {
  t.clock.advance(offsetMs);
  return createAndJoin(t.container, { jobId: await jobId(), mode: 'voice' });
}

const statusOf = async (id: string) => (await t.repos.sessions.byId(id))!.status;

describe('capacity gate', () => {
  it('never lets more than 4 interviews run at once under concurrent joins, and queues the rest in order', async () => {
    const jid = await jobId();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => createAndJoin(t.container, { jobId: jid, mode: 'voice' })),
    );
    const states = await Promise.all(results.map((r) => touchGate(t.db, r.id, t.clock.now(), CFG)));
    const active = states.filter((s) => s.status === 'active');
    const queued = states.filter((s) => s.status === 'queued');
    expect(active).toHaveLength(4);
    expect(queued).toHaveLength(6);
    expect(queued.map((q) => q.position).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6]);
    // The first four are running immediately; nobody needs to confirm a direct join.
    expect(results.filter((r) => r.status === 'active')).toHaveLength(4);
    expect(active.every((s) => s.ready)).toBe(true);
  });

  it('text interviews never wait and do not use a slot', async () => {
    for (let i = 0; i < 4; i++) await newVoice();
    const text = await createAndJoin(t.container, { jobId: await jobId(), mode: 'text' });
    expect(text.status).toBe('active');
    expect(text.queue).toBeNull();
    const fifth = await newVoice();
    expect(fifth.status).toBe('queued');
  });

  it('a finished interview frees a slot and the first in line is promoted, but must confirm', async () => {
    const running = [];
    for (let i = 0; i < 4; i++) running.push(await newVoice(10));
    const waiting = await newVoice(10);
    expect((await touchGate(t.db, waiting.id, t.clock.now(), CFG)).position).toBe(1);

    await t.repos.sessions.complete(running[0].id, t.clock.now());
    t.clock.advance(5000);
    const promoted = await touchGate(t.db, waiting.id, t.clock.now(), CFG);
    expect(promoted.status).toBe('active');
    expect(promoted.needsConfirmation).toBe(true);
    expect(promoted.ready).toBe(false);
    expect(promoted.confirmSecondsLeft).toBe(30);

    // Not allowed to talk to the speech service or interview until confirmed.
    const blocked = await speechTokenRoute(jsonRequest('/x'), ctx(waiting.id));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe('waiting_for_slot');
    await expect(startInterview(t.container, waiting.id)).rejects.toMatchObject({
      code: 'waiting_for_slot',
    });

    const ready = await confirmReady(t.db, waiting.id, t.clock.now(), CFG);
    expect(ready.ready).toBe(true);
    expect(ready.needsConfirmation).toBe(false);
    const ok = await speechTokenRoute(jsonRequest('/x'), ctx(waiting.id));
    expect(ok.status).toBe(200);
  });

  it('an unattended promotion expires after 30 s and the next in line gets the slot', async () => {
    const running = [];
    for (let i = 0; i < 4; i++) running.push(await newVoice(10));
    const first = await newVoice(10);
    const second = await newVoice(10);
    await t.repos.sessions.complete(running[0].id, t.clock.now());
    await touchGate(t.db, first.id, t.clock.now(), CFG);
    expect(await statusOf(first.id)).toBe('active');

    // Keep everyone else alive but never confirm.
    for (let i = 0; i < 3; i++) {
      t.clock.advance(11_000);
      for (const r of running.slice(1)) await touchGate(t.db, r.id, t.clock.now(), CFG);
      await touchGate(t.db, second.id, t.clock.now(), CFG);
    }
    expect(await statusOf(first.id)).toBe('abandoned');
    const state = await touchGate(t.db, second.id, t.clock.now(), CFG);
    expect(state.status).toBe('active');
    expect(state.needsConfirmation).toBe(true);
  });

  it('a missed heartbeat frees the slot (closed tab) and the queue moves up', async () => {
    const running = [];
    for (let i = 0; i < 4; i++) running.push(await newVoice(10));
    const waiting = await newVoice(10);
    t.clock.advance(31_000);
    // Only the waiting candidate is still polling.
    const state = await touchGate(t.db, waiting.id, t.clock.now(), CFG);
    expect(state.status).toBe('active');
    for (const r of running) expect(await statusOf(r.id)).toBe('abandoned');
  });

  it('interviews are cut off at the maximum duration', async () => {
    const running = await newVoice();
    const waiting = [];
    for (let i = 0; i < 4; i++) waiting.push(await newVoice(10));
    expect((await touchGate(t.db, waiting[3].id, t.clock.now(), CFG)).status).toBe('queued');
    for (let elapsed = 0; elapsed < CFG.maxSessionMs + 60_000; elapsed += 10_000) {
      t.clock.advance(10_000);
      for (const w of [running, ...waiting]) await touchGate(t.db, w.id, t.clock.now(), CFG);
    }
    expect(await statusOf(running.id)).toBe('abandoned');
  });

  it('leaving the queue gives up the place, and leaving a reserved slot frees it', async () => {
    for (let i = 0; i < 4; i++) await newVoice(10);
    const a = await newVoice(10);
    const b = await newVoice(10);
    await leaveGate(t.db, a.id, t.clock.now(), CFG);
    expect(await statusOf(a.id)).toBe('abandoned');
    expect((await touchGate(t.db, b.id, t.clock.now(), CFG)).position).toBe(1);
  });

  it('joinGate is idempotent for a running session', async () => {
    const r = await newVoice();
    const again = await joinGate(t.db, r.id, t.clock.now(), CFG);
    expect(again.status).toBe('active');
    expect(again.ready).toBe(true);
  });
});

describe('queue routes', () => {
  it('create returns queue info, and queue/ready/leave work over HTTP', async () => {
    const jid = await jobId();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await createSessionRoute(
        jsonRequest('/api/sessions', { jobId: jid, mode: 'voice' }),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      ids.push(body.id);
      if (i === 4) {
        expect(body.status).toBe('queued');
        expect(body.queue.position).toBe(1);
      }
    }
    const q = await (await queueRoute(jsonRequest('/x'), ctx(ids[4]))).json();
    expect(q.status).toBe('queued');
    expect(q.waitSeconds).toBeGreaterThan(0);
    const early = await (await readyRoute(jsonRequest('/x'), ctx(ids[4]))).json();
    expect(early.ready).toBe(false); // not promoted yet, so nothing to confirm
    const left = await (await leaveRoute(jsonRequest('/x'), ctx(ids[4]))).json();
    expect(left.status).toBe('abandoned');
    expect(
      (await queueRoute(jsonRequest('/x'), ctx('00000000-0000-4000-8000-000000000000'))).status,
    ).toBe(404);
  });
});
