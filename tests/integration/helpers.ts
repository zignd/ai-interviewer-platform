import { sql } from 'drizzle-orm';
import { createDb } from '@/lib/db/client';
import { createRepos } from '@/lib/db/repos';
import { setContainer, type Container } from '@/lib/container';
import { FakeLlm } from '@/lib/adapters/fake-llm';
import {
  FakeAgentSessions,
  FakeBlobStore,
  FakeSpeechSynthesizer,
  FakeSpeechTokens,
} from '@/lib/adapters/fakes';
import { FakeClock } from '@/lib/ports';
import { TEST_DATABASE_URL, assertLocalDb } from './db-url';

export function createTestContainer(overrides: Partial<Container> = {}) {
  assertLocalDb(TEST_DATABASE_URL);
  const { db, sql: client } = createDb(TEST_DATABASE_URL, { max: 8 });
  const repos = createRepos(db);
  const clock = new FakeClock();
  const blob = new FakeBlobStore();
  const container: Container = {
    repos,
    llm: new FakeLlm(),
    speechTokens: new FakeSpeechTokens(),
    agent: new FakeAgentSessions(),
    synthesizer: new FakeSpeechSynthesizer(),
    blob,
    clock,
    ...overrides,
  };
  setContainer(container);
  return {
    container,
    repos,
    db,
    clock,
    blob,
    close: async () => {
      setContainer(undefined);
      await client.end({ timeout: 2 });
    },
    /** Removes all interview data but keeps the seeded jobs and question banks. */
    reset: async () => {
      await db.execute(
        sql`truncate table recordings, decisions, evaluations, turns, sessions restart identity cascade`,
      );
    },
  };
}

export const SHORT_ANSWER = 'I fixed it quickly and it worked fine.';
export const LONG_ANSWER =
  'On my last project we had a checkout page that became slow because we fetched too much data on every render. ' +
  'I profiled it with the browser tools, found that three components re-rendered on every keystroke, and moved the state down. ' +
  'However, the real win came from caching the API response, which cut the load time from four seconds to under one. ' +
  'I then added a regression test and documented the decision for the team so it would not creep back in later.';

export function jsonRequest(url: string, body?: unknown) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}
