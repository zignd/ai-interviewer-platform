import { describe, expect, it } from 'vitest';
import { completeState, mergeSkills, recordAnswer, recordQuestion } from '@/lib/engine/state';
import { initialState } from '@/lib/engine/types';
import { makeBank } from '../helpers/bank';

const bank = makeBank();

describe('state transitions', () => {
  it('starts not_started and moves to in_progress on the first question', () => {
    const s = initialState();
    expect(s.phase).toBe('not_started');
    const next = recordQuestion(s, {
      kind: 'bank',
      topic: 'topic_0',
      category: 'behavioral',
      bank: bank[0],
    });
    expect(next.phase).toBe('in_progress');
    expect(next.questionsAsked).toBe(1);
    expect(next.topicsCovered).toEqual(['topic_0']);
    expect(next.askedQuestionIds).toEqual([bank[0].id]);
    expect(next.lastCategory).toBe('behavioral');
  });

  it('counts follow-ups and consecutive follow-ups, and resets on a bank question', () => {
    let s = recordQuestion(initialState(), {
      kind: 'bank',
      topic: 'topic_0',
      category: 'behavioral',
      bank: bank[0],
    });
    s = recordQuestion(s, { kind: 'follow_up', topic: 'topic_0', category: null });
    s = recordQuestion(s, { kind: 'follow_up', topic: 'topic_0', category: null });
    expect(s.followUpsAsked).toBe(2);
    expect(s.consecutiveFollowUps).toBe(2);
    expect(s.questionsAsked).toBe(3);
    expect(s.topicsCovered).toEqual(['topic_0']);
    expect(s.lastCategory).toBe('behavioral');
    s = recordQuestion(s, { kind: 'bank', topic: 'topic_1', category: 'technical', bank: bank[2] });
    expect(s.consecutiveFollowUps).toBe(0);
    expect(s.followUpsAsked).toBe(2);
    expect(s.topicsCovered).toEqual(['topic_0', 'topic_1']);
  });

  it('does not mutate the previous state', () => {
    const s = initialState();
    recordQuestion(s, { kind: 'bank', topic: 'topic_0', category: 'behavioral', bank: bank[0] });
    expect(s.questionsAsked).toBe(0);
  });

  it('records answers: quality history, deduplicated gaps, merged skills', () => {
    let s = initialState();
    s = recordAnswer(s, {
      depth: 'shallow',
      quality: 3,
      skills: [{ skill: 'React', evidence: 'used React', confidence: 0.5 }],
      missing: ['example', 'result'],
      hook: null,
    });
    s = recordAnswer(s, {
      depth: 'strong',
      quality: 8,
      skills: [{ skill: 'react', evidence: 'built a React app', confidence: 0.9 }],
      missing: ['example'],
      hook: null,
    });
    expect(s.qualityHistory).toEqual([3, 8]);
    expect(s.gaps.sort()).toEqual(['example', 'result']);
    expect(s.skillsDetected).toHaveLength(1);
    expect(s.skillsDetected[0].confidence).toBe(0.9);
  });

  it('completes', () => {
    expect(completeState(initialState()).phase).toBe('completed');
  });
});

describe('mergeSkills', () => {
  it('keeps the highest-confidence evidence per skill', () => {
    const merged = mergeSkills(
      [{ skill: 'SQL', evidence: 'a', confidence: 0.4 }],
      [
        { skill: 'sql', evidence: 'b', confidence: 0.8 },
        { skill: 'dbt', evidence: 'c', confidence: 0.5 },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.skill.toLowerCase() === 'sql')?.evidence).toBe('b');
  });
});
