import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createSessionRoute } from '@/app/api/sessions/route';
import { GET as getSessionRoute } from '@/app/api/sessions/[id]/route';
import { POST as startRoute } from '@/app/api/sessions/[id]/start/route';
import { POST as turnRoute } from '@/app/api/sessions/[id]/turn/route';
import { POST as evaluateRoute } from '@/app/api/sessions/[id]/evaluate/route';
import { LONG_ANSWER, createTestContainer, ctx, jsonRequest } from './helpers';

const t = createTestContainer();
afterAll(() => t.close());
beforeEach(() => t.reset());

async function newSession() {
  const job = await t.repos.jobs.bySlug('frontend-engineer');
  const res = await createSessionRoute(
    jsonRequest('/api/sessions', { jobId: job!.id, mode: 'text' }),
  );
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

describe('session API routes', () => {
  it('runs a whole interview through the HTTP handlers', async () => {
    const id = await newSession();
    const start = await startRoute(jsonRequest(`/api/sessions/${id}/start`), ctx(id));
    expect(start.status).toBe(200);
    let body = await start.json();
    expect(body.question.role).toBe('interviewer');

    let guard = 0;
    while (!body.done && guard++ < 15) {
      const res = await turnRoute(
        jsonRequest(`/api/sessions/${id}/turn`, { transcript: LONG_ANSWER }),
        ctx(id),
      );
      expect(res.status).toBe(200);
      body = await res.json();
    }
    expect(body.done).toBe(true);

    const ev = await evaluateRoute(jsonRequest(`/api/sessions/${id}/evaluate`), ctx(id));
    expect(ev.status).toBe(200);
    expect(typeof (await ev.json()).overall_score).toBe('number');

    const view = await (await getSessionRoute(new Request('http://localhost/x'), ctx(id))).json();
    expect(view.session.status).toBe('completed');
    expect(view.evaluation).not.toBeNull();
    expect(view.turns.length).toBeGreaterThan(12);
  });

  it('validates input and maps errors to JSON', async () => {
    const bad = await createSessionRoute(jsonRequest('/api/sessions', { jobId: 'not-a-uuid' }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('invalid_request');

    const missing = await getSessionRoute(
      new Request('http://localhost/x'),
      ctx('00000000-0000-4000-8000-000000000000'),
    );
    expect(missing.status).toBe(404);

    const notUuid = await getSessionRoute(new Request('http://localhost/x'), ctx('abc'));
    expect(notUuid.status).toBe(404);

    const id = await newSession();
    await startRoute(jsonRequest(`/api/sessions/${id}/start`), ctx(id));
    const empty = await turnRoute(
      jsonRequest(`/api/sessions/${id}/turn`, { transcript: '' }),
      ctx(id),
    );
    expect(empty.status).toBe(400);
    const tooLong = await turnRoute(
      jsonRequest(`/api/sessions/${id}/turn`, { transcript: 'a'.repeat(9000) }),
      ctx(id),
    );
    expect(tooLong.status).toBe(400);
  });

  it('returns 409 when answering twice in a row', async () => {
    const id = await newSession();
    await startRoute(jsonRequest(`/api/sessions/${id}/start`), ctx(id));
    await turnRoute(jsonRequest(`/api/sessions/${id}/turn`, { transcript: LONG_ANSWER }), ctx(id));
    // The interviewer has asked a new question, so this is valid; finish then answer again.
    let done = false;
    let guard = 0;
    while (!done && guard++ < 15) {
      const r = await (
        await turnRoute(
          jsonRequest(`/api/sessions/${id}/turn`, { transcript: LONG_ANSWER }),
          ctx(id),
        )
      ).json();
      done = r.done;
    }
    const after = await turnRoute(
      jsonRequest(`/api/sessions/${id}/turn`, { transcript: 'one more' }),
      ctx(id),
    );
    expect(after.status).toBe(409);
    expect((await after.json()).error.code).toBe('session_not_active');
  });
});
