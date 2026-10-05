/**
 * Collects live transcription events for ONE answer and decides when the answer is over.
 * Pure functions over plain data, so the rules are easy to test.
 */

export type TurnBuffer = {
  /** Finalised segments, in order. */
  committed: string[];
  /** The still-changing text of the current segment. It replaces itself on every partial event. */
  partial: string;
  /** When the first words arrived. */
  startedAt: number | null;
  /** When the transcript last changed. */
  lastActivityAt: number | null;
};

export type TurnConfig = {
  /** Silence needed to end an answer whose last sentence looks complete (ends with . ! or ?). */
  sentenceEndSilenceMs: number;
  /** Silence needed when the candidate stopped mid-sentence, which usually means they are still thinking. */
  midSentenceSilenceMs: number;
  /** Do not auto-finish before at least this many words were heard. */
  minWords: number;
  /** Hard cap on one answer. */
  maxMs: number;
};

/**
 * Candidates pause to think, so the limits are deliberately generous: a finished sentence ends the answer
 * after about 1.6 s, but stopping mid-sentence gets 3 s before we assume they are done.
 */
export const defaultTurnConfig: TurnConfig = {
  sentenceEndSilenceMs: 1600,
  midSentenceSilenceMs: 3000,
  minWords: 3,
  maxMs: 180_000,
};

/** True when the transcript ends like a finished sentence. */
export function endsSentence(text: string): boolean {
  return /[.!?]["')\]]*$/.test(text.trim());
}

export const emptyBuffer = (): TurnBuffer => ({
  committed: [],
  partial: '',
  startedAt: null,
  lastActivityAt: null,
});

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

export function onPartial(buf: TurnBuffer, text: string, now: number): TurnBuffer {
  const partial = clean(text);
  if (partial === buf.partial) return buf;
  return {
    ...buf,
    partial,
    startedAt: buf.startedAt ?? (partial ? now : null),
    // Clearing the partial is not speech, so it does not count as activity.
    lastActivityAt: partial ? now : buf.lastActivityAt,
  };
}

export function onCommitted(buf: TurnBuffer, text: string, now: number): TurnBuffer {
  const segment = clean(text);
  if (!segment) return { ...buf, partial: '' };
  return {
    committed: [...buf.committed, segment],
    partial: '',
    startedAt: buf.startedAt ?? now,
    lastActivityAt: now,
  };
}

export function transcriptOf(buf: TurnBuffer): string {
  return clean([...buf.committed, buf.partial].join(' '));
}

export function wordCount(buf: TurnBuffer): number {
  const t = transcriptOf(buf);
  return t ? t.split(' ').length : 0;
}

export type FinishReason = 'silence' | 'max_duration';

/** Decides whether the answer should end now, and why. */
export function finishReason(
  buf: TurnBuffer,
  now: number,
  config: TurnConfig = defaultTurnConfig,
): FinishReason | null {
  if (buf.startedAt !== null && now - buf.startedAt >= config.maxMs && wordCount(buf) > 0)
    return 'max_duration';
  if (buf.lastActivityAt !== null && wordCount(buf) >= config.minWords) {
    const limit = endsSentence(transcriptOf(buf))
      ? config.sentenceEndSilenceMs
      : config.midSentenceSilenceMs;
    if (now - buf.lastActivityAt >= limit) return 'silence';
  }
  return null;
}
