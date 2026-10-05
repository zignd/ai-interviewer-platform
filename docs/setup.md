# Setup

[Back to the README](../README.md) · Related: [testing](testing.md), [architecture](architecture.md), [capacity queue](capacity-queue.md)

## Accounts and keys

| Service                             | Used for                                                       | Variables                                                                                     |
| ----------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [OpenRouter](https://openrouter.ai) | Interviewer, analysis and evaluation models                    | `OPENROUTER_API_KEY`                                                                          |
| [ElevenLabs](https://elevenlabs.io) | Speech-to-text (Scribe v2 Realtime) and text-to-speech (Flash) | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, optional `ELEVENLABS_AGENT_ID`                   |
| [Supabase](https://supabase.com)    | Postgres (Supabase Storage is not used)                        | `DATABASE_URL` (pooled, port 6543), `DIRECT_URL` (migrations)                                 |
| [Vercel](https://vercel.com)        | Hosting and Vercel Blob for recordings                         | `BLOB_READ_WRITE_TOKEN`, and for deploys `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |

Copy `.env.example` to `.env` and fill it in. `.env` is git-ignored. If the database password contains special characters, percent-encode them inside the connection string.

## Environment variables

| Variable                    | Default   | Purpose                                                                                                                                                                                                                                            |
| --------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_CONCURRENT_INTERVIEWS` | 4         | Interviews allowed at once (matches the ElevenLabs free plan).                                                                                                                                                                                     |
| `MAX_SESSION_MINUTES`       | 25        | Interview length cap.                                                                                                                                                                                                                              |
| `STORAGE_BUDGET_BYTES`      | 800000000 | Recording storage budget inside Vercel Blob's free 1 GB.                                                                                                                                                                                           |
| `MAX_VIDEO_BYTES`           | 40000000  | Largest video upload before falling back to audio only.                                                                                                                                                                                            |
| `MAX_MONTHLY_UPLOADS`       | 1500      | Stop recording after this many uploads in a month.                                                                                                                                                                                                 |
| `DEMO_PASSWORD`             | empty     | Password reviewers enter. Empty disables the gate.                                                                                                                                                                                                 |
| `CRON_SECRET`               | none      | Protects the daily keep-alive route.                                                                                                                                                                                                               |
| `DEV_MODE`                  | off       | Shows a "Suggested answer" panel, flagged as a developer tool, in the interview room: a model-written strong answer to the current question to read aloud or paste, to see how the interviewer scores it. Enabled in the deployed demo on purpose. |
| `USE_FAKES`                 | off       | Swaps every vendor for a deterministic fake. Tests only.                                                                                                                                                                                           |
| `VOICE_TRANSPORT`           | scribe    | `scribe` (our turn-taking, default) or `agent` (experimental ElevenLabs Agents). `?transport=agent` overrides per page.                                                                                                                            |
| `AGENT_LLM_SECRET`          | none      | Bearer token the ElevenLabs agent sends to our Custom LLM route. Experimental agent only.                                                                                                                                                          |
| `ELEVENLABS_AGENT_ID`       | none      | Written by `npm run agent:sync`. Experimental agent only.                                                                                                                                                                                          |

The environment is validated with Zod in `lib/env.ts`, and the app fails fast with a readable message if something is missing.

## Run locally

```bash
npm install
cp .env.example .env              # then fill in the keys
npm run db:migrate                # applies ./drizzle migrations (falls back to DATABASE_URL)
npm run db:seed                   # three roles and their question banks
npm run dev                       # http://localhost:3000
```

Running with no vendor keys: set `USE_FAKES=1` and a local `DATABASE_URL` (for example `postgres://postgres:postgres@localhost:5432/interviewer_test` from `docker compose up -d db`).

## Checking the vendors

```bash
npm run smoke        # real OpenRouter calls through the engine steps
npm run smoke:voice  # real ElevenLabs: synthesize speech, then transcribe it with Scribe
npm run test:live    # real browser, real models and speech, simulated microphone
```

The ElevenLabs key only needs Text to Speech and Speech to Text access. Reading the voice library or model list is not required.

## Deploying to Vercel

One command does everything:

```bash
npm run deploy                 # migrate, sync env vars, deploy, smoke-check
npm run deploy -- --check      # run lint, typecheck and unit tests first
npm run deploy -- --skip-env   # faster when no env var changed
```

It needs `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` in `.env`. The steps it performs (`scripts/deploy.ts`):

1. Applies database migrations (through the pooled `DATABASE_URL` if the direct host is unreachable).
2. Pushes the variables from `.env` to Vercel's production environment.
3. Makes sure the Vercel project uses the Next.js preset.
4. Copies the project to a temporary folder **without `.git`**, because Vercel Hobby blocks deployments that carry the `AQ-Assessment` org repo's git metadata.
5. Runs `vercel deploy --prod`, then checks that the site answers and the database keep-alive route works.

The daily keep-alive cron (`vercel.json`) uses `CRON_SECRET`, which Vercel sends automatically.

## Experimental: ElevenLabs Agents

`npm run agent:sync -- https://<public url>` creates or updates an agent whose Custom LLM is `<url>/api/agent-llm` and stores `AGENT_LLM_SECRET` as a workspace secret. For local experiments expose the app with `ngrok http 3200` and run `npm run test:live` style tests. This transport is parked, see [decision 0005](adr/0005-turn-taking-in-the-browser.md).

## Database notes

- Migrations are plain SQL in `drizzle/`, generated with `npm run db:generate` after editing `lib/db/schema.ts`.
- The Supabase direct host (`db.<ref>.supabase.co`) is IPv6-only on the free plan, so from an IPv4-only network migrate through the pooled `DATABASE_URL`. The migration script does this automatically if the direct host is unreachable.
- Free Supabase projects pause after a week of inactivity. A daily Vercel Cron job keeps the project awake (added with the deployment milestone).
