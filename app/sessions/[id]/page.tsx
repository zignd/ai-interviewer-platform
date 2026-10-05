import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EvaluateOnMount } from '@/components/evaluate-on-mount';
import { ReplayPlayer } from '@/components/replay-player';
import { SessionMetricsCard } from '@/components/session-metrics';
import { Button } from '@/components/ui/button';
import { getDb } from '@/lib/db/client';
import { getReplayData, sessionMetrics } from '@/lib/db/history-repos';
import { Badge, Card } from '@/components/ui/card';
import { ruleLabel } from '@/lib/decision-view';
import { ServiceError, getSessionView } from '@/lib/engine/service';
import { uuidSchema } from '@/lib/http';
import { getRepos } from '@/lib/repos';
import type { Evaluation } from '@/lib/engine/types';

export const dynamic = 'force-dynamic';

const recommendationLabel: Record<
  Evaluation['recommendation'],
  { label: string; tone: 'success' | 'primary' | 'warning' | 'danger' }
> = {
  strong_hire: { label: 'Strong hire', tone: 'success' },
  hire: { label: 'Hire', tone: 'success' },
  lean_hire: { label: 'Lean hire', tone: 'warning' },
  no_hire: { label: 'No hire', tone: 'danger' },
};

function ScoreRing({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const color = score >= 70 ? 'var(--success)' : score >= 55 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div className="relative h-32 w-32" role="img" aria-label={`Overall score ${score} out of 100`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--border)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-3xl font-semibold">{score}</div>
          <div className="text-xs text-muted">out of 100</div>
        </div>
      </div>
    </div>
  );
}

export default async function SessionPage({ params }: PageProps<'/sessions/[id]'>) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  let view;
  try {
    view = await getSessionView({ repos: getRepos() }, id);
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
  const db = getDb();
  const [metrics, replay] = await Promise.all([sessionMetrics(db, id), getReplayData(db, id)]);
  const { evaluation, turns, job, session, decisions } = view;
  const decisionFor = new Map(decisions.map((d) => [d.turnIdx, d]));
  const finished = session.status === 'completed';
  const questionNumbers = new Map<number, number>();
  turns
    .filter((t) => t.role === 'interviewer' && t.kind !== 'generated')
    .forEach((t, i) => questionNumbers.set(t.idx, i + 1));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Interview results</p>
          <h1 className="text-2xl font-semibold">{job.title}</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/">
            <Button variant="outline">Try another role</Button>
          </Link>
        </div>
      </div>

      {!finished && (
        <Card className="p-6">
          <p className="font-medium">This interview isn&apos;t finished yet.</p>
          <Link href={`/interview/${id}`}>
            <Button className="mt-3">Continue interview</Button>
          </Link>
        </Card>
      )}

      {finished && !evaluation && <EvaluateOnMount sessionId={id} />}

      {metrics && <SessionMetricsCard metrics={metrics} />}

      {replay.state === 'stored' && (
        <ReplayPlayer kind={replay.kind} url={replay.url} turns={replay.turns} />
      )}
      {replay.state === 'deleted' && (
        <Card className="p-4 text-sm text-muted" data-testid="recording-deleted">
          Recording deleted to save storage. The transcript, evaluation and metrics are kept.
        </Card>
      )}

      {evaluation && (
        <section aria-labelledby="evaluation-heading" className="flex flex-col gap-6">
          <h2 id="evaluation-heading" className="sr-only">
            Evaluation
          </h2>
          <Card className="flex flex-col items-center gap-6 p-6 sm:flex-row">
            <ScoreRing score={evaluation.overall_score} />
            <div className="flex-1">
              <Badge tone={recommendationLabel[evaluation.recommendation].tone}>
                {recommendationLabel[evaluation.recommendation].label}
              </Badge>
              <p className="mt-3 text-base leading-relaxed">{evaluation.summary}</p>
            </div>
          </Card>
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-6">
              <h3 className="mb-3 font-semibold text-success">Strengths</h3>
              <ul className="list-disc space-y-2 pl-5 text-sm">
                {evaluation.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </Card>
            <Card className="p-6">
              <h3 className="mb-3 font-semibold text-warning">Concerns</h3>
              {evaluation.concerns.length === 0 ? (
                <p className="text-sm text-muted">No significant concerns.</p>
              ) : (
                <ul className="list-disc space-y-2 pl-5 text-sm">
                  {evaluation.concerns.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card className="p-6">
            <h3 className="mb-4 font-semibold">Competencies</h3>
            <ul className="space-y-3">
              {evaluation.competencies.map((c) => (
                <li key={c.competency} className="text-sm">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="font-medium">{c.competency}</span>
                    <span className="text-muted">{c.score} / 5</span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-border"
                    role="img"
                    aria-label={`${c.score} out of 5`}
                  >
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${(c.score / 5) * 100}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted">{c.evidence}</p>
                </li>
              ))}
            </ul>
          </Card>
          <details className="rounded-2xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Show raw evaluation JSON
            </summary>
            <pre
              className="mt-3 overflow-x-auto rounded-lg bg-background p-4 text-xs"
              data-testid="evaluation-json"
            >
              {JSON.stringify(evaluation, null, 2)}
            </pre>
          </details>
        </section>
      )}

      <section aria-labelledby="transcript-heading">
        <h2 id="transcript-heading" className="mb-4 text-lg font-semibold">
          Full transcript
        </h2>
        <ol className="flex flex-col gap-4" data-testid="transcript">
          {turns.map((t) => {
            return (
              <li key={t.idx}>
                <Card
                  className={
                    t.role === 'interviewer' ? 'p-4' : 'ml-6 border-primary/20 bg-accent p-4'
                  }
                >
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    <span className="font-semibold">
                      {t.role === 'interviewer'
                        ? t.kind === 'generated'
                          ? 'Interviewer'
                          : `Question ${questionNumbers.get(t.idx)}`
                        : 'You'}
                    </span>
                    {t.kind === 'follow_up' && <Badge tone="warning">Follow-up</Badge>}
                    {t.kind === 'bank' && <Badge>Role question</Badge>}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.text}</p>
                  {t.role === 'interviewer' && decisionFor.get(t.idx) && (
                    <details className="mt-3 text-xs text-muted">
                      <summary className="cursor-pointer">Why this question?</summary>
                      <p className="mt-2">{decisionFor.get(t.idx)!.reason}</p>
                      {decisionFor.get(t.idx)!.rules.length > 0 && (
                        <p className="mt-1">
                          Rules: {decisionFor.get(t.idx)!.rules.map(ruleLabel).join(', ')}
                        </p>
                      )}
                    </details>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
