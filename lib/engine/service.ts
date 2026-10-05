import { TurnConflictError, createRepos, type Repos } from '@/lib/db/repos';
import { joinGate } from '@/lib/queue/service';
import type { Db } from '@/lib/db/client';
import type { Container } from '@/lib/container';
import {
  analyzeAnswer,
  evaluateInterview,
  generateQuestion,
  heuristicEvaluation,
  sampleAnswer,
} from './steps';
import { anchorOverlaps } from './anchor';
import { decideNext, pickBankQuestion } from './policy';
import { completeState, recordAnswer, recordQuestion } from './state';
import type { JobContext } from './prompts';
import {
  defaultPolicyConfig,
  evaluationSchema,
  initialState,
  type Analysis,
  type BankQuestion,
  type DecisionSnapshot,
  type Evaluation,
  type InterviewState,
  type PolicyDecision,
  type QuestionKind,
} from './types';

export class ServiceError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 502,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type TurnView = {
  idx: number;
  role: 'interviewer' | 'candidate';
  text: string;
  kind: QuestionKind | null;
};

export type TurnResult = {
  done: boolean;
  question: TurnView;
  decision: DecisionSnapshot;
  progress: { questionsAsked: number; target: number };
};

const MAX_ANSWER_CHARS = 8000;

function toBank(
  rows: {
    id: string;
    topic: string;
    category: 'behavioral' | 'technical';
    text: string;
    difficulty: number;
    followUpHints: string[];
    priority: number;
  }[],
): BankQuestion[] {
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    category: r.category,
    text: r.text,
    difficulty: r.difficulty,
    followUpHints: r.followUpHints,
    priority: r.priority,
  }));
}

function jobContext(job: {
  title: string;
  description: string;
  seniority: string;
  competencies: string[];
  keyterms: string[];
}): JobContext {
  return {
    title: job.title,
    description: job.description,
    seniority: job.seniority,
    competencies: job.competencies,
    keyterms: job.keyterms,
  };
}

async function loadSession(c: Pick<Container, 'repos'>, sessionId: string) {
  const session = await c.repos.sessions.byId(sessionId);
  if (!session) throw new ServiceError(404, 'session_not_found', 'Session not found');
  const job = await c.repos.jobs.byId(session.jobId);
  if (!job) throw new ServiceError(404, 'job_not_found', 'Job not found');
  const bank = toBank(await c.repos.bank.forJob(job.id));
  const state = (session.state as InterviewState | null) ?? initialState();
  return { session, job, bank, state };
}

export function openingText(jobTitle: string, question: string) {
  return `Hello, and thanks for making the time. I'm your AI interviewer for the ${jobTitle} role. I'll ask you a series of questions, so take your time and answer in your own words. Let's begin. ${question}`;
}

export const closingText =
  "Thank you, that's all the questions I have. Your interview is complete, and I'm preparing your feedback now.";

function snapshot(args: {
  turnIdx: number;
  decision: Pick<PolicyDecision, 'action' | 'reason' | 'rules' | 'forced' | 'targetTopic'>;
  kind: QuestionKind;
  rationale: string;
  anchor: string | null;
  analysis: Analysis | null;
  state: InterviewState;
  allTopics: string[];
}): DecisionSnapshot {
  return {
    turnIdx: args.turnIdx,
    action: args.decision.action,
    kind: args.kind,
    reason: args.decision.reason,
    rules: args.decision.rules,
    forced: args.decision.forced,
    targetTopic: args.decision.targetTopic,
    rationale: args.rationale,
    anchor: args.anchor,
    depth: args.analysis?.depth ?? null,
    quality: args.analysis?.quality ?? null,
    skillsDetected: args.state.skillsDetected,
    topicsCovered: args.state.topicsCovered,
    allTopics: args.allTopics,
    gaps: args.state.gaps,
    questionsAsked: args.state.questionsAsked,
    followUpsAsked: args.state.followUpsAsked,
  };
}

