/**
 * Live smoke test: real OpenRouter calls through the engine steps (no database).
 * Run with `npm run smoke`. It needs OPENROUTER_API_KEY and is NOT part of CI.
 * Prints per-step latency so model choices can be sanity-checked.
 */
import 'dotenv/config';
import { OpenRouterClient } from '../lib/adapters/openrouter';
import { followUpDependsOnAnswer } from '../lib/engine/anchor';
import { analyzeAnswer, evaluateInterview, generateQuestion } from '../lib/engine/steps';
import { seedJobs } from '../lib/seed/data';
import { evaluationSchema } from '../lib/engine/types';

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const result = await fn();
  console.log(`  ${label}: ${Date.now() - t0} ms`);
  return result;
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const llm = new OpenRouterClient({ apiKey });
  const seedJob = seedJobs[0];
  const job = {
    title: seedJob.title,
    description: seedJob.description,
    seniority: seedJob.seniority,
    competencies: seedJob.competencies,
    keyterms: seedJob.keyterms,
  };
  const question = seedJob.topics[0].behavioral.text;
  const answer =
    'On a dashboard project our global store became a tangle because every component subscribed to everything. ' +
    'I moved server data to React Query, kept form state local, and left only auth and theme in Redux. ' +
    'Renders dropped a lot, although I never measured it properly, and the team found the code easier to follow.';

  console.log('Analyze');
  const analysis = await timed('analyze', () =>
    analyzeAnswer(llm, { job, question, answer, topics: seedJob.topics.map((t) => t.topic) }),
  );
  console.log('  ', JSON.stringify(analysis));

  console.log('Generate follow-up');
  const gen = await timed('generate', () =>
    generateQuestion(llm, {
      job,
      decision: { action: 'FOLLOW_UP', targetTopic: seedJob.topics[0].topic },
      bankQuestion: null,
      previousQuestion: question,
      answer,
      hook: analysis.hook,
      hints: seedJob.topics[0].behavioral.followUpHints,
      transcriptTail: [],
    }),
  );
  console.log('  ', JSON.stringify(gen));
  const depends = followUpDependsOnAnswer(gen.question, gen.anchor, answer);
  console.log('  follow-up quotes the answer:', depends, gen.usedFallback ? '(fallback used)' : '');

  console.log('Evaluate');
  const evaluation = await timed('evaluate', () =>
    evaluateInterview(llm, {
      job,
      transcript: [
        { role: 'interviewer', text: question, kind: 'bank' },
        { role: 'candidate', text: answer, kind: null },
        { role: 'interviewer', text: gen.question, kind: 'follow_up' },
        {
          role: 'candidate',
          text: 'I used the React Profiler on the list view and saw commits fall from about 40 to 12 per interaction.',
          kind: null,
        },
      ],
      skills: analysis.skills,
      qualityHistory: [analysis.quality, 7],
      gaps: analysis.missing,
    }),
  );
  console.log('  ', JSON.stringify(evaluation).slice(0, 400));
  evaluationSchema.parse(evaluation);
  console.log('\nLive smoke test passed.');
}

main().catch((err) => {
  console.error('\nLive smoke test FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
