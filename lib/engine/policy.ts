import {
  defaultPolicyConfig,
  type Analysis,
  type BankQuestion,
  type InterviewState,
  type PolicyConfig,
  type PolicyDecision,
} from './types';

export type PolicyInput = {
  /** State after the answer was recorded: `questionsAsked` includes the question just answered. */
  state: InterviewState;
  analysis: Analysis;
  bank: BankQuestion[];
  config?: PolicyConfig;
};

/**
 * Picks the next bank question: the lowest-priority-number topic that is still uncovered,
 * preferring the category we did not just ask. Falls back to any unasked question.
 */
export function pickBankQuestion(state: InterviewState, bank: BankQuestion[]): BankQuestion | null {
  const unasked = bank.filter((q) => !state.askedQuestionIds.includes(q.id));
  if (unasked.length === 0) return null;
  const uncovered = unasked.filter((q) => !state.topicsCovered.includes(q.topic));
  const pool = (uncovered.length > 0 ? uncovered : unasked)
    .slice()
    .sort((a, b) => a.priority - b.priority);
  const topic = pool[0].topic;
  const sameTopic = pool.filter((q) => q.topic === topic);
  return sameTopic.find((q) => q.category !== state.lastCategory) ?? sameTopic[0];
}

/**
 * Plain code decides what happens next. The LLM only writes the words afterwards.
 *
 * Hard rules, in order:
 *  1. Follow-up floor: at least `minFollowUps` follow-ups. Once the turns left before
 *     `minQuestions` are no more than the follow-ups still owed, the next turns are forced
 *     follow-ups, even if the answer was strong. Never wrap up while the floor is unmet.
 *  2. Wrap up at `targetQuestions`, or when the bank runs out (floor permitting).
 *  3. Normal judgment: follow up on a shallow answer or an interesting hook, within the budget.
 *  4. Otherwise ask the next bank question.
 */
export function decideNext({
  state,
  analysis,
  bank,
  config = defaultPolicyConfig,
}: PolicyInput): PolicyDecision {
  const owed = Math.max(0, config.minFollowUps - state.followUpsAsked);
  const turnsBeforeMinimum = Math.max(0, config.minQuestions - state.questionsAsked);
  const lastTopic = state.lastTopic;

  // 1. Follow-up floor.
  if (owed > 0 && turnsBeforeMinimum <= owed) {
    return {
      action: 'FOLLOW_UP',
      targetTopic: lastTopic,
      bankQuestion: null,
      forced: true,
      rules: ['follow_up_floor'],
      reason:
        `Follow-up floor: ${state.followUpsAsked} of ${config.minFollowUps} required follow-ups asked, ` +
        `and ${turnsBeforeMinimum} turn(s) remain before the ${config.minQuestions}-question minimum, ` +
        `so the next question must be a follow-up.`,
    };
  }

  // 2. Wrap up.
  if (state.questionsAsked >= config.targetQuestions) {
    return {
      action: 'WRAP_UP',
      targetTopic: null,
      bankQuestion: null,
      forced: false,
      rules: ['target_reached'],
      reason: `${state.questionsAsked} questions asked (target ${config.targetQuestions}) and the follow-up floor is met, so the interview wraps up.`,
    };
  }

  // 3. Normal follow-up judgment.
  const canFollowUp =
    state.followUpsAsked < config.followUpBudget &&
    state.consecutiveFollowUps < config.maxConsecutiveFollowUps;
  if (canFollowUp && analysis.depth === 'shallow') {
    return {
      action: 'FOLLOW_UP',
      targetTopic: lastTopic,
      bankQuestion: null,
      forced: false,
      rules: ['shallow_answer'],
      reason: 'The answer was shallow, so the next question probes for a concrete example.',
    };
  }
  if (canFollowUp && analysis.hook) {
    return {
      action: 'FOLLOW_UP',
      targetTopic: lastTopic,
      bankQuestion: null,
      forced: false,
      rules: ['interesting_hook'],
      reason: `The candidate raised something worth probing: "${analysis.hook}".`,
    };
  }

  // 4. Next bank question.
  const next = pickBankQuestion(state, bank);
  if (!next) {
    return {
      action: 'WRAP_UP',
      targetTopic: null,
      bankQuestion: null,
      forced: false,
      rules: ['bank_exhausted'],
      reason: 'The question bank for this role is exhausted, so the interview wraps up.',
    };
  }
  const uncovered = !state.topicsCovered.includes(next.topic);
  return {
    action: 'BANK',
    targetTopic: next.topic,
    bankQuestion: next,
    forced: false,
    rules: [uncovered ? 'uncovered_topic' : 'revisit_topic'],
    reason: uncovered
      ? `Topic "${next.topic}" is still uncovered, so the next question comes from the bank.`
      : `All topics are covered, so the next question revisits "${next.topic}" from the bank.`,
  };
}