export async function createSession(
  c: Container,
  input: { jobId: string; mode: 'text' | 'voice' | 'video' },
) {
  const job = await c.repos.jobs.byId(input.jobId);
  if (!job) throw new ServiceError(404, 'job_not_found', 'Job not found');
  return c.repos.sessions.create({
    jobId: job.id,
    mode: input.mode,
    status: 'active',
    state: initialState(),
    now: c.clock.now(),
  });
}

/** Asks the first question. Calling it again returns the same question (idempotent). */
export async function startInterview(c: Container, sessionId: string): Promise<TurnResult> {
  const { session, job, bank, state } = await loadSession(c, sessionId);
  assertRunnable(session);
  if (session.status !== 'active') {
    throw new ServiceError(409, 'session_not_active', 'This session is not active');
  }
  const allTopics = [...new Set(bank.map((b) => b.topic))];
  const existing = await c.repos.turns.list(sessionId);
  if (existing.length > 0) {
    const last = [...existing].reverse().find((t) => t.role === 'interviewer')!;
    const decisions = await c.repos.decisions.list(sessionId);
    const snap = decisions.find((d) => d.turnIdx === last.idx)?.stateJson as DecisionSnapshot;
    return {
      done: state.phase === 'completed',
      question: { idx: last.idx, role: 'interviewer', text: last.text, kind: last.kind },
      decision: snap,
      progress: {
        questionsAsked: state.questionsAsked,
        target: defaultPolicyConfig.targetQuestions,
      },
    };
  }

  const first = pickBankQuestion(state, bank);
  if (!first) throw new ServiceError(409, 'empty_bank', 'This role has no questions');
  const decision: PolicyDecision = {
    action: 'BANK',
    targetTopic: first.topic,
    bankQuestion: first,
    reason: `Opening question: the highest-priority topic is "${first.topic}".`,
    rules: ['opening'],
    forced: false,
  };
  // The opening question is the bank text verbatim, so the interview starts instantly.
  const gen = { question: first.text, rationale: decision.reason };
  const next = recordQuestion(state, {
    kind: 'bank',
    topic: first.topic,
    category: first.category,
    bank: first,
  });
  const text = openingText(job.title, gen.question);
  const snap = snapshot({
    turnIdx: 0,
    decision,
    kind: 'bank',
    rationale: gen.rationale,
    anchor: null,
    analysis: null,
    state: next,
    allTopics,
  });

  await c.repos.db
    .transaction(async (tx) => {
      const r = createRepos(tx as unknown as Db);
      await r.turns.append({
        sessionId,
        idx: 0,
        role: 'interviewer',
        text,
        kind: 'bank',
        sourceQuestionId: first.id,
        startedAt: c.clock.now(),
      });
      await r.decisions.save(sessionId, 0, snap);
      await r.sessions.setState(sessionId, next);
    })
    .catch((err) => {
      if (err instanceof TurnConflictError) {
        throw new ServiceError(409, 'turn_conflict', 'The interview was already started');
      }
      throw err;
    });

  return {
    done: false,
    question: { idx: 0, role: 'interviewer', text, kind: 'bank' },
    decision: snap,
    progress: { questionsAsked: next.questionsAsked, target: defaultPolicyConfig.targetQuestions },
  };
}

export type SubmitInput = {
  transcript: string;
  startedAt?: Date;
  endedAt?: Date;
  audioMs?: number;
};

