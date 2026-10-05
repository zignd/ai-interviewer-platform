import type { DecisionSnapshot } from '@/lib/engine/types';

/** "state_management" becomes "State management". */
const ACRONYMS: Record<string, string> = {
  sql: 'SQL',
  kpis: 'KPIs',
  kpi: 'KPI',
  api: 'API',
  apis: 'APIs',
  qbr: 'QBR',
};

export function topicLabel(topic: string): string {
  const words = topic
    .replace(/_/g, ' ')
    .trim()
    .split(' ')
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w);
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ruleLabels: Record<string, string> = {
  follow_up_floor: 'Follow-up minimum',
  shallow_answer: 'Shallow answer',
  interesting_hook: 'Interesting detail',
  uncovered_topic: 'Uncovered topic',
  revisit_topic: 'Revisiting a topic',
  target_reached: 'Question target reached',
  bank_exhausted: 'Question bank exhausted',
  opening: 'Opening question',
};

export function ruleLabel(rule: string): string {
  return ruleLabels[rule] ?? topicLabel(rule);
}

export type CoverageItem = { topic: string; label: string; status: 'covered' | 'current' | 'open' };

/** Checklist of every topic for the role: covered, being asked now, or still open. */
export function coverageChecklist(
  allTopics: string[],
  covered: string[],
  currentTopic: string | null,
): CoverageItem[] {
  return allTopics.map((topic) => ({
    topic,
    label: topicLabel(topic),
    status: topic === currentTopic ? 'current' : covered.includes(topic) ? 'covered' : 'open',
  }));
}

export type FollowUpProgress = { asked: number; required: number; met: boolean };

export function followUpProgress(
  decision: Pick<DecisionSnapshot, 'followUpsAsked'>,
  required = 2,
): FollowUpProgress {
  return { asked: decision.followUpsAsked, required, met: decision.followUpsAsked >= required };
}

export const depthLabel = { shallow: 'Shallow', adequate: 'Adequate', strong: 'Strong' } as const;

export const kindLabel = {
  bank: 'Role question',
  follow_up: 'Follow-up',
  generated: 'Closing',
} as const;
