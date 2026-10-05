import { StartInterview } from '@/components/start-interview';
import { Badge, Card } from '@/components/ui/card';
import { getRepos } from '@/lib/repos';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const jobs = await getRepos().jobs.list();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <section className="mb-10 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">
          Practice an interview that listens
        </h1>
        <p className="mt-3 text-lg text-muted">
          Pick a role. An AI interviewer asks questions grounded in the job and follows up on what
          you actually say. You get a full transcript and structured feedback at the end.
        </p>
      </section>
      <div className="grid gap-6 md:grid-cols-3">
        {jobs.map((job) => (
          <Card key={job.id} className="flex flex-col p-6">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="min-w-0 text-lg font-semibold">{job.title}</h2>
              <Badge tone="primary">{job.seniority}</Badge>
            </div>
            <p className="mb-4 flex-1 text-sm text-muted">{job.description}</p>
            <ul className="mb-5 flex flex-wrap gap-1.5" aria-label="Competencies">
              {job.competencies.slice(0, 4).map((c) => (
                <li key={c}>
                  <Badge>{c}</Badge>
                </li>
              ))}
            </ul>
            <StartInterview jobId={job.id} jobTitle={job.title} />
          </Card>
        ))}
      </div>
    </main>
  );
}
