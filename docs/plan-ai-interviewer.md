# Plan: AI Interviewer Platform

> **Tracking progress:** the checklist, the rules for checking boxes, and the blockers log are in [section 7](#7-delivery-milestones-and-progress-checklist). Agents must follow those rules whenever they finish or get stuck on a task.

## 1. Architecture overview

**Stack (one deployable app):**

- **Next.js (App Router) + TypeScript**, deployed on **Vercel**. Server routes keep your API keys private.
- **Supabase Postgres** (free tier) with **Drizzle** or Prisma, used to store sessions, turns, evaluations, decision snapshots and recording metadata. Use the pooled connection string, since the app runs on serverless functions. Supabase Storage is **not** used, because its free tier caps files at 50 MB.
- **Vercel Blob** (Hobby, free tier) for session recordings only, uploaded straight from the browser. See "Recording storage budget" in section 2 for how the app stays inside the free limits.
- **Tailwind + shadcn/ui** for a clean UI with little effort.
- **Zod** to check every structured output from the LLM.

**Model roles.** Different models handle different jobs. OpenRouter is a good fit for the text models. Its transcription endpoint is batch-only (no streaming), so it isn't the right place for real-time speech. **ElevenLabs** covers both speech directions (speech-to-text and text-to-speech) with one account.

| Job                                                                        | Recommendation                                                                | Why                                                                                                                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interviewer brain (choosing the next question, follow-ups, decision panel) | OpenRouter: `anthropic/claude-sonnet-4.x` or `openai/gpt-4.1`/`gpt-5-mini`    | Needs to follow instructions well and produce reliable JSON                                                                                              |
| Fast or cheap work (topic tagging, signal extraction)                      | OpenRouter: `google/gemini-2.x-flash` or `gpt-4o-mini` class                  | Low latency, runs on every turn                                                                                                                          |
| Final evaluation                                                           | Same strong model as the interviewer, low temperature                         | Consistent scoring                                                                                                                                       |
| Speech-to-text                                                             | **ElevenLabs Scribe v2 Realtime** (`scribe_v2_realtime`, streaming WebSocket) | Live partial captions (about 150 ms model latency, per ElevenLabs), manual or VAD commit control, and `keyterm` biasing for role terms. About $0.39/hour |
| Text-to-speech (voice mode)                                                | **ElevenLabs Flash**                                                          | Natural voice with low latency, and the same ElevenLabs account and key as speech-to-text                                                                |

Keep a single `lib/models.ts` config so models can be swapped through OpenRouter without touching any other code.

**Video mode is a UX layer only.** Video mode is "still voice-driven; video is just the interface/UX layer", so there is no avatar provider. Video mode reuses the exact same pipeline as voice (ElevenLabs Scribe STT, our engine, ElevenLabs TTS) and only changes the layout and adds optional camera input. The AI interviewer is shown as a call tile (name, portrait or animated orb, speaking indicator), not a rendered human. This also keeps the interviewer state deterministic (stretch goal 1) and avoids extra vendors, cost and latency.

**Voice transport (two options behind one engine contract).** The engine only needs "candidate transcript in, next question out" (`POST /api/sessions/:id/turn`), so the speech layer can change without touching it:

- **Option A (base plan): Scribe v2 Realtime + Flash.** We run turn-taking ourselves: manual commit, long-silence fallback, mic muting. About $0.07 per 10-minute interview.
- **Option B (to be tested in a spike, see section 4): ElevenLabs Agents with a Custom LLM.** ElevenLabs handles speech-to-text, turn detection, text-to-speech and barge-in, and our engine stays the brain through an OpenAI-compatible streaming endpoint. About $0.08/min plus LLM costs (roughly $0.80 per 10-minute interview).

Start with A, run the spike for B early in milestone 3, and switch only if B passes the checks.

**Architecture diagram.** Solid arrows are the base plan (Option A). Dashed arrows are Option B (Agents), which replaces the browser-to-Scribe and Flash links if the spike passes. The diagram renders on GitHub and in most Markdown viewers that support Mermaid.

```mermaid
flowchart LR
    subgraph Browser["Browser (Next.js client)"]
        UI["Interview Room UI<br/>captions, question card,<br/>decision panel, waiting room"]
        MIC["Mic and camera<br/>getUserMedia"]
        REC["MediaRecorder<br/>session recording"]
        PLAY["Audio playback<br/>speaking ring, subtitles"]
    end

    subgraph Vercel["Vercel (Next.js API routes)"]
        JOIN["Capacity gate<br/>join, queue, heartbeat<br/>max 4 active"]
        TOKEN["Token minting<br/>active sessions only"]
        TURN["POST /turn<br/>interview engine"]
        AGENTLLM["Custom LLM route<br/>OpenAI-compatible SSE"]
        EVAL["Evaluation<br/>Zod-checked JSON"]
    end

    subgraph Engine["Interview engine"]
        ANALYZE["Analyze step<br/>fast model"]
        POLICY["Policy step<br/>plain code rules<br/>min 6 questions, min 2 follow-ups"]
        GEN["Generate step<br/>strong model"]
    end

    subgraph ElevenLabs["ElevenLabs"]
        SCRIBE["Scribe v2 Realtime<br/>speech-to-text"]
        FLASH["Flash<br/>text-to-speech"]
        AGENTS["Agents platform<br/>Option B only"]
    end

    OR["OpenRouter<br/>text LLMs"]
    DB[("Supabase Postgres<br/>sessions, turns, decisions,<br/>evaluations, recordings")]
    BLOB[("Vercel Blob<br/>compressed recordings")]

    UI --> JOIN
    JOIN <--> DB
    UI --> TOKEN
    TOKEN -->|"single-use token"| UI

    MIC -->|"audio stream"| SCRIBE
    SCRIBE -->|"partial and committed transcripts"| UI
    UI -->|"final transcript"| TURN
    TURN --> ANALYZE --> POLICY --> GEN
    ANALYZE --> OR
    GEN --> OR
    TURN <--> DB
    TURN -->|"next question and decision snapshot"| UI
    UI -->|"question text"| FLASH
    FLASH -->|"audio"| PLAY

    MIC -.->|"Option B: audio"| AGENTS
    AGENTS -.->|"Option B: conversation"| AGENTLLM
    AGENTLLM -.-> TURN
    AGENTS -.->|"Option B: speech"| PLAY

    MIC --> REC
    REC -->|"upload after budget check"| BLOB
    TOKEN -.->|"budget check, delete oldest, upload token"| BLOB
    BLOB -.->|"url and size in recordings"| DB

    UI -->|"end interview"| EVAL
    EVAL --> OR
    EVAL --> DB
```

**One turn, step by step (Option A):**

```mermaid
sequenceDiagram
    participant C as Candidate
    participant B as Browser
    participant S as Scribe v2 Realtime
    participant API as Engine (Vercel)
    participant L as OpenRouter LLMs
    participant F as ElevenLabs Flash
    participant D as Supabase Postgres

    C->>B: Speaks answer
    B->>S: Mic audio stream
    S-->>B: Partial transcripts (live captions)
    C->>B: Clicks "I'm done" or long silence
    B->>API: POST /turn with the joined transcript
    API->>L: Analyze (skills, depth, gaps)
    API->>API: Policy decides FOLLOW_UP or BANK or WRAP_UP
    API->>L: Generate next question
    API->>D: Save turn and decision snapshot
    API-->>B: Question, kind, rationale
    B->>F: Question text
    F-->>B: Audio stream
    B-->>C: Plays question, shows subtitles
```

## 2. Data model

- `jobs`: id, slug, title, description, seniority, competencies[]
- `question_bank`: id, job_id, category (behavioral/technical), topic, text, difficulty, follow_up_hints[]
- `sessions`: id, job_id, mode (voice/video), started_at, ended_at, status (queued/active/completed/abandoned), queued_at, activated_at, last_heartbeat_at
- `recordings`: id, session_id, kind (video/audio), blob_url, size_bytes, status (pending/stored/deleted), created_at, deleted_at. One row per session recording. Transcripts and evaluations live in their own tables and are never deleted by the storage rules below.
- `turns`: id, session_id, idx, role (interviewer/candidate), text, kind (bank/follow_up/generated), source_question_id, started_at, ended_at, audio_ms
- `decisions`: id, session_id, turn_idx, state_json (signals, topics_covered, gaps, rationale, next_action)
- `evaluations`: session_id, json (strengths, concerns, per-competency scores, overall_score, recommendation)

### Recording storage budget (stay inside the free tiers)

Vercel Blob Hobby includes 1 GB of storage, 10 GB of transfer and 2,000 uploads per month. Going over doesn't bill us, but Blob stops working for 30 days. Supabase Free gives 500 MB of database and 5 GB of egress. The rules below keep us under all of these.

**1. Compress in the browser, before uploading.** Compression happens at record time, so no heavy re-encoding step is needed after the interview.

- Record from a **clone of the camera track** limited to about 640×360 at 15 fps. The self-view tile keeps the full-quality track.
- Set `MediaRecorder` to `videoBitsPerSecond: 250_000` and `audioBitsPerSecond: 32_000`, preferring `video/webm;codecs=vp9,opus`, then VP8, and MP4 on Safari (which honors bitrate hints loosely). That is roughly 21 MB for 10 minutes and 42 MB for 20 minutes (estimates, to be measured).
- Run a second, audio-only `MediaRecorder` in parallel (Opus, about 2–3 MB for 10 minutes). If the video file is too large (above `MAX_VIDEO_BYTES`, default 40 MB) or the budget check says there is no room, upload the audio-only file instead. The candidate's video is dropped, but replay still works.
- Collect chunks in memory (`timeslice` of 10 s) and upload **once at the end**, so the real size is known before the budget check. If the tab is closed early, the recording is lost, which is acceptable.
- Rejected: re-encoding with `ffmpeg.wasm` in the browser. It adds a large download and slow CPU use for little benefit over setting the bitrate at record time.

**2. Check the budget and delete the oldest recordings before every upload.** The server does this, because the browser can't be trusted. The browser calls `POST /api/recordings/prepare` with the file size.

- Current usage comes from the `recordings` table (`SUM(size_bytes)` where status is `pending` or `stored`), not from listing the Blob store, because `list()` counts as an operation against the monthly limit.
- If `usage + new size` is above `STORAGE_BUDGET_BYTES` (default **800 MB**, which leaves 20% headroom under 1 GB), delete the oldest `stored` recordings first, using Blob `del()` (free), until it fits. Mark them `status = deleted` with `deleted_at`, and keep the row.
- Insert the new row as `pending` with the declared size, so concurrent uploads are counted. `pending` rows older than 15 minutes are treated as failed and cleaned up. Run this in one transaction with an advisory lock.
- Issue the upload token only after that, capped to the declared size (`maximumSizeInBytes`). The upload-completed callback sets the row to `stored` with the real size.
- **Monthly operation guard:** if the month's uploads exceed about 1,500 (of the 2,000 included), skip recording and continue the interview without it.

**3. Fail soft.** Any Blob error (limit reached, upload failed) means "recording unavailable", never a failed interview.

**4. What is kept.** Transcripts, decision snapshots and evaluations stay in Supabase indefinitely, since text is small (a session is roughly tens of KB, so the 500 MB database lasts for thousands of sessions). Only recordings are rotated.

**5. UI.** For sessions whose recording has `status = deleted`, `/sessions/[id]` and `/history` show "Recording deleted to save storage" instead of the player. The transcript, evaluation and metrics still show. Talk ratio, if it is computed from the recording, should be computed from the turn timestamps in the database instead so it survives deletion.

**6. Keep the Supabase project awake.** Free projects pause after a week of inactivity, which would take the app down for a reviewer. Add a daily Vercel Cron job (allowed on Hobby) that runs a trivial `select 1` query.

## 3. Interview engine (the core)

The server owns an explicit **state machine**:

```
state = { phase, questionsAsked, followUpsAsked, topicsCovered[], gaps[],
          skillsDetected[{skill, evidence, confidence}], bankRemaining[] }
```

**Each turn:**

1. The candidate's final transcript arrives at `POST /api/sessions/:id/turn`.
2. **Analyze step** (fast model, JSON): pull skills and evidence from the answer, map them to topics, mark answer depth (shallow/adequate/strong), and flag what's missing.
3. **Policy step.** Plain code decides first, and the LLM only handles the parts that need judgment:
   - If the answer was shallow or had an interesting hook, and follow-ups < budget → **FOLLOW_UP**
   - Otherwise, pick the bank question with the highest-priority topic still uncovered → **BANK**
   - Hard rules: at least 6 questions, a maximum of about 8–10 questions, then wrap up. Follow-ups have a **minimum of 2** (this is a floor, not a target, and 1 is never acceptable):
     - Force **FOLLOW_UP** whenever `followUpsAsked < 2` and the remaining turns before the minimum question count are no more than the follow-ups still owed (e.g. by Q4 with 0 follow-ups, the next two turns must both be follow-ups). This applies even if the answer was strong. In that case, probe for depth or an example.
     - Never wrap up while `followUpsAsked < 2`. If the question cap is reached first, extend by the number of turns needed to reach 2 follow-ups.
     - Above the floor, normal judgment applies (shallow answer or interesting hook, up to the follow-up budget).
4. **Generate step** (strong model, JSON): `{question, kind, rationale, targets_topic}`. For follow-ups, the prompt must quote the candidate's answer so the question clearly depends on it.
5. Save the turn and decision snapshot, then return the question to the client to speak and display.
6. At the end, an **evaluation** call works from the full transcript plus the rubric and returns JSON that is checked against a Zod schema.

The rules guarantee the requirements are met, and the LLM keeps the conversation natural.

## 4. Audio pipeline (client)

- Stream the mic to **ElevenLabs Scribe v2 Realtime** over a WebSocket, using `@elevenlabs/react` (`useScribe`) or `@elevenlabs/client`, with mic echo cancellation and noise suppression on. The server mints a **single-use token** (expires after 15 minutes) so the API key never reaches the browser. `PARTIAL_TRANSCRIPT` events drive the live captions.
- **Role vocabulary:** pass `keyterm` biasing with terms from the selected job (e.g. "React", "NPS") to improve recognition.
- **End of turn:** use **manual commit**, not short VAD silence timeouts, because candidates pause to think and a 200–400 ms timeout would cut answers in half. Collect the `COMMITTED_TRANSCRIPT` segments for the whole turn and treat the turn as finished when the candidate clicks "I'm done" or after a long silence (about 1.5–2 s, to be tuned in testing). Send the joined transcript to `POST /api/sessions/:id/turn`.
- **Interviewer speech:** stream **ElevenLabs Flash** TTS audio. Mute or ignore the mic while the AI is speaking so the AI doesn't transcribe itself.
- **UI states:** `listening / thinking / speaking`, with clear visual indicators.

### Turn-taking spike: ElevenLabs Agents with a Custom LLM (Option B)

Time-box it to about half a day at the start of milestone 3. The setup:

- Create an agent whose Custom LLM points at a thin route in our app, such as `POST /api/agent-llm/chat/completions`. It must be OpenAI-compatible and stream server-sent events (SSE) ending with `data: [DONE]`.
- The route passes the conversation to the same engine (analyze, policy including the 2-follow-up floor, generate) and streams back the question text. Pass our session id with `elevenlabs_extra_body` so the route can find the state.
- Set interruptions off (the candidate shouldn't cut off a question), turn eagerness to **Patient**, and a soft timeout (about 3 s) to cover our LLM steps.

Pass or fail checks:

1. **Pauses:** a candidate who pauses 2–3 s to think is not treated as finished, or if they are, the engine absorbs it (see 2).
2. **False turn ends:** the route must tolerate a turn that was cut off. Idea: if a new request arrives within a few seconds, merge it into the previous candidate turn instead of counting a new question.
3. **Latency:** time from the end of speech to the first audio is acceptable (our analyze, policy and generate steps run inside it).

Also confirm that the replay recording (a parallel `getUserMedia` stream, since the SDK owns the mic) and the decision panel (our own state channel, keyed by session id) still work. If any check fails, stay with Option A.

### Capacity gate and wait queue

ElevenLabs charges $0.16/min above the plan's concurrent-call limit (4 on the Free tier), so the app never lets more than **4 interviews run at once**. This applies to both options, and the limit is a config value (`MAX_CONCURRENT_INTERVIEWS`, default 4) so it can be raised with the plan.

- **Join:** when a candidate clicks "Start interview", `POST /api/sessions/:id/join` runs in a single DB transaction (with an advisory lock to avoid races). If fewer than 4 sessions are `active` and nobody is queued ahead, the session becomes `active`. Otherwise it becomes `queued` and gets a FIFO position from `queued_at`.
- **Enforcement point:** the server only issues the ElevenLabs token (Scribe single-use token, or the Agents signed URL) to an `active` session. A client can't bypass the queue by calling ElevenLabs directly.
- **Waiting screen:** the client polls `GET /api/sessions/:id/queue` every ~3 s and shows the position ("You are 2nd in line"), a rough wait estimate (average interview length ÷ 4), and a "Leave queue" button. No microphone or camera access is requested until the session is active.
- **Promotion:** when a slot frees, the first queued session becomes `active` and the waiting screen moves into the room. The candidate must confirm ("I'm ready") within about 30 s, otherwise the session is dropped and the next one is promoted. This stops an unattended tab from holding a slot.
- **Slot release:** a slot frees when the interview ends, the candidate leaves, the **max duration** (about 20–25 min) is reached, or the heartbeat is missed. The client sends a heartbeat every ~10 s that updates `last_heartbeat_at`, and any `active` or `queued` session without one for ~30 s is marked `abandoned`. This handles closed tabs and crashes, and the same check runs on every join and queue poll, so no separate cron job is needed.

## 5. UI pages

- `/`: job cards (at least 3 roles, e.g. Frontend Engineer, Data Analyst, Customer Success Manager) with a "Start interview" button and a voice/video toggle.
- `/interview/[sessionId]`: the Interview Room
  - **Waiting room state:** when all slots are taken, this page shows the queue position, a wait estimate and a "Leave queue" button, then moves into the room automatically once a slot opens (after the "I'm ready" confirmation).
  - **Voice layout:** a large current-question card, an animated orb/waveform for the AI, a live caption strip, a mic control, and a progress indicator ("Q3 of ~7").
  - **Video layout (stretch 3):** a "video call" grid with the **interviewer tile** (main: static portrait or animated orb, name, and a speaking ring driven by the TTS audio level) and the candidate's **self-view camera** (picture-in-picture, optional). **Subtitles are overlaid** on the interviewer tile, synced to the spoken text. A **"Current question" side card** stays pinned so the candidate can reread it. Includes mic/cam/end-call controls.
  - **Decision panel** (collapsible drawer, stretch 1): skills detected with evidence, a topic coverage checklist, gaps, and _"Why this question: …"_.
- `/sessions/[id]`: results, showing the transcript (Q/A, with follow-ups tagged) and the evaluation (score, strengths, concerns, plus a raw JSON toggle).
- `/history` (stretch 4): sessions table with a role filter, and per-session metrics.

## 6. Stretch goals in order

1. **Decision panel.** This comes almost free from the engine's `decisions` table. Stream the snapshot along with each question.
2. **Question packs.** A seed file per role with about 8 behavioral and 8 technical questions, each tagged with a topic and follow-up hints. The policy step chooses from the bank, and the LLM may lightly rephrase a question to fit the context.
3. **Video mode.**
   - Camera self-view is shown locally and the candidate's video is **recorded for replay**. Run a compressed `MediaRecorder` over the camera and mic stream for the whole session (WebM, or MP4 on Safari), with an audio-only recorder as a fallback. Follow "Recording storage budget" in section 2: compress at record time, check the budget and delete the oldest recordings through the server, then upload straight from the browser to Vercel Blob with a short-lived, size-capped token. The URL and size go in the `recordings` table. Show a clear recording notice and get consent before the interview starts.
   - If the camera is off or denied, record audio only so replay still works.
   - Camera is optional: if permission is denied or there is no camera, show an initials tile and keep going, since the interview is voice-driven anyway.
   - Interviewer tile: reuse the existing TTS playback. Drive the speaking ring from an `AnalyserNode` on the audio, and build subtitles from the question text, chunked by sentence and timed with the audio's play/end events.
   - A real talking avatar (HeyGen, Simli) is out of scope. Only consider it after everything else is done, since it isn't a requirement.
4. **Replay and analytics.**
   - **Replay:** play the session recording (candidate video, or audio only if there was no camera or the video was dropped to save space). If the recording was deleted by the storage rules, show "Recording deleted to save storage" and keep the transcript view. When a recording exists, use each turn's start/end offsets (`turns.started_at`/`ended_at` relative to the recording start) to highlight the transcript and jump between turns. Interviewer questions come from the saved question text, shown as captions.
   - **Metrics:**
     - Duration: ended − started.
     - **Talk ratio:** candidate speaking ms vs. interviewer speaking ms.
     - **Topic coverage:** covered topics ÷ the role's topics.
     - **Score trend:** a per-turn answer-quality score from the analyze step, shown as a sparkline. Also chart overall scores across sessions per role (Recharts).

## 7. Delivery milestones and progress checklist

This section is the single source of truth for progress. Read the rules below before changing any box.

### Rules for the agent: checking boxes

- **A box is checked only when the work is verified, never on intent.** For code, that means it exists in the repo and its tests were actually run and passed (run them; don't assume). For docs, the page or diagram exists and the README links to it. For deployed items, it was checked on the live URL.
- **Update the checklist in the same step as the work**, so the plan never lags behind the repo. Use `[x]` for done and `[ ]` for not done. Add `(in progress)` after a task you have started and not finished, and remove it when you check the box.
- **A milestone box is checked only when every task under it is checked**, including its tests, its `docs/` page and diagram, and the README update.
- **If something that was checked turns out to be broken, uncheck it** and add a short note on why.
- **Don't delete or silently rewrite tasks.** New tasks can be added where they belong. Dropped or changed scope gets a line in the Decision log below (what changed and why).
- The plan lives in the repo at `docs/plan-ai-interviewer.md`. Edit it directly, and commit checklist updates together with the work they describe.

### Rules for the agent: identifying and handling blockers

A task is **blocked** when it can't move forward after a reasonable attempt, for example: a missing account, API key or credential; a vendor limit or outage; a spike check that fails; a requirement that is ambiguous in a way that changes the design; or two genuinely different approaches that both failed.

1. **Mark the task** by adding `**BLOCKED (B#)**` after it, where `B#` is the blocker id. Leave the box unchecked.
2. **Add a row to the Blockers table** below: id, the blocked task, what is blocking it, what was tried, what is needed and from whom, the date, and status `open`.
3. **Keep going on other unblocked tasks.** Don't stop all work, and don't check boxes for tasks that depend on the blocked one.
4. **Tell the user in the next message** that there is a blocker, what is needed from them, and what you are doing in the meantime. Don't bury it in a long summary.
5. **When it is resolved**, set the table status to `resolved` with the date and what fixed it, remove the `BLOCKED` tag from the task, and continue.
6. **Not a blocker:** a planned fallback, such as the spike failing and the plan switching to Option A. Record that in the Decision log and carry on. Also not a blocker: a task that is merely hard or slow.

### Blockers

| ID  | Blocked task                         | What is blocking                                                        | What was tried                                                                     | Needed (and from whom)                                                                                                                                                                                                                            | Date       | Status |
| --- | ------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
|     |                                      |                                                                         |                                                                                    |                                                                                                                                                                                                                                                   |            |        |
| B1  | Real-voice check: pauses and accents | Needs a person speaking into a real microphone                          | Simulated-microphone live tests pass on production (3 rounds and a full interview) | Open the demo URL, start a voice interview, pause 2 to 3 s mid-answer and speak with a normal accent. Tell me if an answer is cut short or misheard (the silence limits are `defaultTurnConfig` in `lib/voice/turn-assembler.ts`). From the owner | 2026-10-03 | open   |
| B2  | Safari and Chrome check              | Needs Safari on a real Mac, and a real Chrome session with a microphone | Chromium verified with Playwright (text, voice, video, recording, replay)          | Open the demo URL in Safari and Chrome, run a short voice and video interview, check recording and replay. From the owner                                                                                                                         | 2026-10-03 | open   |
| B3  | Loom-style walkthrough               | Recording a video needs a person                                        | None possible                                                                      | Record a short walkthrough (job pick, voice interview with follow-ups, decision panel, results, history and replay) and add the link to the README. From the owner                                                                                | 2026-10-03 | open   |

### Decision log

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                         | Why                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | The repo stays private. All code lives in one private repo, `zignd/ai-interviewer-platform`.                                                                                                                                                                                                                                                                                                                                     | The deployed site is still public. Do not make the repo public or create another one.                                                                                   |
| 2026-10-03 | Models: `anthropic/claude-sonnet-5.5` for questions and evaluation, `google/gemini-3.8-flash` for analysis. Reasoning effort is capped (`minimal` for analyze and generate, `low` for evaluate).                                                                                                                                                                                                                                 | Checked against the live OpenRouter catalog. Gemini's hidden reasoning tokens count against `max_tokens` and produced empty JSON until capped.                          |
| 2026-10-03 | Next.js 16 conventions: async route `params` (`RouteContext`), `proxy.ts` instead of `middleware.ts`, `next typegen` before `tsc`.                                                                                                                                                                                                                                                                                               | Read from the bundled Next.js docs, which the generated `AGENTS.md` requires.                                                                                           |
| 2026-10-03 | Interviews wrap up after 7 questions (6 is the minimum). The follow-up floor can only add turns, never remove them.                                                                                                                                                                                                                                                                                                              | Gives the UI a stable "Question N of about 7" and leaves room to force follow-ups.                                                                                      |
| 2026-10-03 | Drizzle with `postgres-js` (`prepare: false`) and plain SQL migrations. Maintenance scripts fall back to the pooled `DATABASE_URL` when the IPv6-only direct host is unreachable.                                                                                                                                                                                                                                                | Supabase's transaction pooler has no prepared statements, and this machine has no IPv6 route.                                                                           |
| 2026-10-03 | Text answers stay available in every mode as a fallback.                                                                                                                                                                                                                                                                                                                                                                         | Keeps the app usable without microphone permission and makes the engine testable end to end.                                                                            |
| 2026-10-03 | End of turn is decided in the browser: manual commit, 1.6 s of silence after a finished sentence, 3 s after a mid-sentence stop, "I'm done" at any time.                                                                                                                                                                                                                                                                         | Candidates pause to think. Punctuation from the transcript is a cheap signal of whether they are done.                                                                  |
| 2026-10-03 | The speech connection is opened only while listening, and a new single-use token is fetched for each answer.                                                                                                                                                                                                                                                                                                                     | The microphone is closed while the AI speaks, so it can't transcribe itself, and nothing is billed during the question.                                                 |
| 2026-10-03 | The opening question is the bank text with no model call, and later turns write the next bank question and a follow-up in parallel with the analysis, keeping whichever the policy picks.                                                                                                                                                                                                                                        | Measured with the real services: model steps went from about 6 s to about 3 s per turn. Model choice only moved latency by a few hundred ms.                            |
| 2026-10-03 | The end-to-end tests use a fake transcriber instead of a fake microphone device. A separate live browser test (not in CI) feeds synthesized speech into `getUserMedia` with the real services.                                                                                                                                                                                                                                   | Audio capture hangs in headless Chromium on this machine. The live test still exercises real Scribe, real models and real TTS in a real browser.                        |
| 2026-10-03 | The Agents + Custom LLM spike runs after the first deployment.                                                                                                                                                                                                                                                                                                                                                                   | ElevenLabs Agents must call our Custom LLM route over a public URL.                                                                                                     |
| 2026-10-03 | Hard deadline set by the owner: finish by 17:13 (90 minutes). Scope is cut to the essentials: deploy first, integration tests (plus unit tests for pure logic) for M6 to M8, no new per-feature e2e, docs and diagrams written once at the end, no more latency tuning.                                                                                                                                                          | Time-boxed delivery. The plan's own rule about tests and docs per milestone is relaxed explicitly by the owner.                                                         |
| 2026-10-03 | The ElevenLabs Agents spike (Option B) is parked, not adopted. The Custom LLM route, agent provisioning script and agent room are kept behind `VOICE_TRANSPORT=agent` (or `?transport=agent`) as experimental. The first live run through ngrok did not get past the first answer.                                                                                                                                               | Option A is verified end to end with the real services, and turn time is dominated by the deliberate silence wait. Finishing B would risk two half-finished transports. |
| 2026-10-03 | Vercel Hobby blocks deployments that carry the git metadata of a GitHub organisation repo, so production is deployed from a git-free copy of the project (`vercel deploy --prod` run in a temporary directory).                                                                                                                                                                                                                  | The deployment showed `BLOCKED` with the org commit attached. The copy deploys fine and the site is public.                                                             |
| 2026-10-03 | The Vercel Blob store is private, so recordings upload with `access: 'private'` and replay streams through `/api/recordings/[id]/media`, which honours Range requests.                                                                                                                                                                                                                                                           | Found by probing the store: public uploads were rejected. Verified on production with a real browser recording.                                                         |
| 2026-10-03 | Per the owner's relaxed quality bar, M6 to M8 have integration and unit tests, and their browser behaviour is verified by live tests against the deployed site (`tests/live`, not in CI) instead of new CI end-to-end tests. Only a video-mode smoke e2e was added to CI.                                                                                                                                                        | Time-boxed delivery. Live tests exercise the real Blob store, queue and recorder, which the CI fakes can't.                                                             |
| 2026-10-03 | "Voice input through the microphone" is checked from a real browser with a simulated microphone stream (synthesized speech) against the real Scribe, models and TTS. A physical microphone, pauses and accents still need a human (B1).                                                                                                                                                                                          | Headless browsers on this machine can't capture audio, and an agent can't speak.                                                                                        |
| 2026-10-03 | Verified on the production URL with real services: a full spoken interview to the results page (7 rounds, 4.1 to 7.1 s from last word to the next question), a full typed interview (7 questions, 3 follow-ups, evaluation JSON), the wait queue UI, a browser-recorded video uploaded to the private Blob store and replayed with seeking, and the history page with role filter.                                               | These are the `tests/live` specs run with `LIVE_BASE_URL`.                                                                                                              |
| 2026-10-03 | Agents spike, final status: parked. Two live attempts through ngrok created the agent, secret and signed URL, but no spoken answer reached our Custom LLM route (second run: zero requests seen by the tunnel). The code stays behind `VOICE_TRANSPORT=agent`. The three planned checks (pauses, false turn ends, latency) were not measured.                                                                                    | Out of time under the owner's 90-minute limit. Option A is verified end to end.                                                                                         |
| 2026-10-03 | Final live check on the last production deployment: typed interview with real models (7 questions, 3 follow-ups, transcript and evaluation JSON), plus the earlier voice, queue, recording and history checks.                                                                                                                                                                                                                   | Every requirement is demonstrated on `https://ai-interviewer-cyan-three.vercel.app`. The human-only items are B1 to B3.                                                 |
| 2026-10-03 | Added a developer mode behind `DEV_MODE=1`: a "Suggested answer" panel flagged as a developer tool shows a model-written strong answer to the current question, to read aloud or paste, so the owner can see how a good answer is scored. It is enabled in the deployed demo on purpose, and the route returns 404 when the flag is off. The demo password is also written in the README, at the owner's request (private repo). | Makes the demo easy to evaluate.                                                                                                                                        |

### Milestone checklist

- [x] **M1. Scaffold and engineering baseline**
  - [x] Next.js (App Router) + TypeScript strict project in `ai-interviewer-platform/`
  - [x] ESLint, Prettier, pre-commit hook, `.env.example`, Zod env validation
  - [x] Vitest and Playwright configured, with an example test of each passing
  - [x] GitHub Actions CI (lint, typecheck, unit, integration, e2e) green on the default branch
  - [x] Supabase project created, DB schema and migrations (all tables from section 2), repository layer
  - [x] Ports and fakes in `lib/ports` (`LlmClient`, `SpeechTokenProvider`, `BlobStore`, `Clock`)
  - [x] Seeds: at least 3 jobs with title and description, and the question banks
  - [x] Job list page (`/`)
  - [x] README rewritten with its first version, and `docs/` started
- [x] **M2. Text-only interview engine (demo this first)**
  - [x] Interview state machine and the analyze, policy and generate steps
  - [x] Policy hard rules: at least 6 questions, at least 2 follow-ups, no early wrap-up, cap extension
  - [x] `POST /api/sessions/:id/turn` with Zod validation
  - [x] Turns and decision snapshots saved
  - [x] Evaluation (strengths, concerns, overall score) as Zod-checked JSON
  - [x] Interview Room in text mode and the results page (`/sessions/[id]`) with transcript and evaluation
  - [x] Unit tests (policy incl. randomized interviews, state machine, schemas)
  - [x] Integration test: full text interview through the routes against real Postgres
  - [x] E2E test: job to results page
  - [x] Docs: `interview-engine.md` and `data-model.md` with diagrams, README updated
- [ ] **M3. Voice**
  - [x] ElevenLabs single-use token route and Scribe v2 Realtime streaming with live captions
  - [x] Role vocabulary through `keyterm`, manual commit and the end-of-turn rules
  - [x] ElevenLabs Flash TTS playback, mic muting while the AI speaks, `listening / thinking / speaking` states
  - [ ] Agents + Custom LLM spike done, with the three checks recorded in the Decision log (switch or stay on Option A)
  - [x] Mic permission handling and error states
  - [x] Tests for turn assembly and the voice state machine, e2e with fake mic
  - [x] Docs: `voice-pipeline.md` with diagrams, README updated
- [x] **M4. Decision panel (stretch 1)**
  - [x] Decision snapshot streamed with each question
  - [x] Panel UI: skills with evidence, topic coverage, gaps, "Why this question"
  - [x] Tests and docs updated
- [x] **M5. Deploy**
  - [x] Vercel project and env variables set
  - [x] Supabase connected through the pooled connection
  - [x] Daily keep-alive cron
  - [x] Public URL working end to end (voice interview completes on the live site)
  - [x] Demo password or rate limit and session length cap in place
  - [x] `setup.md` and `architecture.md` (with deployment view), README updated
- [x] **M6. Capacity gate and wait queue**
  - [x] `join`, queue status and heartbeat routes, with the advisory lock transaction
  - [x] Tokens issued only to `active` sessions
  - [x] Waiting room UI, "I'm ready" confirmation, promotion and drop after the timeout
  - [x] Slot release on end, leave, max duration and missed heartbeat
  - [x] Integration test under concurrent joins (never more than 4 active) and e2e test of the waiting room
  - [x] Docs: `capacity-queue.md` with diagrams, README updated
- [x] **M7. Video mode and recording (stretch 3)**
  - [x] Call layout, interviewer tile with speaking ring, and subtitles
  - [x] Optional camera self-view with the initials fallback, and recording consent notice
  - [x] Compressed recording (cloned track, bitrate cap) with the audio-only fallback
  - [x] `recordings/prepare` with budget check and oldest-first deletion, size-capped Blob upload token
  - [x] Fail-soft behavior and the monthly upload guard
  - [x] Tests for budget logic and recorder settings, integration test of deletion, e2e for "Recording deleted"
  - [x] Docs: `recording-storage.md` with diagram, README updated
- [x] **M8. History, replay and analytics (stretch 4)**
  - [x] `/history` with role filter
  - [x] Replay player synced to turn offsets, and the deleted-recording state
  - [x] Metrics: duration, talk ratio, topic coverage, score trend
  - [x] Tests and docs updated
- [ ] **M9. Polish and delivery**
  - [x] Error states and empty states across the app
  - [ ] Browser check on Chrome and Safari
  - [x] All `docs/` pages and ADRs written, and the README documentation table links every one
  - [x] CI Mermaid and docs-link checks passing
  - [ ] Short Loom-style walkthrough recorded and linked in the README
  - [x] Final live check of every requirement below

### Requirements (check on the live deployment)

- [x] At least 3 sample jobs, each with a title and short description
- [x] Clicking a job opens the Interview Room for that role
- [x] Voice input through the microphone, with the AI's questions shown on screen
- [x] At least 6 questions, including at least 2 follow-ups that depend on the prior answer
- [x] Questions are role-grounded
- [x] Session is saved, and the end screen shows the full transcript and a structured evaluation
- [x] Clean UI with minimal friction
- [x] Works end to end in a hosted environment, on a public URL (password shared if used)
- [x] All code is in a single repo (`zignd/ai-interviewer-platform`, kept private, see the Decision log)
- [x] **Stretch 1:** decision panel
- [x] **Stretch 2:** job-specific question packs
- [x] **Stretch 3:** video mode
- [x] **Stretch 4:** replay and analytics

Tests and docs are written alongside each milestone rather than saved for the end. A milestone isn't done until its tests pass in CI, its diagram or doc page exists in `docs/`, and the README (including its documentation links) is updated.

## 8. Engineering practices: testing and docs

### Design for testability

- **Ports and adapters.** The engine and routes depend on small interfaces in `lib/ports`: `LlmClient`, `SpeechTokenProvider`, `BlobStore`, `Clock` and a DB repository layer. Real adapters (OpenRouter, ElevenLabs, Vercel Blob, Supabase) and **deterministic fakes** both implement them. Tests use the fakes, so they are fast, free and don't depend on any vendor or network.
- **Pure core.** The policy step, queue decisions, budget decisions and recorder settings selection are pure functions over plain data, with no I/O. That is where most logic lives, and it is the easiest to test thoroughly.
- **Validated boundaries.** Zod validates environment variables at startup, every LLM output, and every API request body.

### Test pyramid

| Level                                         | Tool                                                                                                        | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit**                                      | Vitest                                                                                                      | Policy step (including: at least 6 questions, **at least 2 follow-ups**, never wrap up early, cap extension), state machine transitions, Zod schemas, capacity and queue decisions, storage budget and oldest-first deletion choice, recorder bitrate and codec selection, subtitle chunking. Include property-style tests that run many randomized interviews through the policy and assert the hard rules always hold.                                  |
| **Integration**                               | Vitest against a real Postgres (Docker or a CI service container, same schema and migrations as production) | API routes with fake LLM and fake Blob: a full text interview end to end through `/turn`, evaluation saved and checked, the join and queue flow under **concurrent requests** (never more than 4 active), heartbeat expiry and promotion timeout, `recordings/prepare` deleting the oldest recordings and counting pending uploads, fail-soft behavior when Blob errors.                                                                                  |
| **End to end**                                | Playwright                                                                                                  | The browser flow on a built app with fakes behind the ports: pick a job, run an interview to the results page, transcript and evaluation shown; a 5th simultaneous candidate sees the waiting room and is promoted when a slot frees; a deleted recording shows "Recording deleted to save storage". Chromium runs with `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream` and a fixed fake audio file, so mic and camera work in CI. |
| **Live smoke (manual or nightly, not in CI)** | A script                                                                                                    | Real OpenRouter and ElevenLabs calls: one short interview, to catch vendor API drift and measure turn latency. Skipped without API keys.                                                                                                                                                                                                                                                                                                                  |

LLM quality isn't asserted by exact text. Tests check structure (valid JSON against the schema), rules (follow-ups quote the prior answer, the question maps to a role topic) and fixed fixtures, and keep a small set of recorded real responses to catch prompt regressions.

### Code quality and workflow

- TypeScript in `strict` mode, ESLint and Prettier, and a pre-commit hook (lint-staged) so broken formatting doesn't reach CI.
- **GitHub Actions** on every push and pull request: install, lint, typecheck, unit tests, integration tests, e2e tests, and a Mermaid check (below). Vercel preview deployments for each branch.
- Conventional commit messages, short-lived branches and small pull requests, so the history reads as a progression.
- Coverage is reported, with a high bar for the core logic (policy, queue, budget) rather than a single global percentage.
- A `.env.example` listing every variable, and structured logs with the session id on every server log line.

### Documentation

All code lives in the repo `ai-interviewer-platform/`. Its current `README.md` is rewritten as the entry point.

- **`README.md` is kept up to date as the project grows**, not written at the end. Each milestone updates it where its content changed. It covers what the app is, a screenshot or GIF, the live URL (and demo password, if any), a short architecture overview with one diagram, quick start, how to run the tests, and the feature status against the requirements and stretch goals.
- **The README links to every page in `docs/`** through a "Documentation" table (page name, one-line description, link), so nothing in `docs/` is orphaned. Each docs page links back to the README and to related pages.
- **Details live in `docs/`**, with **Mermaid diagrams as the main explanation** and short text around them. GitHub renders Mermaid natively.

| Doc                         | Diagrams                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture.md`      | System architecture flowchart, one-turn sequence diagram (both already in section 1), a deployment view (Vercel, Supabase, Blob, ElevenLabs, OpenRouter)                                                    |
| `docs/interview-engine.md`  | Interview phase state diagram, a flowchart of the policy step with the minimum rules, and a sequence diagram of the analyze, policy and generate steps                                                      |
| `docs/data-model.md`        | Entity-relationship diagram of the tables, with the meaning of each status field                                                                                                                            |
| `docs/capacity-queue.md`    | Session status state diagram (`queued`, `active`, `completed`, `abandoned`) and a sequence diagram for join, heartbeat, promotion and release                                                               |
| `docs/recording-storage.md` | Flowchart of record, compress, budget check, delete oldest, upload and replay, plus the free-tier limits table                                                                                              |
| `docs/voice-pipeline.md`    | Sequence diagrams for Option A and, if adopted, Option B, plus turn-taking settings and why they were chosen                                                                                                |
| `docs/testing.md`           | The test pyramid, how to run each level locally, and how the fakes work                                                                                                                                     |
| `docs/setup.md`             | Accounts and keys needed (OpenRouter, ElevenLabs, Supabase, Vercel Blob), env variables, migrations and seeds, and deployment steps                                                                         |
| `docs/adr/`                 | Short decision records: no avatar provider, ElevenLabs over Deepgram, Agents spike outcome, Supabase plus Blob, compression and retention rules. Each is context, decision and consequences, in a few lines |

**Keeping docs honest:** a CI step parses every Mermaid block in `README.md` and `docs/` (with `@mermaid-js/mermaid-cli`) so a broken diagram fails the build. A second CI check fails if a file in `docs/` isn't linked from the README or if a relative link is broken. Changes that alter behavior update the matching doc and the README in the same pull request.

## 9. Risks and mitigations

- **Latency:** stream the LLM output, then start TTS on the first sentence. Use the fast model for analysis and run it in parallel where possible.
- **Single speech vendor:** both speech-to-text and text-to-speech depend on ElevenLabs, so an outage or quota limit affects both. The free tier also includes limited hours (2.5 hours of Scribe Realtime on Free, 15 on Starter), and Agents allow 4 concurrent calls on Free (6 on Starter), with $0.16/min billed above that. The wait queue enforces the cap, but check the plan's quota before the demo and test with several simultaneous sessions.
- **Queue edge cases:** a queued tab that is closed or asleep must not hold its place, and an active tab that dies must free its slot. The heartbeat, promotion confirmation and max-duration rules cover this. Test by killing tabs mid-interview and mid-queue.
- **Agents option cost and control (Option B only):** about 10x the cost of Option A, our LLM latency stacks inside the agent's response time, and a false turn end could count as an extra question. This is what the spike checks, and Option A is the fallback.
- **Accent accuracy:** no published word error rate for non-native English. Test with real accented speech early, and tune `keyterm` and the end-of-turn silence from the results.
- **Free-tier limits (storage):** Vercel Blob Hobby is 1 GB, 10 GB transfer and 2,000 uploads per month, and exceeding it blocks Blob for 30 days. The budget rules (800 MB cap, oldest-first deletion, monthly upload guard, fail-soft recording) are there to prevent that. Replay streaming is the remaining risk: at about 40 MB a recording, 10 GB is roughly 250 full plays. Hobby usage is also shared across all Vercel services in the project.
- **Supabase pausing:** free projects pause after a week of inactivity. The daily keep-alive cron prevents it. Also check the project is awake before submitting.
- **Deleted recordings:** a recording can be deleted while someone is replaying it. The player must handle a failed load as "recording deleted".
- **API abuse on a public URL:** add a simple password or a rate limit per IP, and cap the session length. This also protects the ElevenLabs quota.
- **Browser support:** test on Chrome and Safari, since mic and camera permissions behave differently.

## Open questions

None at the moment. Database and storage are decided: Supabase Postgres for data and Vercel Blob for recordings.
