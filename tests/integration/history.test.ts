import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getReplayData, listHistory, sessionMetrics } from '@/lib/db/history-repos';
import { recordings, sessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createSession, evaluateSession, startInterview, submitTurn } from '@/lib/engine/service';
import { LONG_ANSWER, createTestContainer } from './helpers';

const t = createTestContainer();
afterAll(() => t.close());
beforeEach(() => t.reset());

async function finishedInterview(slug: string) {
  const job = await t.repos.jobs.bySlug(slug);
  const session = await createSession(t.container, { jobId: job!.id, mode: 'text' });
  let r = await startInterview(t.container, session.id);
  while (!r.done) {
    t.clock.advance(20_000);
    r = await submitTurn(t.container, session.id, { transcript: LONG_ANSWER });
  }
  await evaluateSession(t.container, session.id);
  return session.id;
}

describe('history', () => {
  it('is empty before any interview', async () => {
    expect(await listHistory(t.db)).toEqual([]);
  });

  it('lists sessions newest first with metrics, and filters by role', async () => {
    const first = await finishedInterview('frontend-engineer');
    await new Promise((r) => setTimeout(r, 15));
    const second = await finishedInterview('data-analyst');

    const all = await listHistory(t.db);
    expect(all.map((r) => r.id)).toEqual([second, first]);
    for (const row of all) {
      expect(row.status).toBe('completed');
      expect(row.metrics.overallScore).toBeGreaterThan(0);
      expect(row.metrics.coverage.total).toBe(8);
      expect(row.metrics.coverage.covered).toBeGreaterThanOrEqual(3);
      expect(row.metrics.trend.length).toBeGreaterThanOrEqual(6);
      expect(row.metrics.talk.candidateShare).toBeGreaterThan(0);
      expect(row.metrics.talk.candidateShare).toBeLessThan(1);
    }

    const onlyAnalyst = await listHistory(t.db, { roleSlug: 'data-analyst' });
    expect(onlyAnalyst.map((r) => r.id)).toEqual([second]);
    expect(await listHistory(t.db, { roleSlug: 'customer-success-manager' })).toEqual([]);
  });

  it('computes session metrics from the stored turns, decisions and evaluation', async () => {
    const id = await finishedInterview('frontend-engineer');
    const m = await sessionMetrics(t.db, id);
    expect(m!.durationMs).toBeGreaterThan(0);
    expect(m!.overallScore).not.toBeNull();
    expect(await sessionMetrics(t.db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('shows an unfinished session without a score', async () => {
    const job = await t.repos.jobs.bySlug('frontend-engineer');
    const s = await createSession(t.container, { jobId: job!.id, mode: 'text' });
    await startInterview(t.container, s.id);
    const [row] = await listHistory(t.db);
    expect(row.status).toBe('active');
    expect(row.metrics.overallScore).toBeNull();
    expect(row.metrics.durationMs).toBeNull();
  });
});

describe('replay data', () => {
  it('is none without a recording', async () => {
    const id = await finishedInterview('frontend-engineer');
    expect(await getReplayData(t.db, id)).toEqual({ state: 'none' });
  });

  it('returns the stored recording with turn offsets', async () => {
    const id = await finishedInterview('frontend-engineer');
    await t.db.insert(recordings).values({
      sessionId: id,
      kind: 'video',
      blobUrl: 'https://blob.example/rec.webm',
      sizeBytes: 1000,
      status: 'stored',
    });
    const data = await getReplayData(t.db, id);
    expect(data.state).toBe('stored');
    if (data.state !== 'stored') return;
    expect(data.kind).toBe('video');
    expect(data.url).toMatch(/^\/api\/recordings\/[0-9a-f-]{36}\/media$/);
    expect(data.turns[0].offsetSec).toBe(0);
    const offsets = data.turns.map((x) => x.offsetSec);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    expect(offsets.at(-1)).toBeGreaterThan(0);
  });

  it('reports a deleted recording and keeps the metrics available', async () => {
    const id = await finishedInterview('frontend-engineer');
    await t.db.insert(recordings).values({
      sessionId: id,
      kind: 'video',
      blobUrl: null,
      sizeBytes: 1000,
      status: 'deleted',
      deletedAt: new Date(),
    });
    expect(await getReplayData(t.db, id)).toEqual({ state: 'deleted' });
    expect((await sessionMetrics(t.db, id))!.talk.candidateShare).toBeGreaterThan(0);
  });

  it('prefers a stored recording over an older deleted one, and ignores stored rows without a URL', async () => {
    const id = await finishedInterview('frontend-engineer');
    await t.db.insert(recordings).values([
      { sessionId: id, kind: 'video', blobUrl: null, sizeBytes: 1, status: 'deleted' },
      {
        sessionId: id,
        kind: 'audio',
        blobUrl: 'https://blob.example/a.webm',
        sizeBytes: 1,
        status: 'stored',
      },
    ]);
    const data = await getReplayData(t.db, id);
    expect(data.state === 'stored' && data.kind).toBe('audio');
    await t.db.update(recordings).set({ blobUrl: null }).where(eq(recordings.status, 'stored'));
    expect(await getReplayData(t.db, id)).toEqual({ state: 'deleted' });
    void sessions;
  });
});
