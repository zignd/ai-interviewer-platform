import { getContainer } from '@/lib/container';
import { handle, json } from '@/lib/http';

/** The roles that can be interviewed for (the same list the home page shows). */
export async function GET() {
  return handle(async () => {
    const jobs = await getContainer().repos.jobs.list();
    return json({
      jobs: jobs.map((j) => ({
        id: j.id,
        slug: j.slug,
        title: j.title,
        description: j.description,
      })),
    });
  });
}
