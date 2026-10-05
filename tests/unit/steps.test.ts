import { describe, expect, it } from 'vitest';
import { FakeLlm } from '@/lib/adapters/fake-llm';
import { anchorAppearsIn, followUpDependsOnAnswer } from '@/lib/engine/anchor';
import {
  analyzeAnswer,
  generateQuestion,
  heuristicAnalysis,
  heuristicEvaluation,
} from '@/lib/engine/steps';
import { evaluationSchema } from '@/lib/engine/types';
import type { LlmClient } from '@/lib/ports';
import { seedJobs } from '@/lib/seed/data';
import { stableId } from '@/lib/seed';
import { makeBank } from '../helpers/bank';

const job = {
  title: 'Frontend Engineer',
  description: 'd',
  seniority: 'Mid',
  competencies: ['React', 'Testing'],
  keyterms: ['React'],
};
const answer =
  'I used React to rebuild the checkout because the old page was slow. However, the cache was the real fix and we measured it.';
const broken: LlmClient = {
  complete: async () => {
    throw new Error('model down');
  },
};
const garbage: LlmClient = {
  complete: async () =>
    ({
      question: 'Tell me about Kubernetes clusters',
      rationale: 'r',
      anchor: 'Kubernetes clusters at scale',
    }) as never,
};

describe('analyze step', () => {
  it('uses the model result when available', async () => {
    const a = await analyzeAnswer(new FakeLlm(), { job, question: 'q', answer, topics: [] });
    expect(a.skills.map((s) => s.skill)).toContain('React');
    expect(a.hook).not.toBeNull();
  });
  it('falls back to a heuristic when the model fails', async () => {
    const a = await analyzeAnswer(broken, {
      job,
      question: 'q',
      answer: 'short answer',
      topics: [],
    });
    expect(a).toEqual(heuristicAnalysis('short answer'));
    expect(a.depth).toBe('shallow');
  });
});

describe('generate step', () => {
  const decision = { action: 'FOLLOW_UP' as const, targetTopic: 'topic_0' };
  const base = {
    job,
    decision,
    bankQuestion: null,
    previousQuestion: 'q',
    answer,
    hook: null,
    hints: [],
    transcriptTail: [],
  };

  it('follow-ups from the model quote the answer', async () => {
    const g = await generateQuestion(new FakeLlm(), base);
    expect(g.usedFallback).toBe(false);
    expect(followUpDependsOnAnswer(g.question, g.anchor, answer)).toBe(true);
  });

  it('replaces a follow-up that does not depend on the answer with one that does', async () => {
    const g = await generateQuestion(garbage, base);
    expect(g.usedFallback).toBe(true);
    expect(anchorAppearsIn(answer, g.anchor)).toBe(true);
    expect(followUpDependsOnAnswer(g.question, g.anchor, answer)).toBe(true);
  });

  it('falls back to the bank text for a bank question when the model fails', async () => {
    const bank = makeBank()[0];
    const g = await generateQuestion(broken, {
      ...base,
      decision: { action: 'BANK', targetTopic: bank.topic },
      bankQuestion: bank,
      answer: null,
    });
    expect(g.question).toBe(bank.text);
    expect(g.usedFallback).toBe(true);
  });

  it('never carries an anchor for bank questions', async () => {
    const bank = makeBank()[0];
    const g = await generateQuestion(new FakeLlm(), {
      ...base,
      decision: { action: 'BANK', targetTopic: bank.topic },
      bankQuestion: bank,
      answer: null,
    });
    expect(g.anchor).toBeNull();
  });
});

describe('evaluation helpers', () => {
  it('heuristic evaluation always satisfies the schema', () => {
    for (const quality of [[], [0], [5, 6, 7], [10, 10]]) {
      const e = heuristicEvaluation({ job, skills: [], qualityHistory: quality, gaps: ['g'] });
      expect(evaluationSchema.safeParse(e).success).toBe(true);
    }
  });
  it('fake evaluator output satisfies the schema and maps scores to recommendations', async () => {
    const llm = new FakeLlm();
    const high = await llm.complete({
      task: 'evaluate',
      input: { job, skills: [], qualityHistory: [9, 9], gaps: [] },
      prompt: { system: '', user: '' },
      model: 'x',
      temperature: 0,
      schema: evaluationSchema,
    });
    expect(high.recommendation).toBe('strong_hire');
    const low = await llm.complete({
      task: 'evaluate',
      input: { job, skills: [], qualityHistory: [2], gaps: [] },
      prompt: { system: '', user: '' },
      model: 'x',
      temperature: 0,
      schema: evaluationSchema,
    });
    expect(low.recommendation).toBe('no_hire');
  });
});

describe('seed data', () => {
  it('has at least 3 roles, 8 topics each, with a behavioral and a technical question per topic', () => {
    expect(seedJobs.length).toBeGreaterThanOrEqual(3);
    for (const j of seedJobs) {
      expect(j.title.length).toBeGreaterThan(0);
      expect(j.description.length).toBeGreaterThan(20);
      expect(j.topics).toHaveLength(8);
      expect(new Set(j.topics.map((t) => t.topic)).size).toBe(8);
      for (const t of j.topics) {
        expect(t.behavioral.text.length).toBeGreaterThan(20);
        expect(t.technical.text.length).toBeGreaterThan(20);
        expect(t.behavioral.followUpHints.length).toBeGreaterThan(0);
      }
    }
  });
  it('stable ids are deterministic, unique and UUID-shaped', () => {
    const a = stableId('question', 'x', 'y');
    expect(a).toBe(stableId('question', 'x', 'y'));
    expect(a).not.toBe(stableId('question', 'x', 'z'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
