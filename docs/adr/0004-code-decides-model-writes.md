# 0004. Plain code decides, the model writes

[Index](README.md)

**Context.** The brief needs at least 6 questions and at least 2 follow-ups that depend on the previous answer. A model alone cannot guarantee that.

**Decision.** The policy step is a pure function (`lib/engine/policy.ts`): a follow-up floor that forces follow-ups, a wrap-up target of 7 questions, follow-ups by judgment on shallow answers or hooks, otherwise the next bank question. Models only analyze answers, write the words and score the result. Follow-ups must quote the answer, verified in code, with a deterministic fallback.

**Consequences.** The rules are provable (2000 randomized interviews in tests) and every question has a recorded reason for the decision panel. Prompts matter less for compliance. See [interview engine](../interview-engine.md).
