import { z } from 'zod';

export const depthSchema = z.enum(['shallow', 'adequate', 'strong']);
export type Depth = z.infer<typeof depthSchema>;

export const skillSchema = z.object({
  skill: z.string().min(1),
  evidence: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type Skill = z.infer<typeof skillSchema>;

/** Output of the analyze step (fast model). */
export const analysisSchema = z.object({
  depth: depthSchema,
  /** 0 to 10 quality of the answer, used for the score trend. */
  quality: z.number().min(0).max(10),
  skills: z.array(skillSchema).max(8),
  /** What a strong answer would have included but this one lacked. */
  missing: z.array(z.string()).max(6),
  /** One interesting claim worth probing, or null. */
  hook: z.string().nullable(),
});
export type Analysis = z.infer<typeof analysisSchema>;

export type QuestionKind = 'bank' | 'follow_up' | 'generated';
export type Category = 'behavioral' | 'technical';

export type BankQuestion = {
  id: string;
  topic: string;
  category: Category;
  text: string;
  difficulty: number;
  followUpHints: string[];
  priority: number;
};

export type Phase = 'not_started' | 'in_progress' | 'completed';

/** The interview state machine. Stored on the session and owned by the server. */
export type InterviewState = {
  phase: Phase;
  /** Interviewer questions asked so far (bank, follow-ups and generated). */
  questionsAsked: number;
  followUpsAsked: number;
  consecutiveFollowUps: number;
  topicsCovered: string[];
  gaps: string[];
  skillsDetected: Skill[];
  askedQuestionIds: string[];
  lastTopic: string | null;
  lastCategory: Category | null;
  /** Quality score of each answered question, in order. */
  qualityHistory: number[];
};

export const initialState = (): InterviewState => ({
  phase: 'not_started',
  questionsAsked: 0,
  followUpsAsked: 0,
  consecutiveFollowUps: 0,
  topicsCovered: [],
  gaps: [],
  skillsDetected: [],
  askedQuestionIds: [],
  lastTopic: null,
  lastCategory: null,
  qualityHistory: [],
});

export type PolicyConfig = {
  minQuestions: number;
  /** Normal interviews wrap up after this many questions (if the follow-up floor is met). */
  targetQuestions: number;
  minFollowUps: number;
  /** Most follow-ups we will ask on normal judgment. The floor can exceed this. */
  followUpBudget: number;
  maxConsecutiveFollowUps: number;
};

export const defaultPolicyConfig: PolicyConfig = {
  minQuestions: 6,
  targetQuestions: 7,
  minFollowUps: 2,
  followUpBudget: 3,
  maxConsecutiveFollowUps: 2,
};

export type Action = 'FOLLOW_UP' | 'BANK' | 'WRAP_UP';

export type PolicyDecision = {
  action: Action;
  targetTopic: string | null;
  bankQuestion: BankQuestion | null;
  /** Plain-English reason produced by code, shown in the decision panel. */
  reason: string;
  /** Machine-readable names of the rules that fired. */
  rules: string[];
  /** True when the 2-follow-up floor forced this follow-up. */
  forced: boolean;
};

/** Output of the generate step (strong model). */
export const generationSchema = z.object({
  question: z.string().min(5),
  rationale: z.string().min(1),
  /** For follow-ups: words copied exactly from the candidate's answer that the question builds on. */
  anchor: z.string().nullable(),
});
export type Generation = z.infer<typeof generationSchema>;

/** Developer mode: a model-written strong answer to the current question. */
export const sampleAnswerSchema = z.object({ answer: z.string().min(20) });
export type SampleAnswer = z.infer<typeof sampleAnswerSchema>;

export const evaluationSchema = z.object({
  overall_score: z.number().int().min(0).max(100),
  recommendation: z.enum(['strong_hire', 'hire', 'lean_hire', 'no_hire']),
  summary: z.string().min(1),
  strengths: z.array(z.string()).min(1).max(8),
  concerns: z.array(z.string()).max(8),
  competencies: z
    .array(
      z.object({
        competency: z.string(),
        score: z.number().int().min(1).max(5),
        evidence: z.string(),
      }),
    )
    .min(1),
});
export type Evaluation = z.infer<typeof evaluationSchema>;

/** Snapshot stored per interviewer turn and shown in the decision panel. */
export type DecisionSnapshot = {
  turnIdx: number;
  action: Action;
  kind: QuestionKind;
  reason: string;
  rules: string[];
  forced: boolean;
  targetTopic: string | null;
  rationale: string;
  anchor: string | null;
  depth: Depth | null;
  quality: number | null;
  skillsDetected: Skill[];
  topicsCovered: string[];
  allTopics: string[];
  gaps: string[];
  questionsAsked: number;
  followUpsAsked: number;
};
