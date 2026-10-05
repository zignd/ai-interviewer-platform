import { randomUUID } from 'node:crypto';
import type { Container } from '@/lib/container';
import { createRepos } from '@/lib/db/repos';
import type { Db } from '@/lib/db/client';
import { recordingPath, type RecorderKind } from '@/lib/recorder/settings';
import { STALE_PENDING_MS, decideRecording, startOfMonth } from './budget';

export type StorageLimits = {
  budgetBytes: number;
  maxVideoBytes: number;
  maxMonthlyUploads: number;
};

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function storageLimits(env: NodeJS.ProcessEnv = process.env): StorageLimits {
  return {
    budgetBytes: num(env.STORAGE_BUDGET_BYTES, 800_000_000),
    maxVideoBytes: num(env.MAX_VIDEO_BYTES, 40_000_000),
    maxMonthlyUploads: num(env.MAX_MONTHLY_UPLOADS, 1500),
  };
}

export type PrepareResult =
  | { action: 'upload'; recordingId: string; pathname: string; token: string; maxBytes: number }
  | { action: 'use_audio' }
  | { action: 'skip'; reason: 'monthly_limit' | 'too_large' | 'invalid_size' | 'unavailable' };

export type PrepareInput = {
  sessionId: string;
  kind: RecorderKind;
  sizeBytes: number;
  extension: 'webm' | 'mp4';
};

/**
 * Checks the storage budget, deletes the oldest recordings if needed, reserves space with a pending row
 * and issues a size-capped upload token. Never throws: any problem means "recording unavailable".
 */
export async function prepareRecording(
  c: Container,
  input: PrepareInput,
  limits: StorageLimits = storageLimits(),
): Promise<PrepareResult> {
  try {
    const now = c.clock.now();
    const outcome = await c.repos.db.transaction(async (tx) => {
      const r = createRepos(tx as unknown as Db);
      await r.recordings.lock();
      await r.recordings.expireStalePending(new Date(now.getTime() - STALE_PENDING_MS), now);
      const stored = await r.recordings.listStoredOldestFirst();
      const decision = decideRecording({
        kind: input.kind,
        sizeBytes: input.sizeBytes,
        usageBytes: await r.recordings.sumUsage(),
        stored: stored.map((s) => ({ id: s.id, sizeBytes: s.sizeBytes, createdAt: s.createdAt })),
        budgetBytes: limits.budgetBytes,
        maxVideoBytes: limits.maxVideoBytes,
        maxMonthlyUploads: limits.maxMonthlyUploads,
        uploadsThisMonth: await r.recordings.countCreatedSince(startOfMonth(now)),
      });
      if (decision.action !== 'allow') return { decision, row: null, urls: [] as string[] };

      const doomed = stored.filter((s) => decision.deleteIds.includes(s.id));
      await r.recordings.markDeleted(decision.deleteIds, now);
      const row = await r.recordings.createPending({
        sessionId: input.sessionId,
        kind: input.kind,
        sizeBytes: input.sizeBytes,
        now,
      });
      const urls = doomed.map((d) => d.blobUrl).filter((u): u is string => !!u);
      return { decision, row, urls };
    });

    if (outcome.decision.action === 'use_audio') return { action: 'use_audio' };
    if (outcome.decision.action === 'skip')
      return { action: 'skip', reason: outcome.decision.reason };
    const row = outcome.row!;

    // Removing the old files is best effort: the rows are already marked deleted.
    if (outcome.urls.length > 0) {
      await c.blob.delete(outcome.urls).catch((err) => {
        console.warn('blob delete failed', err instanceof Error ? err.message : err);
      });
    }

    const pathname = recordingPath(input.sessionId, input.kind, input.extension, randomUUID());
    try {
      const token = await c.blob.createUploadToken(pathname, input.sizeBytes);
      return { action: 'upload', recordingId: row.id, pathname, token, maxBytes: input.sizeBytes };
    } catch (err) {
      await c.repos.recordings.markDeleted([row.id], now);
      throw err;
    }
  } catch (err) {
    console.warn('recording unavailable', err instanceof Error ? err.message : err);
    return { action: 'skip', reason: 'unavailable' };
  }
}

export type CompleteInput =
  | { recordingId: string; blobUrl: string; sizeBytes: number }
  | { recordingId: string; failed: true };

/** Marks an upload as stored (or releases its reserved space if it failed). Never throws. */
export async function completeRecording(
  c: Container,
  input: CompleteInput,
): Promise<{ ok: boolean }> {
  try {
    const row = await c.repos.recordings.byId(input.recordingId);
    if (!row || row.status !== 'pending') return { ok: false };
    if ('failed' in input) {
      await c.repos.recordings.markDeleted([row.id], c.clock.now());
      return { ok: true };
    }
    await c.repos.recordings.markStored(row.id, {
      blobUrl: input.blobUrl,
      sizeBytes: input.sizeBytes,
    });
    return { ok: true };
  } catch (err) {
    console.warn('recording completion failed', err instanceof Error ? err.message : err);
    return { ok: false };
  }
}
