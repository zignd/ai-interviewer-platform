import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { sessions } from '@/lib/db/schema';
import {
  confirmSecondsLeft,
  defaultQueueConfig,
  estimateWaitSeconds,
  findExpired,
  freeSlots,
  nextToPromote,
  queuePosition,
  type QueueConfig,
  type SessionSlot,
} from './policy';

/** One lock for the whole capacity gate: join, promote and expire are serialised, so the limit can't be raced. */
const LOCK_KEY = 4_815_162_342;

export function queueConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): QueueConfig {
  const num = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d);
  return {
    ...defaultQueueConfig,
    maxActive: num(env.MAX_CONCURRENT_INTERVIEWS, defaultQueueConfig.maxActive),
    maxSessionMs: num(env.MAX_SESSION_MINUTES, 25) * 60_000,
  };
}

export type QueueState = {
  status: 'queued' | 'active' | 'completed' | 'abandoned';
  /** True once the interview may run (a free slot was given and the candidate confirmed). */
  ready: boolean;
  /** A slot is reserved and the candidate must press "I'm ready" before the countdown ends. */
  needsConfirmation: boolean;
  confirmSecondsLeft: number | null;
  position: number | null;
  waitSeconds: number | null;
  activeCount: number;
  maxActive: number;
};

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const slotColumns = {
  id: sessions.id,
  status: sessions.status,
  queuedAt: sessions.queuedAt,
  startedAt: sessions.startedAt,
  lastHeartbeatAt: sessions.lastHeartbeatAt,
  promotedAt: sessions.promotedAt,
  confirmedAt: sessions.confirmedAt,
};

async function gated(tx: Tx): Promise<SessionSlot[]> {
  return tx
    .select(slotColumns)
    .from(sessions)
    .where(and(inArray(sessions.status, ['queued', 'active']), ne(sessions.mode, 'text')));
}

/** Drops sessions that vanished or timed out, then gives free slots to the oldest queued sessions. */
async function sweepAndPromote(tx: Tx, now: Date, config: QueueConfig) {
  const rows = await gated(tx);
  const expired = findExpired(rows, now, config);
  if (expired.length) {
    await tx
      .update(sessions)
      .set({ status: 'abandoned', endedAt: now })
      .where(
        inArray(
          sessions.id,
          expired.map((e) => e.id),
        ),
      );
  }
  const gone = new Set(expired.map((e) => e.id));
  const alive = rows.filter((r) => !gone.has(r.id));
  const active = alive.filter((r) => r.status === 'active');
  const queued = alive.filter((r) => r.status === 'queued');
  const promote = nextToPromote(queued, freeSlots(active.length, config));
  if (promote.length) {
    await tx
      .update(sessions)
      .set({
        status: 'active',
        activatedAt: now,
        promotedAt: now,
        confirmedAt: null,
        lastHeartbeatAt: now,
      })
      .where(
        inArray(
          sessions.id,
          promote.map((p) => p.id),
        ),
      );
  }
}

async function stateOf(tx: Tx, id: string, now: Date, config: QueueConfig): Promise<QueueState> {
  const rows = await gated(tx);
  const me = (
    await tx
      .select({ ...slotColumns, mode: sessions.mode })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1)
  )[0];
  if (!me) throw new Error('session not found');
  const activeCount = rows.filter((r) => r.status === 'active').length;
  const queued = rows.filter((r) => r.status === 'queued');
  const position = me.status === 'queued' ? queuePosition(queued, id) : null;
  const awaiting = me.status === 'active' && me.confirmedAt === null && me.mode !== 'text';
  return {
    status: me.status,
    ready: me.status === 'active' && me.confirmedAt !== null,
    needsConfirmation: awaiting,
    confirmSecondsLeft: awaiting ? confirmSecondsLeft(me.promotedAt, now, config) : null,
    position,
    waitSeconds: position ? estimateWaitSeconds(position, config) : null,
    activeCount,
    maxActive: config.maxActive,
  };
}

async function withGate<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    return work(tx);
  });
}

/**
 * Puts a new session in line. If a slot is free it starts immediately, otherwise it waits (FIFO).
 * Text interviews don't use speech services, so they never wait.
 */
export async function joinGate(
  db: Db,
  id: string,
  now: Date,
  config = queueConfigFromEnv(),
): Promise<QueueState> {
  return withGate(db, async (tx) => {
    await sweepAndPromote(tx, now, config);
    // Joining is the first thing a new session does. If it already holds a slot (its own promotion, or one
    // handed out a moment earlier by a concurrent join), nobody was waiting, so no confirmation is needed.
    await tx
      .update(sessions)
      .set({ confirmedAt: now, startedAt: now, promotedAt: null })
      .where(
        and(
          eq(sessions.id, id),
          eq(sessions.status, 'active'),
          sql`${sessions.confirmedAt} is null`,
        ),
      );
    return stateOf(tx, id, now, config);
  });
}

/** Polled by the waiting room and by the interview room. Doubles as the heartbeat. */
export async function touchGate(
  db: Db,
  id: string,
  now: Date,
  config = queueConfigFromEnv(),
): Promise<QueueState> {
  return withGate(db, async (tx) => {
    await tx
      .update(sessions)
      .set({ lastHeartbeatAt: now })
      .where(and(eq(sessions.id, id), inArray(sessions.status, ['queued', 'active'])));
    await sweepAndPromote(tx, now, config);
    return stateOf(tx, id, now, config);
  });
}

/** The promoted candidate presses "I'm ready". */
export async function confirmReady(
  db: Db,
  id: string,
  now: Date,
  config = queueConfigFromEnv(),
): Promise<QueueState> {
  return withGate(db, async (tx) => {
    await sweepAndPromote(tx, now, config);
    await tx
      .update(sessions)
      .set({ confirmedAt: now, startedAt: now, lastHeartbeatAt: now })
      .where(
        and(
          eq(sessions.id, id),
          eq(sessions.status, 'active'),
          sql`${sessions.confirmedAt} is null`,
        ),
      );
    return stateOf(tx, id, now, config);
  });
}

/** Leaves the queue (or gives up a reserved slot). */
export async function leaveGate(
  db: Db,
  id: string,
  now: Date,
  config = queueConfigFromEnv(),
): Promise<QueueState> {
  return withGate(db, async (tx) => {
    await tx
      .update(sessions)
      .set({ status: 'abandoned', endedAt: now })
      .where(and(eq(sessions.id, id), inArray(sessions.status, ['queued', 'active'])));
    await sweepAndPromote(tx, now, config);
    return stateOf(tx, id, now, config);
  });
}
