# 0006. Capacity gate with a wait queue

[Index](README.md)

**Context.** ElevenLabs bills extra above the plan's concurrent-call limit (4 on the free plan), and the demo URL is public.

**Decision.** At most 4 voice or video interviews run at once. Others wait in a FIFO queue with heartbeat expiry, a 30 s "I'm ready" confirmation after promotion, and a 25 minute maximum. A Postgres advisory lock serialises the decisions. Tokens are issued only to confirmed slots. Text interviews bypass the gate.

**Consequences.** No surprise charges and no stale slots after closed tabs, with no cron job needed. A fifth candidate waits (about 10 minutes per wave) instead of failing. See [capacity queue](../capacity-queue.md).
