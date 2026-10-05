/** Compares latency and follow-up quality of candidate models. Run with `npx tsx scripts/bench-models.ts`. */
import 'dotenv/config';
import { OpenRouterClient } from '../lib/adapters/openrouter';
import { followUpDependsOnAnswer } from '../lib/engine/anchor';
import { analyzePrompt, generatePrompt } from '../lib/engine/prompts';
import { analysisSchema, generationSchema } from '../lib/engine/types';
import { seedJobs } from '../lib/seed/data';

const llm = new OpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY! });
const j = seedJobs[0];
const job = {
  title: j.title,
  description: j.description,
  seniority: j.seniority,
  competencies: j.competencies,
  keyterms: j.keyterms,
};
const question = j.topics[0].behavioral.text;
const answer =
  'On a dashboard project our global store became a tangle because every component subscribed to everything. I moved server data to React Query, kept form state local, and left only auth and theme in Redux. Renders dropped a lot, although I never measured it properly, and the team found the code easier to follow.';

const models = (
  process.argv[2] ??
  'anthropic/claude-sonnet-5.5,google/gemini-3.8-flash,openai/gpt-5.4-mini,anthropic/claude-haiku-4.5,google/gemini-3.5-flash-lite'
).split(',');

async function time<T>(fn: () => Promise<T>) {
  const t = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - t, value, error: null as string | null };
  } catch (e) {
    return {
      ms: Date.now() - t,
      value: null as T | null,
      error: e instanceof Error ? e.message.slice(0, 80) : String(e),
    };
  }
}

async function main() {
  for (const model of models) {
    const gen: number[] = [];
    const ana: number[] = [];
    let valid = 0;
    let sample = '';
    let err = '';
    for (let i = 0; i < 3; i++) {
      const g = await time(() =>
        llm.complete({
          task: 'generate',
          input: {},
          model,
          temperature: 0.5,
          schema: generationSchema,
          maxTokens: 800,
          reasoningEffort: 'minimal',
          prompt: generatePrompt({
            job,
            decision: { action: 'FOLLOW_UP', targetTopic: 'state_management' },
            bankQuestion: null,
            previousQuestion: question,
            answer,
            hook: 'Renders dropped a lot, although I never measured it properly',
            hints: j.topics[0].behavioral.followUpHints,
            transcriptTail: [],
          }),
        }),
      );
      gen.push(g.ms);
      if (g.value && followUpDependsOnAnswer(g.value.question, g.value.anchor, answer)) valid++;
      if (g.value) sample = g.value.question;
      if (g.error) err = g.error;
      const a = await time(() =>
        llm.complete({
          task: 'analyze',
          input: {},
          model,
          temperature: 0,
          schema: analysisSchema,
          maxTokens: 1200,
          reasoningEffort: 'minimal',
          prompt: analyzePrompt({ job, question, answer, topics: j.topics.map((t) => t.topic) }),
        }),
      );
      ana.push(a.ms);
      if (a.error) err = a.error;
    }
    const med = (xs: number[]) => xs.slice().sort((x, y) => x - y)[1];
    console.log(
      `${model.padEnd(36)} generate ${med(gen)} ms (valid follow-ups ${valid}/3)  analyze ${med(ana)} ms ${err ? ' ERR ' + err : ''}`,
    );
    console.log(`   e.g. ${sample.slice(0, 150)}`);
  }
}
main();
