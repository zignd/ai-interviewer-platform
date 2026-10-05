import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { followUpDependsOnAnswer } from '@/lib/engine/anchor';
import {
  createSession,
  evaluateSession,
  getSessionView,
  startInterview,
  submitTurn,
  ServiceError,
} from '@/lib/engine/service';
import { evaluationSchema, type DecisionSnapshot } from '@/lib/engine/types';
import { LONG_ANSWER, SHORT_ANSWER, createTestContainer } from './helpers';

const t = createTestContainer();
afterAll(() => t.close());
beforeEach(() => t.reset());

async function jobBySlug(slug: string) {
  const job = await t.repos.jobs.bySlug(slug);
  if (!job) throw new Error(`missing seed job ${slug}`);
  return job;
}

async function runInterview(slug: string, answerFor: (n: number) => string) {
  const job = await jobBySlug(slug);
  const session = await createSession(t.container, { jobId: job.id, mode: 'text' });
  let result = await startInterview(t.container, session.id);
  let n = 0;
  while (!result.done) {
    result = await submitTurn(t.container, session.id, { transcript: answerFor(n++) });
    if (n > 20) throw new Error('interview did not finish');
  }
  return { job, session, view: await getSessionView(t.container, session.id) };
}

describe('full text interview against real Postgres', () => {
  it.each(['frontend-engineer', 'data-analyst', 'customer-success-manager'])(
    '%s: asks at least 6 questions including at least 2 dependent follow-ups, then saves a valid evaluation',
    async (slug) => {
      const { view, session, job } = await runInterview(slug, () => LONG_ANSWER);

      const interviewer = view.turns.filter((x) => x.role === 'interviewer');
      const questions = interviewer.filter((x) => x.kind !== 'generated');
      expect(questions.length).toBeGreaterThanOrEqual(6);
      const followUps = questions.filter((x) => x.kind === 'follow_up');
      expect(followUps.length).toBeGreaterThanOrEqual(2);

      // Every follow-up quotes the answer that came right before it.
      for (const fu of followUps) {
        const prevAnswer = view.turns.find((x) => x.idx === fu.idx - 1)!;
        const decision = view.decisions.find((d) => d.turnIdx === fu.idx) as DecisionSnapshot;
        expect(prevAnswer.role).toBe('candidate');
        expect(followUpDependsOnAnswer(fu.text, decision.anchor, prevAnswer.text)).toBe(true);
      }

      // Role-grounded: every bank question comes from this job's bank.
      const bank = await t.repos.bank.forJob(job.id);
      for (const q of questions.filter((x) => x.kind === 'bank')) {
        expect(bank.some((b) => q.text.includes(b.text))).toBe(true);
      }

      // Strict alternation of turns and a decision snapshot per interviewer turn.
      view.turns.forEach((turn, i) => {
        expect(turn.idx).toBe(i);
        expect(turn.role).toBe(i % 2 === 0 ? 'interviewer' : 'candidate');
      });
      expect(view.decisions).toHaveLength(interviewer.length);
      expect(view.session.status).toBe('completed');

      const evaluation = await evaluateSession(t.container, session.id);
      expect(evaluationSchema.safeParse(evaluation).success).toBe(true);
      const again = await evaluateSession(t.container, session.id);
      expect(again).toEqual(evaluation);
    },
  );

  it('still reaches two follow-ups when the candidate answers shallowly, and never exceeds 10 questions', async () => {
    const { view } = await runInterview('frontend-engineer', () => SHORT_ANSWER);
    const questions = view.turns.filter((x) => x.role === 'interviewer' && x.kind !== 'generated');
    expect(questions.length).toBeGreaterThanOrEqual(6);
    expect(questions.length).toBeLessThanOrEqual(10);
    expect(questions.filter((x) => x.kind === 'follow_up').length).toBeGreaterThanOrEqual(2);
  });

  it('never asks the same bank question twice', async () => {
    const { view } = await runInterview('data-analyst', (n) =>
      n % 2 ? SHORT_ANSWER : LONG_ANSWER,
    );
    const texts = view.turns.filter((x) => x.kind === 'bank').map((x) => x.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('start is idempotent', async () => {
    const job = await jobBySlug('frontend-engineer');
    const session = await createSession(t.container, { jobId: job.id, mode: 'text' });
    const a = await startInterview(t.container, session.id);
    const b = await startInterview(t.container, session.id);
    expect(b.question.text).toBe(a.question.text);
    expect(await t.repos.turns.list(session.id)).toHaveLength(1);
  });

  it('rejects an empty answer and an answer when no question is open', async () => {
    const job = await jobBySlug('frontend-engineer');
    const session = await createSession(t.container, { jobId: job.id, mode: 'text' });
    await expect(submitTurn(t.container, session.id, { transcript: '   ' })).rejects.toMatchObject({
      code: 'empty_answer',
    });
    await expect(
      submitTurn(t.container, session.id, { transcript: 'hello' }),
    ).rejects.toMatchObject({ code: 'not_awaiting_answer' });
  });

  it('refuses to evaluate an unfinished interview', async () => {
    const job = await jobBySlug('frontend-engineer');
    const session = await createSession(t.container, { jobId: job.id, mode: 'text' });
    await startInterview(t.container, session.id);
    await expect(evaluateSession(t.container, session.id)).rejects.toMatchObject({
      code: 'not_finished',
    });
  });

  it('handles two simultaneous submissions of the same answer: exactly one wins', async () => {
    const job = await jobBySlug('frontend-engineer');
    const session = await createSession(t.container, { jobId: job.id, mode: 'text' });
    await startInterview(t.container, session.id);
    const results = await Promise.allSettled([
      submitTurn(t.container, session.id, { transcript: LONG_ANSWER }),
      submitTurn(t.container, session.id, { transcript: LONG_ANSWER }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(ServiceError);
    const turns = await t.repos.turns.list(session.id);
    expect(turns.map((x) => x.idx)).toEqual([0, 1, 2]);
  });

  it('falls back to a heuristic evaluation if the evaluator model fails', async () => {
    const failing = createTestContainer({
      llm: {
        complete: async (req) => {
          if (req.task === 'evaluate') throw new Error('model down');
          return new (await import('@/lib/adapters/fake-llm')).FakeLlm().complete(req);
        },
      },
    });
    try {
      await failing.reset();
      const job = await failing.repos.jobs.bySlug('data-analyst');
      const session = await createSession(failing.container, { jobId: job!.id, mode: 'text' });
      let r = await startInterview(failing.container, session.id);
      while (!r.done)
        r = await submitTurn(failing.container, session.id, { transcript: LONG_ANSWER });
      const evaluation = await evaluateSession(failing.container, session.id);
      expect(evaluation.summary).toContain('Automatic scoring');
      expect(evaluationSchema.safeParse(evaluation).success).toBe(true);
    } finally {
      await failing.close();
      createTestContainer();
    }
  });
});

describe('turn latency: model steps run in parallel', () => {
  it('starts analysis and both candidate questions at the same time and keeps only the matching one', async () => {
    const { FakeLlm } = await import('@/lib/adapters/fake-llm');
    const fake = new FakeLlm();
    const calls: { task: string; action?: string; start: number }[] = [];
    const slow = createTestContainer({
      llm: {
        complete: async (req) => {
          const input = req.input as { decision?: { action: string } };
          calls.push({ task: req.task, action: input.decision?.action, start: Date.now() });
          await new Promise((r) => setTimeout(r, 80));
          return fake.complete(req);
        },
      },
    });
    try {
      await slow.reset();
      const job = await slow.repos.jobs.bySlug('frontend-engineer');
      const session = await createSession(slow.container, { jobId: job!.id, mode: 'text' });
      await startInterview(slow.container, session.id);
      expect(calls).toHaveLength(0); // the opening question needs no model call

      const t0 = Date.now();
      // A shallow answer makes the policy choose a follow-up, so the speculative bank question is dropped.
      const r = await submitTurn(slow.container, session.id, { transcript: SHORT_ANSWER });
      const elapsed = Date.now() - t0;

      expect(calls.map((c) => c.task).sort()).toEqual(['analyze', 'generate', 'generate']);
      const starts = calls.map((c) => c.start);
      expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(40);
      expect(elapsed).toBeLessThan(80 * 2 + 60); // sequential would take at least 160 ms plus overhead per extra call
      expect(r.question.kind).toBe('follow_up');
      expect(calls.filter((c) => c.action === 'FOLLOW_UP')).toHaveLength(1);
    } finally {
      await slow.close();
      createTestContainer();
    }
  });

  it('uses the speculative bank question when the policy picks the bank', async () => {
    const calls: string[] = [];
    const { FakeLlm } = await import('@/lib/adapters/fake-llm');
    const fake = new FakeLlm();
    const local = createTestContainer({
      llm: {
        complete: async (req) => {
          const input = req.input as { decision?: { action: string } };
          calls.push(`${req.task}:${input.decision?.action ?? ''}`);
          return fake.complete(req);
        },
      },
    });
    try {
      await local.reset();
      const job = await local.repos.jobs.bySlug('data-analyst');
      const session = await createSession(local.container, { jobId: job!.id, mode: 'text' });
      await startInterview(local.container, session.id);
      const r = await submitTurn(local.container, session.id, {
        transcript: LONG_ANSWER.replace(/because|however/gi, 'and'),
      });
      expect(r.question.kind).toBe('bank');
      expect(calls.filter((c) => c.startsWith('generate'))).toHaveLength(2);
    } finally {
      await local.close();
      createTestContainer();
    }
  });
});
