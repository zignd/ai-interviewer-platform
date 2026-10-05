import { desc, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { decisions, evaluations, jobs, recordings, sessions, turns } from './schema';
import {
  durationMs,
  replayOffsets,
  scoreTrend,
  talkRatio,
  topicCoverage,
  type ReplayTurn,
  type TalkRatio,
  type TopicCoverage,
} from '@/lib/analytics/metrics';
import { evaluationSchema, type DecisionSnapshot } from '@/lib/engine/types';

export type SessionMetrics = {
  durationMs: number | null;
  talk: TalkRatio;
  coverage: TopicCoverage;
  trend: number[];
  overallScore: number | null;
};

export type HistoryRow = {
  id: string;
  roleSlug: string;
  roleTitle: string;
  status: 'queued' | 'active' | 'completed' | 'abandoned';
  mode: 'text' | 'voice' | 'video';
  createdAt: Date;
  metrics: SessionMetrics;
};

type TurnRow = typeof turns.$inferSelect;
type DecisionRow = typeof decisions.$inferSelect;

export function computeMetrics(
  session: { startedAt: Date | null; endedAt: Date | null },
  sessionTurns: TurnRow[],
  sessionDecisions: DecisionRow[],
  evaluationJson: unknown,
): SessionMetrics {
  const snaps = sessionDecisions.map((d) => d.stateJson as DecisionSnapshot);
  const parsed = evaluationJson ? evaluationSchema.safeParse(evaluationJson) : null;
  return {
    durationMs: durationMs(session.startedAt, session.endedAt),
    talk: talkRatio(sessionTurns),
    coverage: topicCoverage(snaps.length ? snaps[snaps.length - 1] : null),
    trend: scoreTrend(snaps),
    overallScore: parsed?.success ? parsed.data.overall_score : null,
  };
}

/** Sessions, newest first, optionally for one role. */
export async function listHistory(
  db: Db,
  opts: { roleSlug?: string; limit?: number } = {},
): Promise<HistoryRow[]> {
  const base = db
    .select({ session: sessions, job: jobs })
    .from(sessions)
    .innerJoin(jobs, eq(sessions.jobId, jobs.id));
  const rows = await (opts.roleSlug ? base.where(eq(jobs.slug, opts.roleSlug)) : base)
    .orderBy(desc(sessions.createdAt))
    .limit(opts.limit ?? 100);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.session.id);
  const [allTurns, allDecisions, allEvals] = await Promise.all([
    db.select().from(turns).where(inArray(turns.sessionId, ids)),
    db.select().from(decisions).where(inArray(decisions.sessionId, ids)),
    db.select().from(evaluations).where(inArray(evaluations.sessionId, ids)),
  ]);
  return rows.map(({ session, job }) => ({
    id: session.id,
    roleSlug: job.slug,
    roleTitle: job.title,
    status: session.status,
    mode: session.mode,
    createdAt: session.createdAt,
    metrics: computeMetrics(
      session,
      allTurns.filter((t) => t.sessionId === session.id).sort((a, b) => a.idx - b.idx),
      allDecisions.filter((d) => d.sessionId === session.id).sort((a, b) => a.turnIdx - b.turnIdx),
      allEvals.find((e) => e.sessionId === session.id)?.json,
    ),
  }));
}

export type ReplayData =
  | { state: 'none' }
  | { state: 'deleted' }
  | { state: 'stored'; kind: 'video' | 'audio'; url: string; turns: ReplayTurn[] };

/** What the results page needs to replay a session: the newest stored recording and the turn offsets. */
export async function getReplayData(db: Db, sessionId: string): Promise<ReplayData> {
  const recs = await db
    .select()
    .from(recordings)
    .where(eq(recordings.sessionId, sessionId))
    .orderBy(desc(recordings.createdAt));
  const stored = recs.find((r) => r.status === 'stored' && r.blobUrl);
  if (!stored)
    return recs.some((r) => r.status === 'deleted') ? { state: 'deleted' } : { state: 'none' };
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  const sessionTurns = await db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(turns.idx);
  return {
    state: 'stored',
    kind: stored.kind,
    // The Blob store is private, so playback goes through our own media route.
    url: `/api/recordings/${stored.id}/media`,
    turns: replayOffsets(sessionTurns, session?.startedAt ?? sessionTurns[0]?.startedAt),
  };
}

export async function sessionMetrics(db: Db, sessionId: string): Promise<SessionMetrics | null> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) return null;
  const [t, d, e] = await Promise.all([
    db.select().from(turns).where(eq(turns.sessionId, sessionId)).orderBy(turns.idx),
    db
      .select()
      .from(decisions)
      .where(eq(decisions.sessionId, sessionId))
      .orderBy(decisions.turnIdx),
    db.select().from(evaluations).where(eq(evaluations.sessionId, sessionId)).limit(1),
  ]);
  return computeMetrics(session, t, d, e[0]?.json);
}
