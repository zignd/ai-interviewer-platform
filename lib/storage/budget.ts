/**
 * Decides whether a recording fits inside the free storage budget, and which old recordings to delete.
 * Pure: the route loads the numbers and applies the result.
 */

export type StoredRecording = { id: string; sizeBytes: number; createdAt: Date };

export type BudgetInput = {
  kind: 'video' | 'audio';
  sizeBytes: number;
  /** Sum of pending and stored recordings. */
  usageBytes: number;
  /** Stored (not pending) recordings, any order. Only these can be deleted. */
  stored: StoredRecording[];
  budgetBytes: number;
  maxVideoBytes: number;
  maxMonthlyUploads: number;
  uploadsThisMonth: number;
};

export type BudgetDecision =
  | { action: 'allow'; deleteIds: string[] }
  /** The video does not fit. Upload the audio-only recording instead. */
  | { action: 'use_audio' }
  | { action: 'skip'; reason: 'monthly_limit' | 'too_large' | 'invalid_size' };

export function decideRecording(input: BudgetInput): BudgetDecision {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { action: 'skip', reason: 'invalid_size' };
  }
  if (input.uploadsThisMonth >= input.maxMonthlyUploads) {
    return { action: 'skip', reason: 'monthly_limit' };
  }

  const doesNotFit = (): BudgetDecision =>
    input.kind === 'video' ? { action: 'use_audio' } : { action: 'skip', reason: 'too_large' };

  if (input.kind === 'video' && input.sizeBytes > input.maxVideoBytes)
    return { action: 'use_audio' };
  if (input.sizeBytes > input.budgetBytes) return doesNotFit();

  let needed = input.usageBytes + input.sizeBytes - input.budgetBytes;
  if (needed <= 0) return { action: 'allow', deleteIds: [] };

  const oldestFirst = [...input.stored].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const deleteIds: string[] = [];
  for (const r of oldestFirst) {
    if (needed <= 0) break;
    deleteIds.push(r.id);
    needed -= r.sizeBytes;
  }
  // Pending uploads can't be deleted, so there may be no way to make room.
  if (needed > 0) return doesNotFit();
  return { action: 'allow', deleteIds };
}

/** First instant of the current month (UTC), used for the monthly upload guard. */
export function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const STALE_PENDING_MS = 15 * 60 * 1000;
