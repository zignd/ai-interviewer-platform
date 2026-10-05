/**
 * Creates or updates the ElevenLabs agent that uses our interview engine as its Custom LLM.
 *
 *   npx tsx scripts/agent.ts https://your-public-url.example
 *
 * - stores AGENT_LLM_SECRET as a workspace secret (the agent sends it as a Bearer token)
 * - creates the agent, or updates the one in ELEVENLABS_AGENT_ID, and writes the id back into .env
 * Safe to run repeatedly, for example after the public URL changes.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const API = 'https://api.elevenlabs.io/v1';
const SECRET_NAME = 'interviewer_llm_secret';

async function eleven(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep the raw text
  }
  if (!res.ok)
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 600)}`);
  return data as Record<string, unknown> & {
    secrets?: { name: string; secret_id: string }[];
    secret_id?: string;
    agent_id?: string;
  };
}

async function ensureSecret(): Promise<string> {
  const value = process.env.AGENT_LLM_SECRET;
  if (!value) throw new Error('AGENT_LLM_SECRET is not set');
  const list = await eleven('/convai/secrets');
  const existing = (list.secrets ?? []).find((s) => s.name === SECRET_NAME);
  if (existing)
    await eleven(`/convai/secrets/${existing.secret_id}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
  const created = await eleven('/convai/secrets', {
    method: 'POST',
    body: JSON.stringify({ type: 'new', name: SECRET_NAME, value }),
  });
  return String(created.secret_id);
}

export function agentConfig(baseUrl: string, secretId: string, voiceId: string) {
  return {
    name: 'AI Interviewer',
    conversation_config: {
      agent: {
        first_message: 'Hello, and thanks for making the time.',
        language: 'en',
        prompt: {
          prompt:
            'You are a professional job interviewer. The interview engine on our server decides every question; you only speak what it returns.',
          llm: 'custom-llm',
          custom_llm: {
            url: `${baseUrl.replace(/\/$/, '')}/api/agent-llm`,
            model_id: 'interviewer-engine',
            api_key: { secret_id: secretId },
            request_headers: { 'ngrok-skip-browser-warning': 'true' },
          },
          temperature: 0,
        },
      },
      tts: { voice_id: voiceId, model_id: 'eleven_flash_v2' },
      turn: {
        turn_timeout: 10,
        turn_eagerness: 'patient',
        soft_timeout_config: {
          timeout_seconds: 6,
          message: 'One moment while I think about that.',
        },
      },
      conversation: { max_duration_seconds: 1500 },
    },
    platform_settings: {
      auth: { enable_auth: true },
      overrides: {
        conversation_config_override: { agent: { first_message: true } },
        custom_llm_extra_body: true,
      },
    },
  };
}

function writeAgentId(id: string) {
  if (!existsSync('.env')) return;
  const env = readFileSync('.env', 'utf8');
  const next = /^ELEVENLABS_AGENT_ID=.*$/m.test(env)
    ? env.replace(/^ELEVENLABS_AGENT_ID=.*$/m, `ELEVENLABS_AGENT_ID=${id}`)
    : `${env.trimEnd()}\nELEVENLABS_AGENT_ID=${id}\n`;
  writeFileSync('.env', next);
}

/** Points the agent at `baseUrl` (creating the agent if needed) and returns its id. */
export async function syncAgent(baseUrl: string): Promise<string> {
  if (!/^https:\/\//.test(baseUrl)) throw new Error('The public URL must start with https://');
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!process.env.ELEVENLABS_API_KEY || !voiceId)
    throw new Error('ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are required');

  const secretId = await ensureSecret();
  const body = agentConfig(baseUrl, secretId, voiceId);
  const existing = process.env.ELEVENLABS_AGENT_ID;
  if (existing) {
    await eleven(`/convai/agents/${existing}`, { method: 'PATCH', body: JSON.stringify(body) });
    return existing;
  }
  const created = await eleven('/convai/agents/create', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const id = String(created.agent_id);
  writeAgentId(id);
  process.env.ELEVENLABS_AGENT_ID = id;
  return id;
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) throw new Error('Usage: npx tsx scripts/agent.ts https://<public url>');
  const id = await syncAgent(baseUrl);
  console.log(`Agent ${id} now uses ${baseUrl}`);
}

if (process.argv[1]?.endsWith('agent.ts')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
