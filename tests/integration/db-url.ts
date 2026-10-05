export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/interviewer_test';

/** Integration tests wipe the schema, so refuse anything that is not a local database. */
export function assertLocalDb(url: string) {
  const host = new URL(url).hostname;
  if (
    !['localhost', '127.0.0.1', '::1', 'db', 'postgres'].includes(host) &&
    process.env.ALLOW_REMOTE_TEST_DB !== '1'
  ) {
    throw new Error(`Refusing to run integration tests against non-local database host "${host}".`);
  }
}
