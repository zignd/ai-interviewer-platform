/**
 * Single place that decides which OpenRouter model does which job.
 * Swap a model here and nothing else needs to change.
 */
export const models = {
  /** Picks the next question and writes follow-ups. Needs reliable JSON and good instruction following. */
  strong: 'anthropic/claude-sonnet-5.5',
  /** Cheap and fast: skill extraction and answer depth, runs on every turn. */
  fast: 'google/gemini-3.8-flash',
  /** Final evaluation. Same strong model, low temperature. */
  evaluation: 'anthropic/claude-sonnet-5.5',
} as const;

export const temperatures = {
  analyze: 0,
  generate: 0.5,
  evaluation: 0.1,
} as const;
