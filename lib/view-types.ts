import type { DecisionSnapshot, Evaluation, QuestionKind } from '@/lib/engine/types';

/** JSON-safe shape of the session view returned by the API and passed to client components. */
export type SessionViewData = {
  session: {
    id: string;
    status: 'queued' | 'active' | 'completed' | 'abandoned';
    mode: 'text' | 'voice' | 'video';
    confirmedAt: string | null;
    startedAt: string | null;
    endedAt: string | null;
  };
  job: { id: string; slug: string; title: string; description: string; keyterms: string[] };
  allTopics: string[];
  progress: { questionsAsked: number; target: number };
  turns: {
    idx: number;
    role: 'interviewer' | 'candidate';
    text: string;
    kind: QuestionKind | null;
    startedAt: string;
    endedAt: string | null;
    audioMs: number | null;
  }[];
  decisions: DecisionSnapshot[];
  evaluation: Evaluation | null;
};

export type TurnResultData = {
  done: boolean;
  question: { idx: number; role: 'interviewer'; text: string; kind: QuestionKind | null };
  decision: DecisionSnapshot;
  progress: { questionsAsked: number; target: number };
};
