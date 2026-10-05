# 0002. ElevenLabs for speech in and out

[Index](README.md)

**Context.** The interview needs live captions and low-latency speech. OpenRouter's transcription is batch-only. Deepgram would add a second account.

**Decision.** Scribe v2 Realtime for speech-to-text (streaming, `keyterms`, manual commit) and Flash (`eleven_flash_v2_5`) for text-to-speech, with one account and one key. Browsers get single-use tokens, never the key.

**Consequences.** Verified with the real services: a spoken sentence round-trips at 100% word match, the first partial arrives in about 1.5 s and commit returns in about 0.25 s. Both directions depend on one vendor, so an outage or quota limit hits both, and typing is always available as a fallback. See [voice pipeline](../voice-pipeline.md).
