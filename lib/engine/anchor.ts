const STOP = new Set([
  'that',
  'this',
  'with',
  'have',
  'from',
  'were',
  'what',
  'when',
  'which',
  'would',
  'about',
  'there',
  'their',
  'them',
  'then',
  'than',
  'been',
  'into',
  'your',
  'you',
  'and',
  'the',
  'for',
]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentWords(text: string): string[] {
  return [
    ...new Set(
      normalize(text)
        .split(' ')
        .filter((w) => w.length >= 4 && !STOP.has(w)),
    ),
  ];
}

/** True when `anchor` is copied from the candidate's answer (ignoring case and punctuation). */
export function anchorAppearsIn(answer: string, anchor: string | null | undefined): boolean {
  if (!anchor) return false;
  const a = normalize(anchor);
  if (a.length < 8 || a.split(' ').length < 2) return false;
  return normalize(answer).includes(a);
}

/**
 * A follow-up "depends on the answer" when it quotes a real fragment of it and the question
 * itself reuses at least two of the fragment's content words.
 */
export function followUpDependsOnAnswer(
  question: string,
  anchor: string | null | undefined,
  answer: string,
): boolean {
  if (!anchorAppearsIn(answer, anchor)) return false;
  const q = new Set(contentWords(question));
  const shared = contentWords(anchor as string).filter((w) => q.has(w));
  return shared.length >= 2 || normalize(question).includes(normalize(anchor as string));
}

/** Picks a short verbatim fragment of the answer, preferring `preferred` (e.g. the analysis hook). */
export function pickSnippet(answer: string, preferred?: string | null, maxWords = 12): string {
  const clean = answer.replace(/\s+/g, ' ').trim();
  if (preferred && anchorAppearsIn(clean, preferred)) {
    const words = preferred.trim().split(/\s+/);
    return words.slice(0, maxWords).join(' ');
  }
  const sentences = clean.split(/(?<=[.!?])\s+/).filter((s) => s.split(' ').length >= 4);
  const best =
    sentences.sort((a, b) => contentWords(b).length - contentWords(a).length)[0] ?? clean;
  const words = best.replace(/[.!?]+$/, '').split(' ');
  return words.slice(0, maxWords).join(' ');
}

/** Deterministic follow-up used when the model can't produce one that quotes the answer. */
export function fallbackFollowUp(answer: string, hook?: string | null) {
  const snippet = pickSnippet(answer, hook);
  return {
    question: `You said "${snippet}". Can you walk me through that in more detail: what exactly did you do, and what was the result?`,
    anchor: snippet,
  };
}

/** True when two fragments share at least two content words, i.e. they are about the same thing. */
export function anchorOverlaps(
  anchor: string | null | undefined,
  hook: string | null | undefined,
): boolean {
  if (!anchor || !hook) return false;
  const a = new Set(contentWords(anchor));
  return contentWords(hook).filter((w) => a.has(w)).length >= 2;
}
