import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as llmRoute } from '@/app/api/agent-llm/chat/completions/route';
import { POST as agentSessionRoute } from '@/app/api/sessions/[id]/agent-session/route';
import { APOLOGY } from '@/lib/agent/handler';
import { createSession, startInterview } from '@/lib/engine/service';
import { LONG_ANSWER, createTestContainer, ctx, jsonRequest } from './helpers';

const t = createTestContainer();
const SECRET = 'test-agent-secret-0123456789';
beforeAll(() => {
  process.env.AGENT_LLM_SECRET = SECRET;
});
afterAll(async () => {
  delete process.env.AGENT_LLM_SECRET;
  await t.close();
});
beforeEach(() => t.reset());

function llmRequest(body: unknown, token: string | null = SECRET) {
  return new Request('http://localhost/api/agent-llm/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function started() {
  const job = await t.repos.jobs.bySlug('frontend-engineer');
  const session = await createSession(t.container, { jobId: job!.id, mode: 'voice' });
  const first = await startInterview(t.container, session.id);
  return { id: session.id, first };
}

const payload = (id: string, text: string) => ({
  model: 'interviewer-engine',
  stream: true,
  messages: [
    { role: 'system', content: 'ignored' },
    { role: 'assistant', content: 'previous question' },
    { role: 'user', content: text },
  ],
  elevenlabs_extra_body: { session_id: id },
});

function contentOf(sse: string) {
  return sse
    .split('\n\n')
    .filter((l) => l.startsWith('data: {'))
    .map((l) => JSON.parse(l.slice(6)).choices[0].delta.content ?? '')
    .join('');
}

describe('Custom LLM route for ElevenLabs Agents', () => {
  it('rejects requests without the shared secret', async () => {
    const { id } = await started();
    expect((await llmRoute(llmRequest(payload(id, 'hi'), null))).status).toBe(401);
    expect((await llmRoute(llmRequest(payload(id, 'hi'), 'wrong'))).status).toBe(401);
  });

  it('refuses everything when no secret is configured', async () => {
    const saved = process.env.AGENT_LLM_SECRET;
    delete process.env.AGENT_LLM_SECRET;
    try {
      const { id } = await started();
      expect((await llmRoute(llmRequest(payload(id, 'hi')))).status).toBe(401);
    } finally {
      process.env.AGENT_LLM_SECRET = saved;
    }
  });

  it('validates the request body', async () => {
    const res = await llmRoute(llmRequest({ messages: [{ role: 'user', content: 'x' }] }));
    expect(res.status).toBe(400);
  });

  it('runs the interview engine and streams the next question as SSE', async () => {
    const { id, first } = await started();
    const res = await llmRoute(llmRequest(payload(id, LONG_ANSWER)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await res.text();
    expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true);
    const spoken = contentOf(body);
    expect(spoken.length).toBeGreaterThan(10);
    expect(spoken).not.toBe(first.question.text);

    const turns = await t.repos.turns.list(id);
    expect(turns.map((x) => x.role)).toEqual(['interviewer', 'candidate', 'interviewer']);
    expect(turns[1].text).toBe(LONG_ANSWER);
    expect(turns[2].text).toBe(spoken);
    expect(await t.repos.decisions.list(id)).toHaveLength(2);
  });

  it('runs a whole interview through the route and ends it', async () => {
    const { id } = await started();
    let lastText = '';
    for (let i = 0; i < 14; i++) {
      const body = await (await llmRoute(llmRequest(payload(id, LONG_ANSWER)))).text();
      lastText = contentOf(body);
      const session = await t.repos.sessions.byId(id);
      if (session!.status === 'completed') break;
    }
    expect((await t.repos.sessions.byId(id))!.status).toBe('completed');
    expect(lastText).toContain('interview is complete');
    const turns = await t.repos.turns.list(id);
    const questions = turns.filter((x) => x.role === 'interviewer' && x.kind !== 'generated');
    expect(questions.length).toBeGreaterThanOrEqual(6);
    expect(questions.filter((x) => x.kind === 'follow_up').length).toBeGreaterThanOrEqual(2);
    // After the end, the agent gets a polite goodbye rather than an error.
    const after = contentOf(await (await llmRoute(llmRequest(payload(id, 'one more')))).text());
    expect(after).toContain('has ended');
  });

  it('answers with a spoken apology when nothing was said or the engine fails', async () => {
    const { id } = await started();
    expect(contentOf(await (await llmRoute(llmRequest(payload(id, '   ')))).text())).toBe(APOLOGY);
    const unknown = payload('00000000-0000-4000-8000-000000000000', 'hello there friend');
    expect(contentOf(await (await llmRoute(llmRequest(unknown))).text())).toBe(APOLOGY);
  });
});

describe('POST /agent-session', () => {
  it('starts the interview and returns the opening text and a signed URL', async () => {
    const job = await t.repos.jobs.bySlug('data-analyst');
    const session = await createSession(t.container, { jobId: job!.id, mode: 'voice' });
    const res = await agentSessionRoute(jsonRequest('/x'), ctx(session.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signedUrl).toMatch(/^wss:\/\//);
    expect(body.openingText).toContain('Hello, and thanks for making the time');
    // Calling again keeps the same opening question.
    const again = await (await agentSessionRoute(jsonRequest('/x'), ctx(session.id))).json();
    expect(again.openingText).toBe(body.openingText);
  });

  it('reports 502 when ElevenLabs cannot create a signed URL', async () => {
    const broken = createTestContainer({
      agent: {
        createSignedUrl: async () => {
          throw new Error('boom');
        },
      },
    });
    try {
      await broken.reset();
      const job = await broken.repos.jobs.bySlug('data-analyst');
      const session = await createSession(broken.container, { jobId: job!.id, mode: 'voice' });
      const res = await agentSessionRoute(jsonRequest('/x'), ctx(session.id));
      expect(res.status).toBe(502);
    } finally {
      await broken.close();
      createTestContainer();
    }
  });
});
