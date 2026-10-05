import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as speechTokenRoute } from '@/app/api/sessions/[id]/speech-token/route';
import { GET as ttsRoute } from '@/app/api/sessions/[id]/tts/route';
import { createSession, startInterview, submitTurn } from '@/lib/engine/service';
import { FakeSpeechSynthesizer } from '@/lib/adapters/fakes';
import { LONG_ANSWER, createTestContainer, ctx, jsonRequest } from './helpers';

const t = createTestContainer();
afterAll(() => t.close());
beforeEach(() => t.reset());

async function startedSession(slug = 'frontend-engineer') {
  const job = await t.repos.jobs.bySlug(slug);
  const session = await createSession(t.container, { jobId: job!.id, mode: 'voice' });
  const first = await startInterview(t.container, session.id);
  return { id: session.id, first };
}

const get = (url: string) => new Request(`http://localhost${url}`);

describe('POST /speech-token', () => {
  it('returns a token, model and only valid keyterms for an active session', async () => {
    const { id } = await startedSession();
    const res = await speechTokenRoute(jsonRequest(`/api/sessions/${id}/speech-token`), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.modelId).toBe('scribe_v2_realtime');
    expect(body.keyterms).toContain('React');
    expect(body.keyterms.every((k: string) => k.length <= 20)).toBe(true);
    expect(body.keyterms.length).toBeLessThanOrEqual(50);
  });

  it('refuses sessions that are not active and unknown sessions', async () => {
    const { id } = await startedSession();
    let r = await submitTurn(t.container, id, { transcript: LONG_ANSWER });
    while (!r.done) r = await submitTurn(t.container, id, { transcript: LONG_ANSWER });
    const finished = await speechTokenRoute(
      jsonRequest(`/api/sessions/${id}/speech-token`),
      ctx(id),
    );
    expect(finished.status).toBe(409);
    const missing = await speechTokenRoute(
      jsonRequest('/x'),
      ctx('00000000-0000-4000-8000-000000000000'),
    );
    expect(missing.status).toBe(404);
  });

  it('reports a 502 when the speech vendor fails, without leaking details', async () => {
    const broken = createTestContainer({
      speechTokens: {
        createScribeToken: async () => {
          throw new Error('secret vendor detail');
        },
      },
    });
    try {
      const job = await broken.repos.jobs.bySlug('data-analyst');
      const session = await createSession(broken.container, { jobId: job!.id, mode: 'voice' });
      const res = await speechTokenRoute(jsonRequest('/x'), ctx(session.id));
      expect(res.status).toBe(502);
      expect(JSON.stringify(await res.json())).not.toContain('secret vendor detail');
    } finally {
      await broken.close();
      createTestContainer();
    }
  });
});

describe('GET /tts', () => {
  it('streams audio for the saved interviewer question', async () => {
    const synth = new FakeSpeechSynthesizer();
    const local = createTestContainer({ synthesizer: synth });
    try {
      await local.reset();
      const job = await local.repos.jobs.bySlug('frontend-engineer');
      const session = await createSession(local.container, { jobId: job!.id, mode: 'voice' });
      const first = await startInterview(local.container, session.id);
      const res = await ttsRoute(get(`/api/sessions/${session.id}/tts?turn=0`), ctx(session.id));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('audio/wav');
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(44);
      expect(synth.spoken).toEqual([first.question.text]);
    } finally {
      await local.close();
      createTestContainer();
    }
  });

  it('only speaks interviewer turns and validates the turn parameter', async () => {
    const { id } = await startedSession();
    await submitTurn(t.container, id, { transcript: LONG_ANSWER });
    const candidate = await ttsRoute(get(`/api/sessions/${id}/tts?turn=1`), ctx(id));
    expect(candidate.status).toBe(404);
    const missingTurn = await ttsRoute(get(`/api/sessions/${id}/tts?turn=99`), ctx(id));
    expect(missingTurn.status).toBe(404);
    for (const bad of ['', '?turn=abc', '?turn=-1', '?turn=1.5']) {
      const res = await ttsRoute(get(`/api/sessions/${id}/tts${bad}`), ctx(id));
      expect(res.status).toBe(400);
    }
    const unknown = await ttsRoute(
      get('/api/sessions/00000000-0000-4000-8000-000000000000/tts?turn=0'),
      ctx('00000000-0000-4000-8000-000000000000'),
    );
    expect(unknown.status).toBe(404);
  });

  it('returns 502 if synthesis fails so the client can fall back to text', async () => {
    const local = createTestContainer({
      synthesizer: {
        synthesize: async () => {
          throw new Error('vendor down');
        },
      },
    });
    try {
      await local.reset();
      const job = await local.repos.jobs.bySlug('frontend-engineer');
      const session = await createSession(local.container, { jobId: job!.id, mode: 'voice' });
      await startInterview(local.container, session.id);
      const res = await ttsRoute(get(`/api/sessions/${session.id}/tts?turn=0`), ctx(session.id));
      expect(res.status).toBe(502);
    } finally {
      await local.close();
      createTestContainer();
    }
  });
});
