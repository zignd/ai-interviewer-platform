import { describe, expect, it } from 'vitest';
import { decideNext, pickBankQuestion } from '@/lib/engine/policy';
import { recordAnswer, recordQuestion } from '@/lib/engine/state';
import {
  defaultPolicyConfig,
  initialState,
  type Analysis,
  type InterviewState,
  type PolicyConfig,
} from '@/lib/engine/types';
import { makeBank, mulberry32 } from '../helpers/bank';

const strong: Analysis = { depth: 'strong', quality: 9, skills: [], missing: [], hook: null };
const shallow: Analysis = {
  depth: 'shallow',
  quality: 3,
  skills: [],
  missing: ['example'],
  hook: null,
};
const hooked: Analysis = {
  depth: 'adequate',
  quality: 6,
  skills: [],
  missing: [],
  hook: 'we rewrote the cache layer',
};

const bank = makeBank();

function stateAfter(questions: number, followUps: number, overrides: Partial<InterviewState> = {}) {
  return {
    ...initialState(),
    phase: 'in_progress' as const,
    questionsAsked: questions,
    followUpsAsked: followUps,
    topicsCovered: ['topic_0'],
    askedQuestionIds: ['q-0-behavioral'],
    lastTopic: 'topic_0',
    lastCategory: 'behavioral' as const,
    ...overrides,
  };
}

describe('pickBankQuestion', () => {
  it('picks the lowest-priority uncovered topic', () => {
    const q = pickBankQuestion(stateAfter(1, 0), bank);
    expect(q?.topic).toBe('topic_1');
  });

  it('alternates category when the same topic offers both', () => {
    const q = pickBankQuestion(
      stateAfter(1, 0, { topicsCovered: [], lastCategory: 'behavioral', askedQuestionIds: [] }),
      bank,
    );
    expect(q?.topic).toBe('topic_0');
    expect(q?.category).toBe('technical');
  });

  it('never returns an already asked question and returns null when exhausted', () => {
    const all = bank.map((b) => b.id);
    expect(pickBankQuestion(stateAfter(9, 2, { askedQuestionIds: all }), bank)).toBeNull();
  });

  it('revisits a covered topic only when everything is covered', () => {
    const covered = [...new Set(bank.map((b) => b.topic))];
    const q = pickBankQuestion(stateAfter(7, 2, { topicsCovered: covered }), bank);
    expect(q).not.toBeNull();
  });
});

describe('decideNext: follow-up floor', () => {
  it('forces two follow-ups by Q4 when none were asked, even for strong answers', () => {
    const d = decideNext({ state: stateAfter(4, 0), analysis: strong, bank });
    expect(d.action).toBe('FOLLOW_UP');
    expect(d.forced).toBe(true);
    expect(d.rules).toContain('follow_up_floor');
  });

  it('forces the last owed follow-up when one was already asked', () => {
    const d = decideNext({ state: stateAfter(5, 1), analysis: strong, bank });
    expect(d.action).toBe('FOLLOW_UP');
    expect(d.forced).toBe(true);
  });

  it('does not force anything early when there is time to spare', () => {
    const d = decideNext({ state: stateAfter(2, 0), analysis: strong, bank });
    expect(d.forced).toBe(false);
    expect(d.action).toBe('BANK');
  });

  it('is not satisfied by a single follow-up (1 is never enough)', () => {
    const d = decideNext({ state: stateAfter(7, 1), analysis: strong, bank });
    expect(d.action).toBe('FOLLOW_UP');
    expect(d.forced).toBe(true);
  });

  it('never wraps up while the floor is unmet, even past the question cap', () => {
    for (const q of [7, 8, 9, 10, 12]) {
      const d = decideNext({ state: stateAfter(q, 0), analysis: strong, bank });
      expect(d.action).toBe('FOLLOW_UP');
    }
  });

  it('wraps up at the target once the floor is met', () => {
    const d = decideNext({ state: stateAfter(7, 2), analysis: strong, bank });
    expect(d.action).toBe('WRAP_UP');
  });

  it('lets the floor override the consecutive follow-up limit', () => {
    const d = decideNext({
      state: stateAfter(5, 0, { consecutiveFollowUps: 2 }),
      analysis: strong,
      bank,
    });
    expect(d.action).toBe('FOLLOW_UP');
  });
});

