import type { LlmClient, LlmRequest } from '@/lib/ports';
import { pickSnippet } from '@/lib/engine/anchor';
import type {
  Analysis,
  Evaluation,
  Generation,
  PolicyDecision,
  BankQuestion,
  Skill,
} from '@/lib/engine/types';

type AnalyzeInput = { answer: string; job: { keyterms: string[] }; question: string };
type GenerateInput = {
  decision: Pick<PolicyDecision, 'action' | 'targetTopic'>;
  bankQuestion: BankQuestion | null;
  answer: string | null;
  hook: string | null;
};
type EvaluateInput = {
  job: { competencies: string[] };
  skills: Skill[];
  qualityHistory: number[];
  gaps: string[];
};

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Deterministic stand-in for the real model, used by tests and by the UI when USE_FAKES=1.
 * Behaviour is driven only by the structured input, so results are repeatable:
 *  - answers under 25 words are "shallow", under 70 "adequate", otherwise "strong"
 *  - an answer containing "because" or "however" yields a hook
 *  - follow-ups quote the first 6 words of the answer
 */
export class FakeLlm implements LlmClient {
  async complete<T>(request: LlmRequest<T>): Promise<T> {
    switch (request.task) {
      case 'analyze':
        return request.schema.parse(this.analyze(request.input as AnalyzeInput));
      case 'generate':
        return request.schema.parse(this.generate(request.input as GenerateInput));
      case 'evaluate':
        return request.schema.parse(this.evaluate(request.input as EvaluateInput));
      case 'sample_answer':
        return request.schema.parse(this.sampleAnswer(request.input as { question: string }));
    }
  }

  private sampleAnswer({ question }: { question: string }) {
    return {
      answer:
        `On a recent project I faced exactly this, because ${question.slice(0, 60).toLowerCase()} mattered for our users. ` +
        'I measured the problem first, proposed two options to the team, and chose the simpler one. ' +
        'I owned the change end to end, added tests, and the result was a clear improvement we tracked for a month. ' +
        'Looking back, I would involve the stakeholders earlier and write the decision down sooner.',
    };
  }

  private analyze({ answer, job }: AnalyzeInput): Analysis {
    const words = wordCount(answer);
    const depth = words < 25 ? 'shallow' : words < 70 ? 'adequate' : 'strong';
    const lower = answer.toLowerCase();
    const skills = job.keyterms
      .filter((k) => lower.includes(k.toLowerCase()))
      .slice(0, 4)
      .map((k) => ({ skill: k, evidence: k, confidence: 0.8 }));
    const hookMatch = answer.match(/[^.!?]*\b(because|however)\b[^.!?]*/i);
    return {
      depth,
      quality: Math.min(10, Math.max(1, Math.round(words / 10))),
      skills,
      missing: depth === 'shallow' ? ['a concrete example', 'a measurable result'] : [],
      hook: hookMatch ? pickSnippet(hookMatch[0].trim(), null, 10) : null,
    };
  }

  private generate({ decision, bankQuestion, answer, hook }: GenerateInput): Generation {
    if (decision.action === 'FOLLOW_UP') {
      const anchor = pickSnippet(
        (answer ?? '').split(/\s+/).slice(0, 6).join(' '),
        hook && (answer ?? '').includes(hook) ? hook : null,
        6,
      );
      return {
        question: `You mentioned "${anchor}". Can you go deeper on that: what exactly did you do, and what was the result?`,
        rationale: 'Probe the specific detail the candidate raised.',
        anchor,
      };
    }
    return {
      question: bankQuestion?.text ?? 'Tell me more about your experience.',
      rationale: `Covers the topic "${bankQuestion?.topic ?? 'general'}".`,
      anchor: null,
    };
  }

  private evaluate({ job, skills, qualityHistory, gaps }: EvaluateInput): Evaluation {
    const avg = qualityHistory.length
      ? qualityHistory.reduce((a, b) => a + b, 0) / qualityHistory.length
      : 0;
    const score = Math.max(0, Math.min(100, Math.round(avg * 10)));
    const recommendation =
      score >= 85 ? 'strong_hire' : score >= 70 ? 'hire' : score >= 55 ? 'lean_hire' : 'no_hire';
    return {
      overall_score: score,
      recommendation,
      summary: `The candidate averaged ${avg.toFixed(1)} out of 10 across ${qualityHistory.length} answers.`,
      strengths: skills.length
        ? skills.slice(0, 4).map((s) => `Demonstrated ${s.skill}`)
        : ['Answered every question'],
      concerns: gaps.slice(0, 4),
      competencies: job.competencies.map((competency) => ({
        competency,
        score: Math.max(1, Math.min(5, Math.round(avg / 2))),
        evidence: 'See transcript',
      })),
    };
  }
}
