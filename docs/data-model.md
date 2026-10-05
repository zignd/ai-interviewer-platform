# Data model

[Back to the README](../README.md) · Related: [architecture](architecture.md), [interview engine](interview-engine.md)

Postgres on Supabase, accessed with Drizzle. The schema lives in `lib/db/schema.ts` and the SQL migrations in `drizzle/`.

```mermaid
erDiagram
    jobs ||--o{ question_bank : has
    jobs ||--o{ sessions : "interviewed for"
    sessions ||--o{ turns : contains
    sessions ||--o{ decisions : records
    sessions ||--o| evaluations : "scored by"
    sessions ||--o{ recordings : "recorded as"
    question_bank ||--o{ turns : "source of"

    jobs {
        uuid id PK
        text slug UK
        text title
        text description
        text seniority
        jsonb competencies
        jsonb keyterms
    }
    question_bank {
        uuid id PK
        uuid job_id FK
        enum category "behavioral or technical"
        text topic
        text text
        int difficulty
        jsonb follow_up_hints
        int priority
    }
    sessions {
        uuid id PK
        uuid job_id FK
        enum mode "text, voice or video"
        enum status "queued, active, completed, abandoned"
        timestamptz started_at
        timestamptz ended_at
        timestamptz queued_at
        timestamptz activated_at
        timestamptz last_heartbeat_at
        timestamptz promoted_at "slot reserved from the queue"
        timestamptz confirmed_at "candidate confirmed or joined directly"
        jsonb state
    }
    turns {
        uuid id PK
        uuid session_id FK
        int idx "unique per session"
        enum role "interviewer or candidate"
        text text
        enum kind "bank, follow_up or generated"
        uuid source_question_id FK
        timestamptz started_at
        timestamptz ended_at
        int audio_ms
    }
    decisions {
        uuid id PK
        uuid session_id FK
        int turn_idx "unique per session"
        jsonb state_json
    }
    evaluations {
        uuid session_id PK
        jsonb json
    }
    recordings {
        uuid id PK
        uuid session_id FK
        enum kind "video or audio"
        text blob_url
        bigint size_bytes
        enum status "pending, stored, deleted"
        timestamptz deleted_at
    }
```

## Status fields

| Field                   | Values                   | Meaning                                                                                                                       |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `sessions.status`       | `queued`                 | Waiting for a free interview slot ([capacity queue](capacity-queue.md)).                                                      |
|                         | `active`                 | The candidate holds a slot. They may answer questions only once `confirmed_at` is set.                                        |
|                         | `completed`              | The interview ended normally and can be evaluated.                                                                            |
|                         | `abandoned`              | The candidate left or stopped responding.                                                                                     |
| `sessions.mode`         | `text`, `voice`, `video` | How the candidate answers. Text is always available as a fallback.                                                            |
| `turns.kind`            | `bank`                   | A question from the role's question bank, possibly lightly rephrased.                                                         |
|                         | `follow_up`              | A question that builds on the previous answer.                                                                                |
|                         | `generated`              | Other interviewer text, such as the closing message.                                                                          |
| `recordings.status`     | `pending`                | Reserved by `/api/recordings/prepare` and counted against the storage budget until upload completes (stale after 15 minutes). |
|                         | `stored`                 | Uploaded to Vercel Blob; `blob_url` and the real `size_bytes` are set.                                                        |
|                         | `deleted`                | Removed from Blob to stay under the budget (oldest first); the row stays so the UI can say so.                                |
| `sessions.promoted_at`  | timestamp                | When a queued session was given a slot and had to confirm.                                                                    |
| `sessions.confirmed_at` | timestamp                | When the candidate confirmed, or when a direct join started the interview. Interviews and speech tokens need it.              |

## What is kept

Transcripts, decision snapshots and evaluations are small and stay in Postgres indefinitely. Only recordings are rotated by the storage budget rules ([recording storage](recording-storage.md)); the replay and metrics pages read them ([history and replay](history-and-replay.md)).

## Seeds

`lib/seed` defines three roles (Frontend Engineer, Data Analyst, Customer Success Manager) with 8 topics each and one behavioral and one technical question per topic, with follow-up hints. Rows have deterministic IDs, so re-seeding updates them in place instead of orphaning turn references. Run it with `npm run db:seed`.
