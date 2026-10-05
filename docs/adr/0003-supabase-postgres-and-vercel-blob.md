# 0003. Supabase Postgres for data, Vercel Blob for recordings

[Index](README.md)

**Context.** Both stay on free tiers. Supabase Storage caps files at 50 MB on the free plan, which a video can exceed. Vercel Blob has no such cap.

**Decision.** Supabase Postgres (pooled connection, prepared statements off, Drizzle with plain SQL migrations) for all data, and Vercel Blob for recordings only. A daily Vercel Cron job runs `select 1` so the free project never pauses.

**Consequences.** One extra service, but no file-size problem. The direct Supabase host is IPv6-only, so maintenance scripts fall back to the pooled URL. Transcripts and evaluations are tiny and kept forever; recordings are rotated ([0007](0007-recording-compression-and-retention.md)).