export async function submitTurn(
  c: Container,
  sessionId: string,
  input: SubmitInput,
): Promise<TurnResult> {
  const answer = input.transcript.trim();
  if (!answer) throw new ServiceError(400, 'empty_answer', 'The answer is empty');
  if (answer.length > MAX_ANSWER_CHARS) {
    throw new ServiceError(
      400,
      'answer_too_long',
      `Answers are limited to ${MAX_ANSWER_CHARS} characters`,
    );
  }

  const { session, job, bank, state } = await loadSession(c, sessionId);
  assertRunnable(session);
  if (session.status !== 'active') {
    throw new ServiceError(409, 'session_not_active', 'This session is not active');
  }
  const turns = await c.repos.turns.list(sessionId);
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'interviewer') {
    throw new ServiceError(409, 'not_awaiting_answer', 'There is no open question to answer');
  }
  const allTopics = [...new Set(bank.map((b) => b.topic))];
  const ctx = jobContext(job);

  // Latency: the model steps run in parallel. While the answer is being analyzed we already write both
  // possible next questions (the next bank question and a follow-up). Once the policy decides we keep
  // the matching one and drop the other. The bank pick does not depend on the analysis.
  const lastBankId = state.askedQuestionIds[state.askedQuestionIds.length - 1];
  const lastBank = bank.find((b) => b.id === lastBankId);
  const transcriptTail = [...turns.slice(-4), { role: 'candidate' as const, text: answer }].map(
    (t) => ({ role: t.role, text: t.text }),
  );
  const generateFor = (
    action: Pick<PolicyDecision, 'action' | 'targetTopic'>,
    bankQuestion: BankQuestion | null,
    hook: string | null,
  ) =>
    generateQuestion(c.llm, {
      job: ctx,
      decision: action,
      bankQuestion,
      previousQuestion: last.text,
      answer,
      hook,
      hints: bankQuestion ? bankQuestion.followUpHints : (lastBank?.followUpHints ?? []),
      transcriptTail,
    });

  const analysisPromise = analyzeAnswer(c.llm, {
    job: ctx,
    question: last.text,
    answer,
    topics: allTopics,
  });
  const speculativeBank = pickBankQuestion(state, bank);
  const bankPromise = speculativeBank
    ? generateFor({ action: 'BANK', targetTopic: speculativeBank.topic }, speculativeBank, null)
    : null;
  const followUpPromise = generateFor(
    { action: 'FOLLOW_UP', targetTopic: state.lastTopic },
    null,
    null,
  );
  // Whatever we end up not using must not surface as an unhandled rejection.
  bankPromise?.catch(() => undefined);
  followUpPromise.catch(() => undefined);

  const analysis = await analysisPromise;
  const answered = recordAnswer(state, analysis);
  const decision = decideNext({ state: answered, analysis, bank });

  const candidateIdx = last.idx + 1;
  const interviewerIdx = candidateIdx + 1;
  const now = c.clock.now();
  const candidateTurn = {
    sessionId,
    idx: candidateIdx,
    role: 'candidate' as const,
    text: answer,
    startedAt: input.startedAt ?? now,
    endedAt: input.endedAt ?? now,
    audioMs: input.audioMs ?? null,
  };

  if (decision.action === 'WRAP_UP') {
    const finished = completeState(answered);
    const snap = snapshot({
      turnIdx: interviewerIdx,
      decision,
      kind: 'generated',
      rationale: 'The interview is complete.',
      anchor: null,
      analysis,
      state: finished,
      allTopics,
    });
    await persist(c, async (r) => {
      await r.turns.append(candidateTurn);
      await r.turns.append({
        sessionId,
        idx: interviewerIdx,
        role: 'interviewer',
        text: closingText,
        kind: 'generated',
        startedAt: now,
      });
      await r.decisions.save(sessionId, interviewerIdx, snap);
      await r.sessions.setState(sessionId, finished);
      await r.sessions.complete(sessionId, now);
    });
    return {
      done: true,
      question: { idx: interviewerIdx, role: 'interviewer', text: closingText, kind: 'generated' },
      decision: snap,
      progress: {
        questionsAsked: finished.questionsAsked,
        target: defaultPolicyConfig.targetQuestions,
      },
    };
  }

  const isFollowUp = decision.action === 'FOLLOW_UP';
  let gen;
  if (isFollowUp) {
    gen = await followUpPromise;
    // If the policy chose this follow-up because of a specific hook, make sure the question is about it.
    if (
      analysis.hook &&
      decision.rules.includes('interesting_hook') &&
      !anchorOverlaps(gen.anchor, analysis.hook)
    ) {
      gen = await generateFor(decision, null, analysis.hook);
    }
  } else if (bankPromise && speculativeBank && decision.bankQuestion?.id === speculativeBank.id) {
    gen = await bankPromise;
  } else {
    gen = await generateFor(decision, decision.bankQuestion, null);
  }

  const kind: QuestionKind = isFollowUp ? 'follow_up' : 'bank';
  const next = recordQuestion(answered, {
    kind,
    topic: decision.targetTopic,
    category: decision.bankQuestion?.category ?? null,
    bank: decision.bankQuestion,
  });
  const snap = snapshot({
    turnIdx: interviewerIdx,
    decision,
    kind,
    rationale: gen.rationale,
    anchor: gen.anchor,
    analysis,
    state: next,
    allTopics,
  });

  await persist(c, async (r) => {
    await r.turns.append(candidateTurn);
    await r.turns.append({
      sessionId,
      idx: interviewerIdx,
      role: 'interviewer',
      text: gen.question,
      kind,
      sourceQuestionId: decision.bankQuestion?.id ?? null,
      startedAt: now,
    });
    await r.decisions.save(sessionId, interviewerIdx, snap);
    await r.sessions.setState(sessionId, next);
  });

  return {
    done: false,
    question: { idx: interviewerIdx, role: 'interviewer', text: gen.question, kind },
    decision: snap,
    progress: { questionsAsked: next.questionsAsked, target: defaultPolicyConfig.targetQuestions },
  };
}

