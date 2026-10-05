import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as completeRoute } from '@/app/api/recordings/complete/route';
import { POST as prepareRoute } from '@/app/api/recordings/prepare/route';
import { createSession } from '@/lib/engine/service';
import { completeRecording, prepareRecording, type StorageLimits } from '@/lib/storage/service';
import { createTestContainer, jsonRequest } from './helpers';

const t = createTestContainer();
afterAll(() => t.close());
beforeEach(() => t.reset());

const MB = 1_000_000;
const limits: StorageLimits = {
  budgetBytes: 100 * MB,
  maxVideoBytes: 40 * MB,
  maxMonthlyUploads: 1500,
};

async function newSession() {
  const job = await t.repos.jobs.bySlug('frontend-engineer');
  return (await createSession(t.container, { jobId: job!.id, mode: 'video' })).id;
}

/** Prepares and completes one recording of `mb` megabytes. */
async function store(mb: number, kind: 'video' | 'audio' = 'video') {
  const sessionId = await newSession();
  const prep = await prepareRecording(
    t.container,
    { sessionId, kind, sizeBytes: mb * MB, extension: 'webm' },
    limits,
  );
  if (prep.action !== 'upload') throw new Error(`expected upload, got ${prep.action}`);
  await completeRecording(t.container, {
    recordingId: prep.recordingId,
    blobUrl: `https://blob.example/${prep.recordingId}.webm`,
    sizeBytes: mb * MB,
  });
  t.clock.advance(1000);
  return prep.recordingId;
}

describe('prepareRecording', () => {
  it('reserves space with a pending row and issues a token capped to the declared size', async () => {
    const sessionId = await newSession();
    const res = await prepareRecording(
      t.container,
      { sessionId, kind: 'video', sizeBytes: 20 * MB, extension: 'webm' },
      limits,
    );
    expect(res.action).toBe('upload');
    if (res.action !== 'upload') return;
    expect(res.pathname).toMatch(new RegExp(`^recordings/${sessionId}/video-.+\\.webm$`));
    expect(res.maxBytes).toBe(20 * MB);
    expect(t.blob.tokens.at(-1)).toEqual({ pathname: res.pathname, maxBytes: 20 * MB });
    const row = await t.repos.recordings.byId(res.recordingId);
    expect(row).toMatchObject({ status: 'pending', sizeBytes: 20 * MB, kind: 'video' });
  });

  it('counts pending uploads toward usage', async () => {
    const a = await newSession();
    await prepareRecording(
      t.container,
      { sessionId: a, kind: 'audio', sizeBytes: 60 * MB, extension: 'webm' },
      limits,
    );
    expect(await t.repos.recordings.sumUsage()).toBe(60 * MB);
    // 60 pending + 50 needs 10 MB freed, but a pending file cannot be deleted.
    const b = await newSession();
    const res = await prepareRecording(
      t.container,
      { sessionId: b, kind: 'audio', sizeBytes: 50 * MB, extension: 'webm' },
      limits,
    );
    expect(res).toEqual({ action: 'skip', reason: 'too_large' });
  });

  it('deletes the oldest stored recordings first and removes their blobs', async () => {
    const oldest = await store(30);
    const middle = await store(30);
    const newest = await store(30);
    const sessionId = await newSession();
    const res = await prepareRecording(
      t.container,
      { sessionId, kind: 'video', sizeBytes: 30 * MB, extension: 'webm' },
      limits,
    );
    expect(res.action).toBe('upload');
    expect((await t.repos.recordings.byId(oldest))?.status).toBe('deleted');
    expect((await t.repos.recordings.byId(oldest))?.deletedAt).not.toBeNull();
    expect((await t.repos.recordings.byId(middle))?.status).toBe('stored');
    expect((await t.repos.recordings.byId(newest))?.status).toBe('stored');
    expect(t.blob.deleted).toEqual([`https://blob.example/${oldest}.webm`]);
  });

  it('falls back to audio when the video is over the video cap', async () => {
    const sessionId = await newSession();
    const res = await prepareRecording(
      t.container,
      { sessionId, kind: 'video', sizeBytes: 41 * MB, extension: 'webm' },
      limits,
    );
    expect(res).toEqual({ action: 'use_audio' });
    expect(await t.repos.recordings.sumUsage()).toBe(0);
  });

  it('stops recording after the monthly upload limit', async () => {
    await store(1);
    await store(1);
    const sessionId = await newSession();
    const res = await prepareRecording(
      t.container,
      { sessionId, kind: 'audio', sizeBytes: MB, extension: 'webm' },
      { ...limits, maxMonthlyUploads: 2 },
    );
    expect(res).toEqual({ action: 'skip', reason: 'monthly_limit' });
  });

  it('frees space reserved by uploads that never finished', async () => {
    const sessionId = await newSession();
    await prepareRecording(
      t.container,
      { sessionId, kind: 'audio', sizeBytes: 90 * MB, extension: 'webm' },
      limits,
    );
    t.clock.advance(16 * 60 * 1000);
    const other = await newSession();
    const res = await prepareRecording(
      t.container,
      { sessionId: other, kind: 'audio', sizeBytes: 50 * MB, extension: 'webm' },
      limits,
    );
    expect(res.action).toBe('upload');
    expect(await t.repos.recordings.sumUsage()).toBe(50 * MB);
  });

  it('fails soft: a Blob error means "unavailable", not an exception, and releases the reservation', async () => {
    const sessionId = await newSession();
    t.blob.failWith = new Error('blob down');
    try {
      const res = await prepareRecording(
        t.container,
        { sessionId, kind: 'video', sizeBytes: 10 * MB, extension: 'webm' },
        limits,
      );
      expect(res).toEqual({ action: 'skip', reason: 'unavailable' });
      expect(await t.repos.recordings.sumUsage()).toBe(0);
    } finally {
      t.blob.failWith = null;
    }
  });

  it('still succeeds when deleting old blobs fails', async () => {
    await store(90, 'audio');
    const sessionId = await newSession();
    t.blob.failWith = null;
    const original = t.blob.delete.bind(t.blob);
    t.blob.delete = async () => {
      throw new Error('delete failed');
    };
    try {
      const res = await prepareRecording(
        t.container,
        { sessionId, kind: 'audio', sizeBytes: 30 * MB, extension: 'webm' },
        limits,
      );
      expect(res.action).toBe('upload');
    } finally {
      t.blob.delete = original;
    }
  });

  it('concurrent uploads cannot overshoot the budget', async () => {
    const sessions = await Promise.all([newSession(), newSession(), newSession()]);
    const results = await Promise.all(
      sessions.map((sessionId) =>
        prepareRecording(
          t.container,
          { sessionId, kind: 'audio', sizeBytes: 50 * MB, extension: 'webm' },
          limits,
        ),
      ),
    );
    expect(results.filter((r) => r.action === 'upload')).toHaveLength(2);
    expect(await t.repos.recordings.sumUsage()).toBeLessThanOrEqual(limits.budgetBytes);
  });
});

