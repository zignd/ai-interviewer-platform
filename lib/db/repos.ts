import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from './client';
import {
  decisions,
  evaluations,
  jobs,
  questionBank,
  recordings,
  type RecordingRow,
  sessions,
  turns,
  type DecisionRow,
  type EvaluationRow,
  type Job,
  type QuestionBankRow,
  type SessionRow,
  type TurnRow,
} from './schema';

export type NewTurn = {
  sessionId: string;
  idx: number;
  role: 'interviewer' | 'candidate';
  text: string;
  kind?: 'bank' | 'follow_up' | 'generated' | null;
  sourceQuestionId?: string | null;
  startedAt?: Date;
  endedAt?: Date | null;
  audioMs?: number | null;
};

/** Thrown when two requests race to write the same turn index. */
export class TurnConflictError extends Error {
  constructor() {
    super('Turn already recorded for this index');
  }
}

export function createRepos(db: Db) {
  return {
    db,

    jobs: {
      list: (): Promise<Job[]> => db.select().from(jobs).orderBy(asc(jobs.title)),
      byId: async (id: string): Promise<Job | null> =>
        (await db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0] ?? null,
      bySlug: async (slug: string): Promise<Job | null> =>
        (await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1))[0] ?? null,
    },

    bank: {
      forJob: (jobId: string): Promise<QuestionBankRow[]> =>
        db
          .select()
          .from(questionBank)
          .where(eq(questionBank.jobId, jobId))
          .orderBy(asc(questionBank.priority)),
    },

    sessions: {
      create: async (input: {
        jobId: string;
        mode: 'text' | 'voice' | 'video';
        status?: 'queued' | 'active';
        state?: unknown;
        now: Date;
      }): Promise<SessionRow> => {
        const status = input.status ?? 'active';
        const [row] = await db
          .insert(sessions)
          .values({
            jobId: input.jobId,
            mode: input.mode,
            status,
            state: input.state ?? null,
            startedAt: status === 'active' ? input.now : null,
            activatedAt: status === 'active' ? input.now : null,
            confirmedAt: status === 'active' ? input.now : null,
            queuedAt: status === 'queued' ? input.now : null,
            lastHeartbeatAt: input.now,
          })
          .returning();
        return row;
      },
      byId: async (id: string): Promise<SessionRow | null> =>
        (await db.select().from(sessions).where(eq(sessions.id, id)).limit(1))[0] ?? null,
      setState: async (id: string, state: unknown) => {
        await db.update(sessions).set({ state }).where(eq(sessions.id, id));
      },
      complete: async (id: string, now: Date) => {
        await db
          .update(sessions)
          .set({ status: 'completed', endedAt: now })
          .where(and(eq(sessions.id, id), eq(sessions.status, 'active')));
      },
      listForJob: (jobId: string) =>
        db
          .select()
          .from(sessions)
          .where(eq(sessions.jobId, jobId))
          .orderBy(desc(sessions.createdAt)),
    },

    turns: {
      list: (sessionId: string): Promise<TurnRow[]> =>
        db.select().from(turns).where(eq(turns.sessionId, sessionId)).orderBy(asc(turns.idx)),
      append: async (turn: NewTurn): Promise<TurnRow> => {
        try {
          const [row] = await db
            .insert(turns)
            .values({
              sessionId: turn.sessionId,
              idx: turn.idx,
              role: turn.role,
              text: turn.text,
              kind: turn.kind ?? null,
              sourceQuestionId: turn.sourceQuestionId ?? null,
              startedAt: turn.startedAt,
              endedAt: turn.endedAt ?? null,
              audioMs: turn.audioMs ?? null,
            })
            .returning();
          return row;
        } catch (err) {
          if (isUniqueViolation(err)) throw new TurnConflictError();
          throw err;
        }
      },
    },

    decisions: {
      save: async (sessionId: string, turnIdx: number, stateJson: unknown) => {
        await db
          .insert(decisions)
          .values({ sessionId, turnIdx, stateJson })
          .onConflictDoUpdate({
            target: [decisions.sessionId, decisions.turnIdx],
            set: { stateJson },
          });
      },
      list: (sessionId: string): Promise<DecisionRow[]> =>
        db
          .select()
          .from(decisions)
          .where(eq(decisions.sessionId, sessionId))
          .orderBy(asc(decisions.turnIdx)),
    },

    evaluations: {
      get: async (sessionId: string): Promise<EvaluationRow | null> =>
        (
          await db.select().from(evaluations).where(eq(evaluations.sessionId, sessionId)).limit(1)
        )[0] ?? null,
      /** First write wins, so double clicks and retries are harmless. */
      saveOnce: async (sessionId: string, json: unknown): Promise<EvaluationRow> => {
        await db.insert(evaluations).values({ sessionId, json }).onConflictDoNothing();
        return (
          await db.select().from(evaluations).where(eq(evaluations.sessionId, sessionId)).limit(1)
        )[0];
      },
    },

    recordings: {
      /** Serialises budget decisions across concurrent uploads (released at the end of the transaction). */
      lock: async () => {
        await db.execute(sql`select pg_advisory_xact_lock(727001)`);
      },
      /** Bytes used by pending and stored recordings. */
      sumUsage: async (): Promise<number> => {
        const rows = await db
          .select({ total: sql<string>`coalesce(sum(${recordings.sizeBytes}), 0)` })
          .from(recordings)
          .where(inArray(recordings.status, ['pending', 'stored']));
        return Number(rows[0]?.total ?? 0);
      },
      listStoredOldestFirst: (): Promise<RecordingRow[]> =>
        db
          .select()
          .from(recordings)
          .where(eq(recordings.status, 'stored'))
          .orderBy(asc(recordings.createdAt)),
      createPending: async (input: {
        sessionId: string;
        kind: 'video' | 'audio';
        sizeBytes: number;
        now: Date;
      }): Promise<RecordingRow> => {
        const [row] = await db
          .insert(recordings)
          .values({
            sessionId: input.sessionId,
            kind: input.kind,
            sizeBytes: input.sizeBytes,
            status: 'pending',
            createdAt: input.now,
          })
          .returning();
        return row;
      },
      byId: async (id: string): Promise<RecordingRow | null> =>
        (await db.select().from(recordings).where(eq(recordings.id, id)).limit(1))[0] ?? null,
      forSession: async (sessionId: string): Promise<RecordingRow | null> =>
        (
          await db
            .select()
            .from(recordings)
            .where(eq(recordings.sessionId, sessionId))
            .orderBy(desc(recordings.createdAt))
            .limit(1)
        )[0] ?? null,
      markStored: async (id: string, input: { blobUrl: string; sizeBytes: number }) => {
        await db
          .update(recordings)
          .set({ status: 'stored', blobUrl: input.blobUrl, sizeBytes: input.sizeBytes })
          .where(and(eq(recordings.id, id), eq(recordings.status, 'pending')));
      },
      markDeleted: async (ids: string[], now: Date) => {
        if (ids.length === 0) return;
        await db
          .update(recordings)
          .set({ status: 'deleted', deletedAt: now })
          .where(inArray(recordings.id, ids));
      },
      /** Uploads recorded since `since`, whatever their status, for the monthly guard. */
      countCreatedSince: async (since: Date): Promise<number> => {
        const rows = await db
          .select({ n: sql<string>`count(*)` })
          .from(recordings)
          .where(gte(recordings.createdAt, since));
        return Number(rows[0]?.n ?? 0);
      },
      /** Pending rows older than `before` never finished uploading: free their reserved space. */
      expireStalePending: async (before: Date, now: Date) => {
        await db
          .update(recordings)
          .set({ status: 'deleted', deletedAt: now })
          .where(and(eq(recordings.status, 'pending'), lt(recordings.createdAt, before)));
      },
    },

    health: async () => {
      await db.execute(sql`select 1`);
    },
  };
}

export type Repos = ReturnType<typeof createRepos>;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