async function persist(c: Container, work: (repos: Repos) => Promise<void>) {
  try {
    await c.repos.db.transaction(async (tx) => {
      await work(createRepos(tx as unknown as Db));
    });
  } catch (err) {
    if (err instanceof TurnConflictError) {
      throw new ServiceError(409, 'turn_conflict', 'This answer was already submitted');
    }
    throw err;
  }
}

/** Scores a finished interview. Safe to call repeatedly: the first result is kept. */
export async function evaluateSession(c: Container, sessionId: string): Promise<Evaluation> {
  const existing = await c.repos.evaluations.get(sessionId);
  if (existing) return evaluationSchema.parse(existing.json);

  const { session, job, state } = await loadSession(c, sessionId);
  if (session.status !== 'completed') {
    throw new ServiceError(409, 'not_finished', 'The interview is not finished yet');
  }
  const turns = await c.repos.turns.list(sessionId);
  const input = {
    job: jobContext(job),
    transcript: turns.map((t) => ({ role: t.role, text: t.text, kind: t.kind })),
    skills: state.skillsDetected,
    qualityHistory: state.qualityHistory,
    gaps: state.gaps,
  };
  let evaluation: Evaluation;
  try {
    evaluation = await evaluateInterview(c.llm, input);
  } catch (err) {
    console.warn(
      'evaluation failed, using heuristic scoring',
      err instanceof Error ? err.message : err,
    );
    evaluation = heuristicEvaluation(input);
  }
  const saved = await c.repos.evaluations.saveOnce(sessionId, evaluation);
  return evaluationSchema.parse(saved.json);
}

export async function getSessionView(c: Pick<Container, 'repos'>, sessionId: string) {
  const { session, job, bank, state } = await loadSession(c, sessionId);
  const [turns, decisions, evaluation] = await Promise.all([
    c.repos.turns.list(sessionId),
    c.repos.decisions.list(sessionId),
    c.repos.evaluations.get(sessionId),
  ]);
  return {
    session: {
      id: session.id,
      status: session.status,
      mode: session.mode,
      confirmedAt: session.confirmedAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    },
    job: {
      id: job.id,
      slug: job.slug,
      title: job.title,
      description: job.description,
      keyterms: job.keyterms,
    },
    allTopics: [...new Set(bank.map((b) => b.topic))],
    progress: { questionsAsked: state.questionsAsked, target: defaultPolicyConfig.targetQuestions },
    turns: turns.map((t) => ({
      idx: t.idx,
      role: t.role,
      text: t.text,
      kind: t.kind,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      audioMs: t.audioMs,
    })),
    decisions: decisions.map((d) => d.stateJson as DecisionSnapshot),
    evaluation: evaluation ? evaluationSchema.parse(evaluation.json) : null,
  };
}

