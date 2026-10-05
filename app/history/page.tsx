import Link from 'next/link';
import { Sparkline, pct } from '@/components/session-metrics';
import { Badge, Card } from '@/components/ui/card';
import { formatDuration } from '@/lib/analytics/metrics';
import { getDb } from '@/lib/db/client';
import { listHistory } from '@/lib/db/history-repos';
import { getRepos } from '@/lib/repos';

export const dynamic = 'force-dynamic';

const statusTone = {
  completed: 'success',
  active: 'primary',
  queued: 'warning',
  abandoned: 'danger',
} as const;

export default async function HistoryPage({ searchParams }: PageProps<'/history'>) {
  const query = await searchParams;
  const role = Array.isArray(query.role) ? query.role[0] : query.role;
  const [jobs, rows] = await Promise.all([
    getRepos().jobs.list(),
    listHistory(getDb(), { roleSlug: role }),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Interview history</h1>
        <p className="mt-1 text-sm text-muted">
          Past sessions with their metrics. Open one to replay it.
        </p>
      </div>

      <nav aria-label="Filter by role" className="flex flex-wrap gap-2">
        <Link href="/history">
          <Badge tone={role ? 'default' : 'primary'}>All roles</Badge>
        </Link>
        {jobs.map((j) => (
          <Link key={j.id} href={`/history?role=${j.slug}`}>
            <Badge tone={role === j.slug ? 'primary' : 'default'}>{j.title}</Badge>
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Card className="p-8 text-center" data-testid="history-empty">
          <p className="font-medium">No interviews yet.</p>
          <p className="mt-1 text-sm text-muted">
            {role ? 'Nothing for this role. ' : ''}
            <Link href="/" className="underline">
              Start an interview
            </Link>{' '}
            and it will show up here.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="history-table">
            <thead className="text-left text-xs text-muted">
              <tr>
                {[
                  'Role',
                  'Date',
                  'Status',
                  'Duration',
                  'Score',
                  'Talk share',
                  'Topics',
                  'Trend',
                  '',
                ].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border" data-testid="history-row">
                  <td className="px-4 py-3 font-medium">{r.roleTitle}</td>
                  <td className="px-4 py-3">
                    {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone[r.status]}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-3">{formatDuration(r.metrics.durationMs)}</td>
                  <td className="px-4 py-3">{r.metrics.overallScore ?? '-'}</td>
                  <td className="px-4 py-3">{pct(r.metrics.talk.candidateShare)}</td>
                  <td className="px-4 py-3">
                    {r.metrics.coverage.total
                      ? `${r.metrics.coverage.covered}/${r.metrics.coverage.total}`
                      : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <Sparkline values={r.metrics.trend} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/sessions/${r.id}`} className="text-primary underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}
