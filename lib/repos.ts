import { getDb } from '@/lib/db/client';
import { createRepos } from '@/lib/db/repos';

/** Repositories for server components that only read the database. */
export function getRepos() {
  return createRepos(getDb());
}