/** Returns the text of an interviewer turn so it can be spoken. Only interviewer turns of an existing session. */
export async function getInterviewerTurnText(
  c: Pick<Container, 'repos'>,
  sessionId: string,
  idx: number,
) {
  const session = await c.repos.sessions.byId(sessionId);
  if (!session) throw new ServiceError(404, 'session_not_found', 'Session not found');
  const turns = await c.repos.turns.list(sessionId);
  const turn = turns.find((t) => t.idx === idx);
  if (!turn || turn.role !== 'interviewer') {
    throw new ServiceError(404, 'turn_not_found', 'No interviewer turn with that index');
  }
  return turn.text;
}

/** Credentials and settings the browser needs to start live transcription for one answer. */
export async function createSpeechSession(c: Container, sessionId: string) {
  const { session, job } = await loadSession(c, sessionId);
  assertRunnable(session);
  if (session.status !== 'active') {
    throw new ServiceError(409, 'session_not_active', 'This session is not active');
  }
  let token;
  try {
    token = await c.speechTokens.createScribeToken();
  } catch (err) {
    console.warn('speech token failed', err instanceof Error ? err.message : err);
    throw new ServiceError(
      502,
      'speech_unavailable',
      'Speech recognition is unavailable right now',
    );
  }
  // Scribe accepts at most 50 keyterms of up to 20 characters each.
  const keyterms = job.keyterms.filter((k) => k.length <= 20).slice(0, 50);
  return { ...token, keyterms, modelId: 'scribe_v2_realtime' };
}

/** Prepares a conversation with the ElevenLabs agent: makes sure the first question exists and returns a signed URL. */
export async function createAgentSession(c: Container, sessionId: string) {
  const first = await startInterview(c, sessionId);
  let signedUrl: string;
  try {
    signedUrl = await c.agent.createSignedUrl();
  } catch (err) {
    console.warn('agent signed url failed', err instanceof Error ? err.message : err);
    throw new ServiceError(502, 'agent_unavailable', 'The voice agent is unavailable right now');
  }
  return { signedUrl, openingText: first.question.text, questionIdx: first.question.idx };
}

/**
 * Creates a session the way the app does. Text interviews start at once. Voice and video interviews
 * join the capacity gate and either start immediately or wait in line.
 */
export async function createAndJoin(
  c: Container,
  input: { jobId: string; mode: 'text' | 'voice' | 'video' },
) {
  if (input.mode === 'text') {
    const session = await createSession(c, input);
    return { id: session.id, status: session.status, queue: null };
  }
  const job = await c.repos.jobs.byId(input.jobId);
  if (!job) throw new ServiceError(404, 'job_not_found', 'Job not found');
  const now = c.clock.now();
  const session = await c.repos.sessions.create({
    jobId: job.id,
    mode: input.mode,
    status: 'queued',
    state: initialState(),
    now,
  });
  const queue = await joinGate(c.repos.db, session.id, now);
  return { id: session.id, status: queue.status, queue };
}

/** Interviews only run once the candidate has a confirmed slot. */
export function assertRunnable(session: { status: string; confirmedAt: Date | null }) {
  if (
    session.status === 'queued' ||
    (session.status === 'active' && session.confirmedAt === null)
  ) {
    throw new ServiceError(
      409,
      'waiting_for_slot',
      'This interview is still waiting for a free slot',
    );
  }
}

/** Developer mode: a strong sample answer to the interviewer's current question, to read aloud or paste. */
export async function getSampleAnswer(c: Container, sessionId: string) {
  const { job } = await loadSession(c, sessionId);
  const turns = await c.repos.turns.list(sessionId);
  const last = [...turns].reverse().find((t) => t.role === 'interviewer');
  if (!last) throw new ServiceError(409, 'no_question', 'There is no question to answer yet');
  const answer = await sampleAnswer(c.llm, {
    job: jobContext(job),
    question: last.text,
    isFollowUp: last.kind === 'follow_up',
    earlier: turns.slice(-5, -1).map((t) => ({ role: t.role, text: t.text })),
  });
  return { answer, questionIdx: last.idx };
}
