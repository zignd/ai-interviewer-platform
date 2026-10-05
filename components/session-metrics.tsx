import { Card } from '@/components/ui/card';
import { formatDuration, sparklinePath } from '@/lib/analytics/metrics';
import type { SessionMetrics } from '@/lib/db/history-repos';

export function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return <span className="text-muted">-</span>;
  return (
    <svg
      viewBox="0 0 80 24"
      className="h-6 w-20"
      role="img"
      aria-label={`Answer quality trend: ${values.join(', ')} out of 10`}
    >
      <path
        d={sparklinePath(values)}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const pct = (v: number | null) => (v === null ? '-' : `${Math.round(v * 100)}%`);

export function SessionMetricsCard({ metrics }: { metrics: SessionMetrics }) {
  const items: [string, React.ReactNode][] = [
    ['Duration', formatDuration(metrics.durationMs)],
    ['Candidate talk share', pct(metrics.talk.candidateShare)],
    [
      'Topic coverage',
      metrics.coverage.total
        ? `${metrics.coverage.covered} of ${metrics.coverage.total} (${pct(metrics.coverage.ratio)})`
        : '-',
    ],
    ['Answer quality trend', <Sparkline key="trend" values={metrics.trend} />],
  ];
  return (
    <Card className="p-5" data-testid="session-metrics">
      <h2 className="mb-3 text-base font-semibold">Session metrics</h2>
      <dl className="grid gap-4 sm:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
