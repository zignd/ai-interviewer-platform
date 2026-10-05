# 0001. No avatar provider

[Index](README.md)

**Context.** The brief says video mode is "still voice-driven; video is just the interface/UX layer". Avatar vendors (HeyGen, Tavus, Simli) add cost, quotas, latency and a second source of truth for what the interviewer says.

**Decision.** Video mode reuses the voice pipeline and only changes the layout: an interviewer tile (initials and a speaking ring), the candidate's optional self-view, and subtitles.

**Consequences.** No extra vendor or bill, and the interviewer state stays deterministic. The interviewer is not a lifelike human. An avatar can be added later behind the same text-in, audio-out boundary.
