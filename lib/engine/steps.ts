import { models, temperatures } from '@/lib/models';
import type { LlmClient } from '@/lib/ports';
import { fallbackFollowUp, followUpDependsOnAnswer } from './anchor';
import {
  analyzePrompt,
  evaluatePrompt,
  generatePrompt,
  samplePrompt,
  type JobContext,
} from './prompts';
import {
  analysisSchema,
  evaluationSchema,
  sampleAnswerSchema,
  generationSchema,
  type Analysis,
  type BankQuestion,
  type Evaluation,
  type Generation,
  type PolicyDecision,
  type Skill,
} from './types';

type Turn = { role: 'interviewer' | 'candidate'; text: string };

/** Heuristic used only if the model fails twice, so an interview never dies on a bad response. */
export function heuristicAnalysis(answer: string): Analysis {
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  const depth = words < 25 ? 'shallow' : words < 70 ? 'adequate' : 'strong';
  return {
    depth,
    quality: Math.min(10, Math.round(words / 12)),
    skills: [],
    missing: depth === 'shallow' ? ['a concrete example', 'a measurable result'] : [],
    hook: null,
  };
}

export async function analyzeAnswer(
  llm: LlmClient,
  input: { job: JobContext; question: string; answer: string; topics: string[] },
): Promise<Analysis> {
  try {
    return await llm.complete({
      task: 'analyze',
      input,
      prompt: analyzePrompt(input),
      model: models.fast,
      temperature: temperatures.analyze,
      schema: analysisSchema,
      maxTokens: 1200,
      reasoningEffort: 'minimal',
    });
  } catch (err) {
    console.warn('analyze step failed, using heuristic', err instanceof Error ? err.message : err);
    return heuristicAnalysis(input.answer);
  }
}

export type GenerateInput = {
  job: JobContext;
  decision: Pick<PolicyDecision, 'action' | 'targetTopic'>;
  bankQuestion: BankQuestion | null;
  previousQuestion: string | null;
  answer: string | null;
  hook: string | null;
  hints: string[];
  transcriptTail: Turn[];
};

/**
 * Writes the next question. Bank questions fall back to the original text on failure.
 * Follow-ups must quote the candidate's answer; if the model fails to, we retry once and then
 * build a deterministic follow-up that quotes it, so the dependency requirement always holds.
 */
export async function generateQuestion(
  llm: LlmClient,
  input: GenerateInput,
): Promise<Generation & { usedFallback: boolean }> {
  const isFollowUp = input.decision.action === 'FOLLOW_UP';
  const attempt = async (): Promise<Generation> =>
    llm.complete({
      task: 'generate',
      input,
      prompt: generatePrompt(input),
      model: models.strong,
      temperature: temperatures.generate,
      schema: generationSchema,
      maxTokens: 800,
      reasoningEffort: 'minimal',
    });

  for (let i = 0; i < 2; i++) {
    try {
      const g = await attempt();
      if (!isFollowUp) {
        return { ...g, anchor: null, usedFallback: false };
      }
      if (followUpDependsOnAnswer(g.question, g.anchor, input.answer ?? '')) {
        return { ...g, usedFallback: false };
      }
    } catch (err) {
      console.warn('generate step failed', err instanceof Error ? err.message : err);
    }
  }

  if (isFollowUp) {
    const fb = fallbackFollowUp(input.answer ?? '', input.hook);
    return {
      question: fb.question,
      anchor: fb.anchor,
      rationale: "Follow-up built directly from the candidate's own words.",
      usedFallback: true,
    };
  }
  return {
    question: input.bankQuestion?.text ?? 'Tell me more about your experience.',
    anchor: null,
    rationale: `Next uncovered topic: ${input.bankQuestion?.topic ?? 'general'}.`,
    usedFallback: true,
  };
}

export async function sampleAnswer(
  llm: LlmClient,
  input: {
    job: JobContext;
    question: string;
    isFollowUp: boolean;
    earlier: { role: 'interviewer' | 'candidate'; text: string }[];
  },
): Promise<string> {
  const result = await llm.complete({
    task: 'sample_answer',
    input,
    prompt: samplePrompt(input),
    model: models.strong,
    temperature: 0.6,
    schema: sampleAnswerSchema,
    maxTokens: 600,
    reasoningEffort: 'minimal',
  });
  return result.answer.trim();
}

export async function evaluateInterview(
  llm: LlmClient,
  input: {
    job: JobContext;
    transcript: { role: 'interviewer' | 'candidate'; text: string; kind: string | null }[];
    skills: Skill[];
    qualityHistory: number[];
    gaps: string[];
  },
): Promise<Evaluation> {
  return llm.complete({
    task: 'evaluate',
    input,
    prompt: evaluatePrompt(input),
    model: models.evaluation,
    temperature: temperatures.evaluation,
    schema: evaluationSchema,
    maxTokens: 2500,
    reasoningEffort: 'low',
  });
}

/** Used only if the evaluator model fails, so a finished interview always gets a result. */
export function heuristicEvaluation(input: {
  job: { competencies: string[] };
  skills: Skill[];
  qualityHistory: number[];
  gaps: string[];
}): Evaluation {
  const history = input.qualityHistory;
  const avg = history.length ? history.reduce((a, b) => a + b, 0) / history.length : 0;
  const score = Math.max(0, Math.min(100, Math.round(avg * 10)));
  return {
    overall_score: score,
    recommendation:
      score >= 85 ? 'strong_hire' : score >= 70 ? 'hire' : score >= 55 ? 'lean_hire' : 'no_hire',
    summary: `Automatic scoring (the AI evaluator was unavailable): average answer quality ${avg.toFixed(1)} out of 10 across ${history.length} answers.`,
    strengths: input.skills.length
      ? input.skills.slice(0, 4).map((s) => `Demonstrated ${s.skill}`)
      : ['Completed the interview'],
    concerns: input.gaps.slice(0, 4),
    competencies: input.job.competencies.map((competency) => ({
      competency,
      score: Math.max(1, Math.min(5, Math.round(avg / 2))),
      evidence: 'See transcript',
    })),
  };
}
