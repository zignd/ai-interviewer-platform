# 0005. Turn-taking in the browser (Option A), Agents parked (Option B)

[Index](README.md)

**Context.** Candidates pause to think, so a short silence timeout cuts them off. Two options: run turn-taking ourselves with Scribe and Flash (A), or let ElevenLabs Agents handle it with our engine as a Custom LLM (B, about 10x the cost per interview).

**Decision.** Option A. The browser decides the end of an answer: 1.6 s of silence after a finished sentence, 3 s after a mid-sentence stop, or the "I'm done" button. The microphone is closed while the AI speaks. The model steps run in parallel and the opening question needs no model call.

**Consequences.** Measured with the real services in a real browser: about 5 to 6 s from the last word to the next question being spoken, of which 1.6 to 3 s is the deliberate silence wait and about 3 s is the models. Option B was built (Custom LLM route, `npm run agent:sync`, agent room behind `VOICE_TRANSPORT=agent`) and tried once through ngrok, but the first live run did not get past the first answer, so it is parked as experimental rather than finished. Real-voice pause and accent checks remain a human step.
