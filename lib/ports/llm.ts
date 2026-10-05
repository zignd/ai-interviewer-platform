import type { ZodType } from 'zod';

export type LlmTask = 'analyze' | 'generate' | 'evaluate' | 'sample_answer';

export type LlmRequest<T> = {
  /** Which engine step is asking. Fakes switch on this. */
  task: LlmTask;
  /** Structured input. Fakes use this directly; real adapters use `prompt` instead. */
  input: unknown;
  prompt: { system: string; user: string };
  model: string;
  temperature: number;
  schema: ZodType<T>;
  maxTokens?: number;
  /** How much hidden reasoning the model may do. Lower is faster; some models always reason a little. */
  reasoningEffort?: 'minimal' | 'low' | 'medium';
};

/** Anything that can turn a prompt into JSON that matches a schema. */
export interface LlmClient {
  complete<T>(request: LlmRequest<T>): Promise<T>;
}
