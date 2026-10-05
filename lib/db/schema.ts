import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const questionCategory = pgEnum('question_category', ['behavioral', 'technical']);
export const sessionMode = pgEnum('session_mode', ['text', 'voice', 'video']);
export const sessionStatus = pgEnum('session_status', [
  'queued',
  'active',
  'completed',
  'abandoned',
]);
export const turnRole = pgEnum('turn_role', ['interviewer', 'candidate']);
export const turnKind = pgEnum('turn_kind', ['bank', 'follow_up', 'generated']);
export const recordingKind = pgEnum('recording_kind', ['video', 'audio']);
export const recordingStatus = pgEnum('recording_status', ['pending', 'stored', 'deleted']);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    seniority: text('seniority').notNull(),
    competencies: jsonb('competencies').$type<string[]>().notNull(),
    /** Role vocabulary passed to speech-to-text as keyterms. */
    keyterms: jsonb('keyterms')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [uniqueIndex('jobs_slug_idx').on(t.slug)],
);

export const questionBank = pgTable(
  'question_bank',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    category: questionCategory('category').notNull(),
    topic: text('topic').notNull(),
    text: text('text').notNull(),
    difficulty: integer('difficulty').notNull().default(2),
    followUpHints: jsonb('follow_up_hints')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Lower number = asked earlier when the topic is still uncovered. */
    priority: integer('priority').notNull().default(50),
  },
  (t) => [index('question_bank_job_idx').on(t.jobId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    mode: sessionMode('mode').notNull().default('text'),
    status: sessionStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    /** When a queued session was given a free slot and must confirm it is ready. */
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    /** When the candidate confirmed (or joined directly). Interviews only run once confirmed. */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    /** Interview state machine (see lib/engine/types.ts). */
    state: jsonb('state').$type<unknown>(),
  },
  (t) => [index('sessions_status_idx').on(t.status), index('sessions_job_idx').on(t.jobId)],
);

export const recordings = pgTable(
  'recordings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    kind: recordingKind('kind').notNull(),
    blobUrl: text('blob_url'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: recordingStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('recordings_status_created_idx').on(t.status, t.createdAt)],
);

export const turns = pgTable(
  'turns',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    role: turnRole('role').notNull(),
    text: text('text').notNull(),
    kind: turnKind('kind'),
    sourceQuestionId: uuid('source_question_id').references(() => questionBank.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    audioMs: integer('audio_ms'),
  },
  (t) => [uniqueIndex('turns_session_idx_idx').on(t.sessionId, t.idx)],
);

export const decisions = pgTable(
  'decisions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    turnIdx: integer('turn_idx').notNull(),
    stateJson: jsonb('state_json').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('decisions_session_turn_idx').on(t.sessionId, t.turnIdx)],
);

export const evaluations = pgTable('evaluations', {
  sessionId: uuid('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  json: jsonb('json').$type<unknown>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Job = typeof jobs.$inferSelect;
export type QuestionBankRow = typeof questionBank.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type RecordingRow = typeof recordings.$inferSelect;
export type TurnRow = typeof turns.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;
export type EvaluationRow = typeof evaluations.$inferSelect;
