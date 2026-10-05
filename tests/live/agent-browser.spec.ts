import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { syncAgent } from '../../scripts/agent';

/**
 * Live test of Option B (ElevenLabs Agents + our Custom LLM), not part of CI.
 * ngrok exposes the local production build so ElevenLabs can call our Custom LLM route.
 * Speech is synthesized and fed to the agent through a simulated microphone.
 */

async function speak(text: string): Promise<Int16Array> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/stream?output_format=pcm_16000`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
    },
  );
  if (!res.ok) throw new Error(`TTS failed ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}

function silence(seconds: number) {
  return new Int16Array(Math.floor(16000 * seconds));
}

function concat(...parts: Int16Array[]) {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const toBase64 = (pcm: Int16Array) =>
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64');

async function openTunnel(port: number): Promise<{ url: string; stop: () => void }> {
  const child: ChildProcess = spawn('ngrok', ['http', String(port), '--log=stdout'], {
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch('http://127.0.0.1:4040/api/tunnels');
      const data = (await res.json()) as { tunnels: { public_url: string }[] };
      const url = data.tunnels.find((t) => t.public_url.startsWith('https://'))?.public_url;
      if (url) return { url, stop: () => child.kill() };
    } catch {
      // ngrok is still starting
    }
  }
  child.kill();
  throw new Error('ngrok did not start');
}

test('agent transport: spoken answers through ElevenLabs Agents with our engine as the brain', async ({
  page,
}) => {
  test.skip(
    !process.env.ELEVENLABS_API_KEY ||
      !process.env.OPENROUTER_API_KEY ||
      !process.env.AGENT_LLM_SECRET,
    'needs real API keys',
  );
  const tunnel = await openTunnel(3200);
  try {
    const agentId = await syncAgent(tunnel.url);
    console.log(`agent ${agentId} -> ${tunnel.url}`);

    const clips = [
      concat(
        await speak(
          'In my last job I rebuilt our dashboard state management. We moved server data into React Query and kept form state local, which made the code far easier to follow.',
        ),
      ),
      // A long pause in the middle of an answer: the agent should not treat it as the end of the turn.
      concat(
        await speak('I measured it with the React Profiler.'),
        silence(3),
        await speak(
          'Commits on the list view dropped from about forty to twelve per interaction, and I added a regression test.',
        ),
      ),
      concat(
        await speak(
          'The hardest part was convincing the team to migrate gradually, so I wrote a short guide and paired with two colleagues on the first screens.',
        ),
      ),
    ];

    await page.addInitScript((b64: string[]) => {
      const ctx = new AudioContext({ sampleRate: 16000 });
      const destination = ctx.createMediaStreamDestination();
      const decode = (s: string) => {
        const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
        return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
      };
      (window as unknown as { __playAnswer: (i: number) => number }).__playAnswer = (i: number) => {
        void ctx.resume();
        const pcm = decode(b64[i]);
        const buffer = ctx.createBuffer(1, pcm.length, 16000);
        const ch = buffer.getChannelData(0);
        for (let k = 0; k < pcm.length; k++) ch[k] = pcm[k] / 32768;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(destination);
        src.start();
        return pcm.length / 16000;
      };
      navigator.mediaDevices.getUserMedia = async () => destination.stream;
    }, clips.map(toBase64));

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on(
      'console',
      (m) =>
        ['error', 'warning'].includes(m.type()) &&
        console.log(`[browser ${m.type()}]`, m.text().slice(0, 200)),
    );
    page.on('websocket', (ws) =>
      ws.on(
        'framereceived',
        (f) =>
          typeof f.payload === 'string' &&
          /user_transcript|agent_response|error|conversation_initiation/.test(f.payload) &&
          console.log('[ws]', f.payload.slice(0, 220)),
      ),
    );

    await page.goto('/');
    await page.getByRole('button', { name: 'Start interview for Frontend Engineer' }).click();
    await page.waitForURL(/\/interview\//);
    await page.goto(`${page.url().split('?')[0]}?transport=agent`);
    await page.getByTestId('begin-voice').click();

    const phase = page.getByTestId('voice-phase');
    const log: string[] = [];
    for (let round = 0; round < clips.length; round++) {
      await expect(phase).toHaveAttribute('data-phase', 'listening', { timeout: 60_000 });
      await page.waitForTimeout(800);
      const seconds = await page.evaluate(
        (i) => (window as unknown as { __playAnswer: (n: number) => number }).__playAnswer(i),
        round,
      );
      const spokeAt = Date.now();
      await expect(phase).toHaveAttribute('data-phase', 'speaking', { timeout: 90_000 });
      const speakingAt = Date.now();
      log.push(
        `round ${round + 1}: answer ${seconds.toFixed(1)}s, interviewer started speaking ${((speakingAt - spokeAt) / 1000 - seconds).toFixed(1)}s after the last word`,
      );
      await expect(phase).toHaveAttribute('data-phase', 'listening', { timeout: 90_000 });
      await page.waitForTimeout(500);
    }
    console.log(log.join('\n'));

    // What the engine recorded.
    const sessionId = page.url().match(/interview\/([0-9a-f-]{36})/)![1];
    const view = await (await page.request.get(`/api/sessions/${sessionId}`)).json();
    const candidate = view.turns.filter((t: { role: string }) => t.role === 'candidate');
    console.log(`candidate turns recorded: ${candidate.length} (answers given: ${clips.length})`);
    candidate.forEach((t: { text: string }, i: number) =>
      console.log(`  answer ${i + 1}: ${t.text.slice(0, 120)}`),
    );
    console.log(
      `interviewer turns: ${view.turns.filter((t: { role: string }) => t.role === 'interviewer').length}, decisions: ${view.decisions.length}`,
    );
    expect(errors).toEqual([]);
    expect(candidate.length).toBeGreaterThanOrEqual(clips.length);
  } finally {
    // What ElevenLabs actually sent to our Custom LLM route, from ngrok's request inspector.
    try {
      const res = await fetch('http://127.0.0.1:4040/api/requests/http?limit=30');
      const data = (await res.json()) as {
        requests: { request: { method: string; uri: string }; response: { status_code: number } }[];
      };
      console.log('requests seen by the tunnel:');
      for (const r of data.requests)
        console.log(`  ${r.request.method} ${r.request.uri} -> ${r.response?.status_code}`);
    } catch {
      // inspector not available
    }
    tunnel.stop();
  }
});
