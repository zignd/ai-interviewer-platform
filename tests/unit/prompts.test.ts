import { describe, expect, it } from 'vitest';
import { analyzePrompt, evaluatePrompt, generatePrompt } from '@/lib/engine/prompts';
import { makeBank } from '../helpers/bank';

const job = {
  title: 'Data Analyst',
  description: 'Turns data into answers',
  seniority: 'Mid',
  competencies: ['SQL', 'Metrics'],
  keyterms: ['SQL'],
};

describe('prompts', () => {
  it('analyze prompt carries the role, question, answer and JSON-only instruction', () => {
    const p = analyzePrompt({ job, question: 'Why?', answer: 'Because data.', topics: ['sql'] });
    expect(p.system).toContain('Data Analyst');
    expect(p.system).toContain('single JSON object');
    expect(p.user).toContain('Because data.');
    expect(p.user).toContain('Why?');
  });

  it('follow-up prompt demands a verbatim anchor from the answer', () => {
    const p = generatePrompt({
      job,
      decision: { action: 'FOLLOW_UP', targetTopic: 't' },
      bankQuestion: null,
      previousQuestion: 'Q?',
      answer: 'I built a funnel.',
      hook: 'funnel',
      hints: ['angle'],
      transcriptTail: [{ role: 'candidate', text: 'I built a funnel.' }],
    });
    expect(p.system).toContain('copied EXACTLY');
    expect(p.user).toContain('I built a funnel.');
    expect(p.user).toContain('Worth probing: funnel');
    expect(p.user).toContain('angle');
  });

  it('bank prompt includes the bank question and forbids a second question', () => {
    const bank = makeBank()[0];
    const p = generatePrompt({
      job,
      decision: { action: 'BANK', targetTopic: bank.topic },
      bankQuestion: bank,
      previousQuestion: null,
      answer: null,
      hook: null,
      hints: [],
      transcriptTail: [],
    });
    expect(p.user).toContain(bank.text);
    expect(p.system).toContain('Do not add a second question');
  });

  it('evaluation prompt lists competencies and marks follow-ups in the transcript', () => {
    const p = evaluatePrompt({
      job,
      transcript: [
        { role: 'interviewer', text: 'Q', kind: 'follow_up' },
        { role: 'candidate', text: 'A', kind: null },
      ],
      skills: [{ skill: 'SQL', evidence: 'e', confidence: 1 }],
      qualityHistory: [5],
      gaps: ['g'],
    });
    expect(p.system).toContain('overall_score');
    expect(p.user).toContain('SQL; Metrics');
    expect(p.user).toContain('Interviewer (follow-up): Q');
  });
});
