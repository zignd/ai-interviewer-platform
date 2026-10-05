import { describe, expect, it } from 'vitest';
import {
  defaultTurnConfig,
  emptyBuffer,
  endsSentence,
  finishReason,
  onCommitted,
  onPartial,
  transcriptOf,
  wordCount,
} from '@/lib/voice/turn-assembler';

describe('turn assembly', () => {
  it('partial text replaces the previous partial and builds the transcript', () => {
    let b = emptyBuffer();
    b = onPartial(b, 'I worked', 1000);
    b = onPartial(b, 'I worked on the checkout', 1200);
    expect(transcriptOf(b)).toBe('I worked on the checkout');
    expect(b.startedAt).toBe(1000);
    expect(b.lastActivityAt).toBe(1200);
    expect(wordCount(b)).toBe(5);
  });

  it('a committed segment replaces the partial and later partials append after it', () => {
    let b = emptyBuffer();
    b = onPartial(b, 'first part', 100);
    b = onCommitted(b, 'First part.', 200);
    expect(b.partial).toBe('');
    b = onPartial(b, 'and the second', 300);
    expect(transcriptOf(b)).toBe('First part. and the second');
  });

  it('normalises whitespace and ignores empty commits', () => {
    let b = onPartial(emptyBuffer(), '  lots   of \n space ', 10);
    expect(transcriptOf(b)).toBe('lots of space');
    b = onCommitted(b, '   ', 20);
    expect(transcriptOf(b)).toBe('');
  });

  it('identical partials do not count as new activity', () => {
    const a = onPartial(emptyBuffer(), 'hello there friend', 100);
    const b = onPartial(a, 'hello there friend', 5000);
    expect(b).toBe(a);
  });

  it('clearing the partial is not activity', () => {
    const a = onPartial(emptyBuffer(), 'hello there friend', 100);
    const b = onPartial(a, '', 900);
    expect(b.lastActivityAt).toBe(100);
  });
});

describe('finishReason', () => {
  const cfg = {
    sentenceEndSilenceMs: 1500,
    midSentenceSilenceMs: 3000,
    minWords: 3,
    maxMs: 60_000,
  };

  it('never finishes before anything was said', () => {
    expect(finishReason(emptyBuffer(), 999_999, cfg)).toBeNull();
  });

  it('does not finish while the candidate is still talking or has said too little', () => {
    const talking = onPartial(emptyBuffer(), 'one two three four.', 1000);
    expect(finishReason(talking, 1400, cfg)).toBeNull();
    const tooShort = onPartial(emptyBuffer(), 'yes sure.', 1000);
    expect(finishReason(tooShort, 20_000, cfg)).toBeNull();
  });

  it('a finished sentence ends the answer after the shorter pause', () => {
    const b = onPartial(emptyBuffer(), 'I rebuilt the checkout page.', 1000);
    expect(finishReason(b, 2499, cfg)).toBeNull();
    expect(finishReason(b, 2500, cfg)).toBe('silence');
  });

  it('stopping mid-sentence gets the longer pause (the candidate is probably thinking)', () => {
    const b = onPartial(emptyBuffer(), 'I rebuilt the checkout page and then', 1000);
    expect(finishReason(b, 2600, cfg)).toBeNull();
    expect(finishReason(b, 3999, cfg)).toBeNull();
    expect(finishReason(b, 4000, cfg)).toBe('silence');
  });

  it('finishes at the maximum duration even while still talking', () => {
    let b = onPartial(emptyBuffer(), 'one two three', 0);
    b = onPartial(b, 'one two three four', 59_900);
    expect(finishReason(b, 60_000, cfg)).toBe('max_duration');
  });

  it('defaults give candidates time to think', () => {
    expect(defaultTurnConfig.sentenceEndSilenceMs).toBeGreaterThanOrEqual(1500);
    expect(defaultTurnConfig.midSentenceSilenceMs).toBeGreaterThanOrEqual(2500);
    expect(defaultTurnConfig.midSentenceSilenceMs).toBeGreaterThan(
      defaultTurnConfig.sentenceEndSilenceMs,
    );
  });
});

describe('endsSentence', () => {
  it('recognises sentence endings including closing quotes and brackets', () => {
    expect(endsSentence('That was it.')).toBe(true);
    expect(endsSentence('Really?')).toBe(true);
    expect(endsSentence('He said "stop."')).toBe(true);
    expect(endsSentence('and then we')).toBe(false);
    expect(endsSentence('well, ')).toBe(false);
  });
});
