/**
 * Capacity gate rules as pure functions. At most `maxActive` interviews run at once (ElevenLabs charges extra
 * above the plan's concurrent-call limit), everyone else waits in a FIFO queue.
 */
export type QueueConfig = {
  maxActive: number;
  /** A session without a heartbeat for this long is considered gone (closed tab, crash). */
  heartbeatTimeoutMs: number;
  /** A promoted candidate must confirm they are ready within this time or lose the spot. */
  confirmTimeoutMs: number;
  /** Interviews are cut off after this long. */
  maxSessionMs: number;
  /** Used for the rough wait estimate. */
  averageSessionMs: number;
};

export const defaultQueueConfig: QueueConfig = {
  maxActive: 4,
  heartbeatTimeoutMs: 30_000,
  confirmTimeoutMs: 30_000,
  maxSessionMs: 25 * 60_000,
  averageSessionMs: 10 * 60_000,
};

export type SessionSlot = {
  id: string;
  status: 'queued' | 'active' | 'completed' | 'abandoned';
  queuedAt: Date | null;
  startedAt: Date | null;
  lastHeartbeatAt: Date | null;
  promotedAt: Date | null;
  confirmedAt: Date | null;
};

export type ExpiryReason = 'heartbeat' | 'confirm_timeout' | 'max_duration';

/** Sessions that must give up their place right now. */
export function findExpired(
  rows: SessionSlot[],
  now: Date,
  config: QueueConfig,
): { id: string; reason: ExpiryReason }[] {
  const out: { id: string; reason: ExpiryReason }[] = [];
  for (const r of rows) {
    if (r.status !== 'queued' && r.status !== 'active') continue;
    const awaitingConfirmation = r.status === 'active' && r.confirmedAt === null;
    if (
      awaitingConfirmation &&
      r.promotedAt &&
      now.getTime() - r.promotedAt.getTime() >= config.confirmTimeoutMs
    ) {
      out.push({ id: r.id, reason: 'confirm_timeout' });
      continue;
    }
    if (
      r.status === 'active' &&
      r.startedAt &&
      now.getTime() - r.startedAt.getTime() >= config.maxSessionMs
    ) {
      out.push({ id: r.id, reason: 'max_duration' });
      continue;
    }
    const last = r.lastHeartbeatAt ?? r.queuedAt ?? r.startedAt;
    if (last && now.getTime() - last.getTime() >= config.heartbeatTimeoutMs) {
      out.push({ id: r.id, reason: 'heartbeat' });
    }
  }
  return out;
}

export const byQueueOrder = (a: SessionSlot, b: SessionSlot) =>
  (a.queuedAt?.getTime() ?? 0) - (b.queuedAt?.getTime() ?? 0) || a.id.localeCompare(b.id);

/** Slots free right now, given the sessions that are still active. */
export function freeSlots(activeCount: number, config: QueueConfig): number {
  return Math.max(0, config.maxActive - activeCount);
}

/** Who gets the free slots: the oldest queued sessions first. */
export function nextToPromote(queued: SessionSlot[], free: number): SessionSlot[] {
  return queued.slice().sort(byQueueOrder).slice(0, Math.max(0, free));
}

/** 1-based place in the queue, or null if the session is not queued. */
export function queuePosition(queued: SessionSlot[], id: string): number | null {
  const sorted = queued.slice().sort(byQueueOrder);
  const i = sorted.findIndex((q) => q.id === id);
  return i === -1 ? null : i + 1;
}

/** Rough wait: each "wave" of maxActive interviews takes about averageSessionMs. */
export function estimateWaitSeconds(position: number, config: QueueConfig): number {
  const waves = Math.ceil(position / config.maxActive);
  return Math.round((waves * config.averageSessionMs) / 1000);
}

export function confirmSecondsLeft(
  promotedAt: Date | null,
  now: Date,
  config: QueueConfig,
): number | null {
  if (!promotedAt) return null;
  return Math.max(
    0,
    Math.ceil((config.confirmTimeoutMs - (now.getTime() - promotedAt.getTime())) / 1000),
  );
}
