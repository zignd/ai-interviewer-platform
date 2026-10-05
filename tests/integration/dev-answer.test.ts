import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as devAnswerRoute } from '@/app/api/sessions/[id]/dev-answer/route';
import { createSession, startInterview } from '@/lib/engine/service';
import { createTestContainer, ctx, jsonRequest } from './helpers';

const t = createTestContainer();
afterAll(() => t.close());
beforeEach(() => t.reset());
afterEach(() => {
  delete process.env.DEV_MODE;
});

async function started() {
  const job = await t.repos.jobs.bySlug('frontend-engineer');
  const session = await createSession(t.container, { jobId: job!.id, mode: 'text' });
  const first = await startInterview(t.container, session.id);
  return { id: session.id, first };
}

describe('developer mode sample answers', () => {
  it('does not exist unless DEV_MODE=1', async () => {
    const { id } = await started();
    const res = await devAnswerRoute(jsonRequest('/x'), ctx(id));
    expect(res.status).toBe(404);
  });

  it('returns a sample answer for the current question when enabled', async () => {
    process.env.DEV_MODE = '1';
    const { id, first } = await started();
    const res = await devAnswerRoute(jsonRequest('/x'), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.answer.split(' ').length).toBeGreaterThan(30);
    expect(body.questionIdx).toBe(first.question.idx);
  });

  it('rejects unknown sessions and sessions without a question', async () => {
    process.env.DEV_MODE = '1';
    expect(
      (await devAnswerRoute(jsonRequest('/x'), ctx('00000000-0000-4000-8000-000000000000'))).status,
    ).toBe(404);
    const job = await t.repos.jobs.bySlug('data-analyst');
    const session = await createSession(t.container, { jobId: job!.id, mode: 'text' });
    expect((await devAnswerRoute(jsonRequest('/x'), ctx(session.id))).status).toBe(409);
  });
});