describe('completeRecording', () => {
  it('stores the real size and URL, and ignores unknown or already finished uploads', async () => {
    const sessionId = await newSession();
    const prep = await prepareRecording(
      t.container,
      { sessionId, kind: 'video', sizeBytes: 20 * MB, extension: 'webm' },
      limits,
    );
    if (prep.action !== 'upload') throw new Error('expected upload');
    expect(
      await completeRecording(t.container, {
        recordingId: prep.recordingId,
        blobUrl: 'https://blob.example/x.webm',
        sizeBytes: 18 * MB,
      }),
    ).toEqual({ ok: true });
    expect(await t.repos.recordings.byId(prep.recordingId)).toMatchObject({
      status: 'stored',
      sizeBytes: 18 * MB,
      blobUrl: 'https://blob.example/x.webm',
    });
    expect(
      await completeRecording(t.container, { recordingId: prep.recordingId, failed: true }),
    ).toEqual({ ok: false });
    expect(
      await completeRecording(t.container, {
        recordingId: '00000000-0000-4000-8000-000000000000',
        failed: true,
      }),
    ).toEqual({ ok: false });
  });

  it('releases the reserved space when the upload failed', async () => {
    const sessionId = await newSession();
    const prep = await prepareRecording(
      t.container,
      { sessionId, kind: 'video', sizeBytes: 20 * MB, extension: 'webm' },
      limits,
    );
    if (prep.action !== 'upload') throw new Error('expected upload');
    await completeRecording(t.container, { recordingId: prep.recordingId, failed: true });
    expect(await t.repos.recordings.sumUsage()).toBe(0);
  });
});

describe('recording routes', () => {
  it('prepare and complete work over HTTP and validate input', async () => {
    const sessionId = await newSession();
    const res = await prepareRoute(
      jsonRequest('/api/recordings/prepare', { sessionId, kind: 'audio', sizeBytes: 1000 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('upload');
    const done = await completeRoute(
      jsonRequest('/api/recordings/complete', {
        recordingId: body.recordingId,
        blobUrl: 'https://blob.example/a.webm',
        sizeBytes: 900,
      }),
    );
    expect(await done.json()).toEqual({ ok: true });

    expect(
      (
        await prepareRoute(
          jsonRequest('/api/recordings/prepare', { sessionId: 'x', kind: 'audio', sizeBytes: 1 }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await prepareRoute(
          jsonRequest('/api/recordings/prepare', { sessionId, kind: 'audio', sizeBytes: -5 }),
        )
      ).status,
    ).toBe(400);
    const unknown = await prepareRoute(
      jsonRequest('/api/recordings/prepare', {
        sessionId: '00000000-0000-4000-8000-000000000000',
        kind: 'audio',
        sizeBytes: 10,
      }),
    );
    expect(await unknown.json()).toEqual({ action: 'skip', reason: 'unavailable' });
  });
});
