# Architecture decision records

[Back to the README](../../README.md) · Related: [architecture](../architecture.md), [plan and decision log](../plan-ai-interviewer.md)

Short records of the decisions that shaped the project. Each has a context, the decision and its consequences.

| Record                                              | Decision                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| [0001](0001-no-avatar-provider.md)                  | No avatar provider: video mode is a layout, not a rendered human |
| [0002](0002-elevenlabs-for-speech.md)               | ElevenLabs for both speech directions                            |
| [0003](0003-supabase-postgres-and-vercel-blob.md)   | Supabase Postgres for data, Vercel Blob for recordings           |
| [0004](0004-code-decides-model-writes.md)           | Plain code decides, the model writes                             |
| [0005](0005-turn-taking-in-the-browser.md)          | Turn-taking in the browser (Option A), Agents (Option B) parked  |
| [0006](0006-capacity-gate.md)                       | Capacity gate with a wait queue                                  |
| [0007](0007-recording-compression-and-retention.md) | Compress recordings in the browser and rotate the oldest         |
