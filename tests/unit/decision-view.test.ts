import { describe, expect, it } from 'vitest';
import { coverageChecklist, followUpProgress, ruleLabel, topicLabel } from '@/lib/decision-view';

describe('decision view helpers', () => {
  it('humanizes topic names', () => {
    expect(topicLabel('state_management')).toBe('State management');
    expect(topicLabel('sql_and_data_wrangling')).toBe('SQL and data wrangling');
    expect(topicLabel('metrics_and_kpis')).toBe('Metrics and KPIs');
    expect(topicLabel('typescript_and_apis')).toBe('Typescript and APIs');
    expect(topicLabel('')).toBe('');
  });

  it('labels known rules and falls back to a readable name', () => {
    expect(ruleLabel('follow_up_floor')).toBe('Follow-up minimum');
    expect(ruleLabel('shallow_answer')).toBe('Shallow answer');
    expect(ruleLabel('some_new_rule')).toBe('Some new rule');
  });

  it('builds a coverage checklist with covered, current and open topics', () => {
    const items = coverageChecklist(['a', 'b', 'c', 'd'], ['a', 'b'], 'b');
    expect(items.map((i) => [i.topic, i.status])).toEqual([
      ['a', 'covered'],
      ['b', 'current'],
      ['c', 'open'],
      ['d', 'open'],
    ]);
  });

  it('reports follow-up progress against the required minimum', () => {
    expect(followUpProgress({ followUpsAsked: 0 })).toEqual({ asked: 0, required: 2, met: false });
    expect(followUpProgress({ followUpsAsked: 1 }).met).toBe(false);
    expect(followUpProgress({ followUpsAsked: 2 }).met).toBe(true);
    expect(followUpProgress({ followUpsAsked: 3 }).met).toBe(true);
  });
});