describe('decideNext: normal judgment', () => {
  it('follows up on a shallow answer within budget', () => {
    const d = decideNext({ state: stateAfter(2, 0), analysis: shallow, bank });
    expect(d.action).toBe('FOLLOW_UP');
    expect(d.rules).toContain('shallow_answer');
    expect(d.forced).toBe(false);
  });

  it('follows up on an interesting hook', () => {
    const d = decideNext({ state: stateAfter(2, 0), analysis: hooked, bank });
    expect(d.action).toBe('FOLLOW_UP');
    expect(d.rules).toContain('interesting_hook');
    expect(d.reason).toContain('rewrote the cache layer');
  });

  it('stops following up once the budget is used', () => {
    const d = decideNext({
      state: stateAfter(3, defaultPolicyConfig.followUpBudget),
      analysis: shallow,
      bank,
    });
    expect(d.action).toBe('BANK');
  });

  it('limits consecutive follow-ups on normal judgment', () => {
    const d = decideNext({
      state: stateAfter(3, 2, { consecutiveFollowUps: 2 }),
      analysis: shallow,
      bank,
    });
    expect(d.action).toBe('BANK');
  });

  it('wraps up when the bank is exhausted and the floor is met', () => {
    const d = decideNext({
      state: stateAfter(6, 2, { askedQuestionIds: bank.map((b) => b.id) }),
      analysis: strong,
      bank,
    });
    expect(d.action).toBe('WRAP_UP');
    expect(d.rules).toContain('bank_exhausted');
  });
});

type SimResult = { questions: number; followUps: number; kinds: string[]; bankIds: string[] };

function simulate(rand: () => number, config: PolicyConfig = defaultPolicyConfig): SimResult {
  let state = recordQuestion(initialState(), {
    kind: 'bank',
    topic: bank[0].topic,
    category: bank[0].category,
    bank: bank[0],
  });
  const kinds = ['bank'];
  const bankIds = [bank[0].id];
  for (let guard = 0; guard < 40; guard++) {
    const roll = rand();
    const analysis: Analysis =
      roll < 0.3
        ? shallow
        : roll < 0.5
          ? hooked
          : roll < 0.6
            ? { ...strong, hook: 'a hook' }
            : strong;
    state = recordAnswer(state, analysis);
    const d = decideNext({ state, analysis, bank, config });
    if (d.action === 'WRAP_UP') {
      expect(state.questionsAsked).toBeGreaterThanOrEqual(config.minQuestions);
      expect(state.followUpsAsked).toBeGreaterThanOrEqual(config.minFollowUps);
      return { questions: state.questionsAsked, followUps: state.followUpsAsked, kinds, bankIds };
    }
    if (d.action === 'FOLLOW_UP') {
      state = recordQuestion(state, { kind: 'follow_up', topic: d.targetTopic, category: null });
      kinds.push('follow_up');
    } else {
      const q = d.bankQuestion!;
      state = recordQuestion(state, {
        kind: 'bank',
        topic: q.topic,
        category: q.category,
        bank: q,
      });
      kinds.push('bank');
      bankIds.push(q.id);
    }
  }
  throw new Error('interview did not terminate');
}

describe('randomized interviews always satisfy the hard rules', () => {
  it('2000 interviews: at least 6 questions, at least 2 follow-ups, bounded length, no repeats', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const r = simulate(mulberry32(seed));
      expect(r.questions).toBeGreaterThanOrEqual(6);
      expect(r.followUps).toBeGreaterThanOrEqual(2);
      expect(r.questions).toBeLessThanOrEqual(10);
      expect(new Set(r.bankIds).size).toBe(r.bankIds.length);
      expect(r.kinds.filter((k) => k === 'follow_up').length).toBe(r.followUps);
    }
  });

  it('holds for stricter configs (3 follow-ups, 8 questions)', () => {
    const config: PolicyConfig = {
      ...defaultPolicyConfig,
      minQuestions: 7,
      targetQuestions: 8,
      minFollowUps: 3,
      followUpBudget: 4,
    };
    for (let seed = 1; seed <= 500; seed++) {
      const r = simulate(mulberry32(seed + 9000), config);
      expect(r.followUps).toBeGreaterThanOrEqual(3);
      expect(r.questions).toBeGreaterThanOrEqual(7);
    }
  });

  it('a candidate who always answers strongly still gets two follow-ups', () => {
    const r = simulate(() => 0.99);
    expect(r.followUps).toBeGreaterThanOrEqual(2);
  });
});
