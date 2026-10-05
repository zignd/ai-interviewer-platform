import { Badge } from '@/components/ui/card';
import {
  coverageChecklist,
  depthLabel,
  followUpProgress,
  kindLabel,
  ruleLabel,
  topicLabel,
} from '@/lib/decision-view';
import type { DecisionSnapshot } from '@/lib/engine/types';

/** Shows the interviewer's current signals and why it chose the latest question. Purely presentational. */
export function DecisionPanel({
  decision,
  allTopics,
  target,
}: {
  decision: DecisionSnapshot | null;
  allTopics: string[];
  target: number;
}) {
  if (!decision) {
    return (
      <p className="text-sm text-muted">
        The interviewer&apos;s reasoning appears here once the first question is asked.
      </p>
    );
  }
  const checklist = coverageChecklist(allTopics, decision.topicsCovered, decision.targetTopic);
  const followUps = followUpProgress(decision);
  const skills = [...decision.skillsDetected]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-5 text-sm" data-testid="decision-panel-body">
      <section aria-labelledby="why-heading">
        <h3 id="why-heading" className="mb-2 font-semibold">
          Why this question
        </h3>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Badge tone={decision.kind === 'follow_up' ? 'warning' : 'primary'}>
            {kindLabel[decision.kind]}
          </Badge>
          {decision.forced && <Badge tone="danger">Required by the follow-up minimum</Badge>}
          {decision.rules.map((r) => (
            <Badge key={r}>{ruleLabel(r)}</Badge>
          ))}
        </div>
        <p data-testid="decision-reason">{decision.reason}</p>
        {decision.rationale && decision.rationale !== decision.reason && (
          <p className="mt-2 text-muted">{decision.rationale}</p>
        )}
        {decision.anchor && (
          <p className="mt-2 rounded-lg bg-accent p-2 text-muted">
            Built on your words: <q>{decision.anchor}</q>
          </p>
        )}
      </section>

      <section aria-labelledby="progress-heading">
        <h3 id="progress-heading" className="mb-2 font-semibold">
          Interview rules
        </h3>
        <ul className="space-y-1">
          <li>
            Questions asked: {decision.questionsAsked} of about {target} (minimum 6)
          </li>
          <li>
            Follow-ups: {followUps.asked} of {followUps.required} required{' '}
            {followUps.met ? '✓' : ''}
          </li>
          {decision.depth && (
            <li>
              Last answer: {depthLabel[decision.depth]}
              {decision.quality !== null ? `, ${decision.quality}/10` : ''}
            </li>
          )}
        </ul>
      </section>

      <section aria-labelledby="skills-heading">
        <h3 id="skills-heading" className="mb-2 font-semibold">
          Skills detected
        </h3>
        {skills.length === 0 ? (
          <p className="text-muted">None yet. They appear as you answer.</p>
        ) : (
          <ul className="space-y-2" data-testid="decision-skills">
            {skills.map((s) => (
              <li key={s.skill}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{s.skill}</span>
                  <span className="text-xs text-muted">{Math.round(s.confidence * 100)}%</span>
                </div>
                <p className="text-xs text-muted">&ldquo;{s.evidence}&rdquo;</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="topics-heading">
        <h3 id="topics-heading" className="mb-2 font-semibold">
          Topics covered ({decision.topicsCovered.length} of {allTopics.length})
        </h3>
        <ul className="space-y-1" data-testid="decision-topics">
          {checklist.map((t) => (
            <li key={t.topic} className="flex items-center gap-2" data-status={t.status}>
              <span aria-hidden="true">
                {t.status === 'covered' ? '✓' : t.status === 'current' ? '●' : '○'}
              </span>
              <span className={t.status === 'open' ? 'text-muted' : ''}>{t.label}</span>
              {t.status === 'current' && <Badge tone="primary">now</Badge>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="gaps-heading">
        <h3 id="gaps-heading" className="mb-2 font-semibold">
          Gaps noticed
        </h3>
        {decision.gaps.length === 0 ? (
          <p className="text-muted">No gaps so far.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5" data-testid="decision-gaps">
            {decision.gaps.map((g) => (
              <li key={g}>{topicLabel(g)}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
