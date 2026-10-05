import type {
  Analysis,
  BankQuestion,
  Category,
  InterviewState,
  QuestionKind,
  Skill,
} from './types';

export function mergeSkills(existing: Skill[], incoming: Skill[]): Skill[] {
  const byName = new Map(existing.map((s) => [s.skill.toLowerCase(), s]));
  for (const s of incoming) {
    const key = s.skill.toLowerCase();
    const prev = byName.get(key);
    if (!prev || s.confidence > prev.confidence) byName.set(key, s);
  }
  return [...byName.values()];
}

/** Applies the analysis of a candidate answer to the state. */
export function recordAnswer(state: InterviewState, analysis: Analysis): InterviewState {
  const gaps = [...new Set([...analysis.missing, ...state.gaps])].slice(0, 8);
  return {
    ...state,
    skillsDetected: mergeSkills(state.skillsDetected, analysis.skills),
    qualityHistory: [...state.qualityHistory, analysis.quality],
    gaps,
  };
}

export type AskedQuestion = {
  kind: QuestionKind;
  topic: string | null;
  category: Category | null;
  bank?: BankQuestion | null;
};

/** Applies a newly asked interviewer question to the state. */
export function recordQuestion(state: InterviewState, asked: AskedQuestion): InterviewState {
  const isFollowUp = asked.kind === 'follow_up';
  const topic = asked.topic ?? state.lastTopic;
  return {
    ...state,
    phase: 'in_progress',
    questionsAsked: state.questionsAsked + 1,
    followUpsAsked: state.followUpsAsked + (isFollowUp ? 1 : 0),
    consecutiveFollowUps: isFollowUp ? state.consecutiveFollowUps + 1 : 0,
    topicsCovered:
      topic && !state.topicsCovered.includes(topic)
        ? [...state.topicsCovered, topic]
        : state.topicsCovered,
    askedQuestionIds: asked.bank
      ? [...state.askedQuestionIds, asked.bank.id]
      : state.askedQuestionIds,
    lastTopic: topic,
    lastCategory: isFollowUp ? state.lastCategory : (asked.category ?? state.lastCategory),
  };
}

export function completeState(state: InterviewState): InterviewState {
  return { ...state, phase: 'completed' };
}
