import { describe, expect, it } from 'vitest';
import {
  anchorAppearsIn,
  anchorOverlaps,
  fallbackFollowUp,
  followUpDependsOnAnswer,
  pickSnippet,
} from '@/lib/engine/anchor';

const answer =
  'We cut the checkout load time from four seconds to one by caching the API response. Then we added a regression test.';

describe('anchorAppearsIn', () => {
  it('matches verbatim fragments ignoring case and punctuation', () => {
    expect(anchorAppearsIn(answer, 'Caching the API response')).toBe(true);
    expect(anchorAppearsIn(answer, 'from four seconds to one')).toBe(true);
  });
  it('rejects invented, empty or too-short anchors', () => {
    expect(anchorAppearsIn(answer, 'we rewrote everything in Rust')).toBe(false);
    expect(anchorAppearsIn(answer, null)).toBe(false);
    expect(anchorAppearsIn(answer, 'API')).toBe(false);
  });
});

describe('followUpDependsOnAnswer', () => {
  it('accepts a question that reuses the quoted words', () => {
    expect(
      followUpDependsOnAnswer(
        'How did caching the API response affect users?',
        'caching the API response',
        answer,
      ),
    ).toBe(true);
  });
  it('rejects a generic question even with a real anchor', () => {
    expect(
      followUpDependsOnAnswer(
        'What is your greatest weakness?',
        'caching the API response',
        answer,
      ),
    ).toBe(false);
  });
  it('rejects a question whose anchor is not in the answer', () => {
    expect(
      followUpDependsOnAnswer(
        'Tell me about Kubernetes clusters',
        'Kubernetes clusters at scale',
        answer,
      ),
    ).toBe(false);
  });
});

describe('fallbackFollowUp', () => {
  it('always quotes a real fragment of the answer', () => {
    const fb = fallbackFollowUp(answer);
    expect(anchorAppearsIn(answer, fb.anchor)).toBe(true);
    expect(fb.question).toContain(fb.anchor);
    expect(followUpDependsOnAnswer(fb.question, fb.anchor, answer)).toBe(true);
  });
  it('prefers the analysis hook when it is in the answer', () => {
    expect(pickSnippet(answer, 'adding a regression test')).not.toBe('');
    const fb = fallbackFollowUp(answer, 'caching the API response');
    expect(fb.anchor).toBe('caching the API response');
  });
  it('limits the snippet length', () => {
    expect(pickSnippet(answer.repeat(5)).split(' ').length).toBeLessThanOrEqual(12);
  });
});

describe('anchorOverlaps', () => {
  it('is true when the anchor and the hook share at least two content words', () => {
    expect(
      anchorOverlaps('caching the API response', 'we added caching for every API response'),
    ).toBe(true);
  });
  it('is false for unrelated fragments or missing values', () => {
    expect(anchorOverlaps('caching the API response', 'we hired two designers')).toBe(false);
    expect(anchorOverlaps(null, 'something')).toBe(false);
    expect(anchorOverlaps('something', undefined)).toBe(false);
  });
});
