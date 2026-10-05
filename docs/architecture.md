# Architecture

[Back to the README](../README.md) · Related: [interview engine](interview-engine.md), [data model](data-model.md), [capacity queue](capacity-queue.md), [recording storage](recording-storage.md), [history and replay](history-and-replay.md), [voice pipeline](voice-pipeline.md), [testing](testing.md), [setup](setup.md), [decision records](adr/README.md)

AI Interviewer is one Next.js app on Vercel. Server routes keep every API key private, Supabase Postgres stores the data, and the interviewer's decisions are made by plain code in a server-side engine. The language model only writes the words and scores the result.

## System overview

Solid arrows are the base plan. Dashed arrows are features added in later milestones (recordings, and the optional ElevenLabs Agents transport).

```mermaid
flowchart LR
    subgraph Browser["Browser (Next.js client)"]
        UI["Interview Room UI<br/>question card, answer box,<br/>results"]
        MIC["Mic and camera<br/>getUserMedia"]
        REC["MediaRecorder<br/>session recording"]
        PLAY["Audio playback"]
    end

    subgraph Vercel["Vercel (Next.js API routes)"]
        JOIN["Capacity gate<br/>join, queue, heartbeat"]
        TOKEN["Token minting"]
        TURN["POST /turn<br/>interview engine"]
        EVAL["Evaluation<br/>Zod-checked JSON"]
    end

    subgraph Engine["Interview engine"]
        ANALYZE["Analyze step<br/>fast model"]
        POLICY["Policy step<br/>plain code rules"]
        GEN["Generate step<br/>strong model"]
    end

    subgraph ElevenLabs["ElevenLabs"]
        SCRIBE["Scribe v2 Realtime<br/>speech-to-text"]
        FLASH["Flash<br/>text-to-speech"]
    end

    OR["OpenRouter<br/>text LLMs"]
    DB[("Supabase Postgres")]
    BLOB[("Vercel Blob<br/>recordings")]

    UI --> TURN
    TURN --> ANALYZE --> POLICY --> GEN
    ANALYZE --> OR
    GEN --> OR
    TURN <--> DB
    TURN -->|"next question and decision"| UI
    UI -->|"end of interview"| EVAL
    EVAL --> OR
    EVAL --> DB

    UI -.-> JOIN
    JOIN -.-> DB
    UI -.-> TOKEN
    MIC -.->|"audio"| SCRIBE
    SCRIBE -.->|"transcripts"| UI
    UI -.->|"question text"| FLASH
    FLASH -.->|"audio"| PLAY
    MIC -.-> REC
    REC -.->|"upload"| BLOB
```

## One turn, step by step

```mermaid
sequenceDiagram
    participant C as Candidate
    participant B as Browser
    participant API as Engine (Vercel)
    participant L as OpenRouter LLMs
    participant D as Supabase Postgres

    C->>B: Types (or speaks) an answer
    B->>API: POST /api/sessions/:id/turn
    API->>L: Analyze (skills, depth, gaps)
    API->>API: Policy decides FOLLOW_UP, BANK or WRAP_UP
    API->>L: Generate the next question
    API->>D: Save both turns, decision snapshot and state
    API-->>B: Question, kind, progress, decision
    B-->>C: Shows the next question
    Note over B,API: When the policy says WRAP_UP the browser calls /evaluate and shows the results page
```

## Access control and capacity

```mermaid
flowchart LR
    R["Any request"] --> P{"proxy.ts<br/>DEMO_PASSWORD set?"}
    P -- "no cookie" --> GATE["/gate page<br/>password form"]
    GATE -->|"POST /api/gate"| COOKIE["demo_auth cookie<br/>(hash, not the password)"]
    P -- "cookie ok" --> APP["Pages and API routes"]
    P -. "open: /gate, /api/cron/*, /api/agent-llm/*<br/>(each checks its own secret)" .-> APP
    APP -->|"voice or video session"| CAP["Capacity gate<br/>max 4 active, FIFO queue"]
    CAP -->|"confirmed slot only"| TOK["Speech token, TTS, agent session"]
    CRON["Vercel Cron, daily<br/>/api/cron/keep-alive"] -->|"CRON_SECRET"| DB[("Supabase Postgres")]
```

See [capacity queue](capacity-queue.md) for the join, heartbeat and promotion flow.

## Recordings, history and replay

```mermaid
flowchart LR
    CAM["Camera and mic<br/>(optional, with consent)"] --> REC["MediaRecorder<br/>compressed in the browser"]
    REC -->|"POST /api/recordings/prepare"| BUD["Budget check<br/>delete oldest, pending row"]
    BUD -->|"size-capped token"| BLOB[("Vercel Blob")]
    REC -->|"upload, then /complete"| BLOB
    BLOB --> ROWS[("recordings table")]
    ROWS --> HIST["/history and /sessions/[id]<br/>replay, metrics"]
    TURNS[("turns, decisions, evaluations")] --> HIST
```

Details: [recording storage](recording-storage.md) and [history and replay](history-and-replay.md).

## Deployment view

Production: <https://ai-interviewer-cyan-three.vercel.app> (Vercel project `ai-interviewer`, protected by the demo password, which is shared separately).

```mermaid
flowchart TB
    User["Candidate's browser"] -->|"HTTPS"| Vercel
    subgraph Vercel["Vercel project: ai-interviewer"]
        Proxy["proxy.ts: demo password gate"]
        Pages["Server and client components"]
        Routes["API route handlers"]
        Cron["Daily cron: keep-alive"]
    end
    Proxy --> Pages
    Proxy --> Routes
    Routes -->|"pooled connection, port 6543"| Supabase[("Supabase Postgres<br/>free tier")]
    Cron -->|"select 1"| Supabase
    Routes -->|"HTTPS"| OpenRouter["OpenRouter"]
    Routes -->|"HTTPS"| ElevenLabs["ElevenLabs"]
    User -->|"client upload, size-capped token"| Blob[("Vercel Blob<br/>free tier")]
    Dev["Developer machine"] -->|"vercel deploy --prod<br/>from a git-free copy"| Vercel
```

The app is deployed from a copy of the project **without `.git`**. Vercel Hobby blocks deployments whose git metadata points at a GitHub organisation repository (here `AQ-Assessment`), so attaching no git metadata is what lets the deploy through. See [setup](setup.md).

## Key decisions

- **Plain code decides, the model writes.** The follow-up rules, question limits and topic choice are deterministic and tested. See [interview-engine.md](interview-engine.md).
- **Ports and adapters.** The engine depends on small interfaces in `lib/ports` (language model, speech, blob storage, clock). Real adapters and deterministic fakes implement them, so tests run without any vendor.
- **Validated boundaries.** Zod validates environment variables, every request body, and every model response.
- **Serverless friendly.** Database access uses the pooled connection with prepared statements disabled, and a tiny connection pool.
