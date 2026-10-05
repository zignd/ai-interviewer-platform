import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { jobs, questionBank } from '@/lib/db/schema';
import { seedJobs } from './data';

/** Deterministic UUID so re-seeding updates rows instead of orphaning turn references. */
export function stableId(...parts: string[]): string {
  const h = createHash('sha1').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function seed(db: Db) {
  for (const job of seedJobs) {
    const jobId = stableId('job', job.slug);
    await db
      .insert(jobs)
      .values({
        id: jobId,
        slug: job.slug,
        title: job.title,
        description: job.description,
        seniority: job.seniority,
        competencies: job.competencies,
        keyterms: job.keyterms,
      })
      .onConflictDoUpdate({
        target: jobs.id,
        set: {
          slug: job.slug,
          title: job.title,
          description: job.description,
          seniority: job.seniority,
          competencies: job.competencies,
          keyterms: job.keyterms,
        },
      });

    const rows = job.topics.flatMap((t, i) =>
      (['behavioral', 'technical'] as const).map((category) => {
        const q = t[category];
        return {
          id: stableId('question', job.slug, t.topic, category),
          jobId,
          category,
          topic: t.topic,
          text: q.text,
          difficulty: q.difficulty,
          followUpHints: q.followUpHints,
          priority: i * 10 + (category === 'technical' ? 1 : 0),
        };
      }),
    );
    await db
      .insert(questionBank)
      .values(rows)
      .onConflictDoUpdate({
        target: questionBank.id,
        set: {
          category: sql`excluded.category`,
          topic: sql`excluded.topic`,
          text: sql`excluded.text`,
          difficulty: sql`excluded.difficulty`,
          followUpHints: sql`excluded.follow_up_hints`,
          priority: sql`excluded.priority`,
        },
      });
  }
}
