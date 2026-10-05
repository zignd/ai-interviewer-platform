# 0007. Compress recordings in the browser and rotate the oldest

[Index](README.md)

**Context.** Vercel Blob Hobby includes 1 GB, 10 GB of transfer and 2,000 uploads a month, and exceeding it blocks Blob for 30 days.

**Decision.** Record at about 640x360, 15 fps, 250 kbps video and 32 kbps audio, with a parallel audio-only recording as fallback. Before each upload the server checks the budget (800 MB), deletes the oldest recordings, reserves a pending row and issues a size-capped token. Uploads stop after 1,500 a month, and any Blob error means "recording unavailable", never a failed interview.

**Consequences.** Replay shows "Recording deleted to save storage" for old sessions, while transcripts, evaluations and metrics stay. See [recording storage](../recording-storage.md).
