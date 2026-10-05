import { OpenRouterClient } from '@/lib/adapters/openrouter';
import { FakeLlm } from '@/lib/adapters/fake-llm';
import {
  ElevenLabsAgentSessions,
  ElevenLabsSpeechTokens,
  ElevenLabsSynthesizer,
} from '@/lib/adapters/elevenlabs';
import {
  FakeAgentSessions,
  FakeBlobStore,
  FakeSpeechSynthesizer,
  FakeSpeechTokens,
} from '@/lib/adapters/fakes';
import { VercelBlobStore } from '@/lib/adapters/vercel-blob';
import { getDb } from '@/lib/db/client';
import { createRepos, type Repos } from '@/lib/db/repos';
import type {
  AgentSessionProvider,
  BlobStore,
  Clock,
  LlmClient,
  SpeechSynthesizer,
  SpeechTokenProvider,
} from '@/lib/ports';
import { systemClock } from '@/lib/ports';

export type Container = {
  repos: Repos;
  llm: LlmClient;
  speechTokens: SpeechTokenProvider;
  agent: AgentSessionProvider;
  synthesizer: SpeechSynthesizer;
  blob: BlobStore;
  clock: Clock;
};

let overridden: Container | undefined;
let live: Container | undefined;

/** Tests and the e2e server can replace the whole container. */
export function setContainer(container: Container | undefined) {
  overridden = container;
}

/**
 * Wires the real adapters. USE_FAKES=1 swaps every vendor for a deterministic fake
 * (used by CI and end-to-end tests); the database is always real.
 */
export function getContainer(): Container {
  if (overridden) return overridden;
  if (live) return live;
  const repos = createRepos(getDb());
  if (process.env.USE_FAKES === '1' || process.env.USE_FAKES === 'true') {
    live = {
      repos,
      llm: new FakeLlm(),
      speechTokens: new FakeSpeechTokens(),
      agent: new FakeAgentSessions(),
      synthesizer: new FakeSpeechSynthesizer(),
      blob: new FakeBlobStore(),
      clock: systemClock,
    };
    return live;
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  if (!elevenKey || !voiceId)
    throw new Error('ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set');
  live = {
    repos,
    llm: new OpenRouterClient({ apiKey }),
    speechTokens: new ElevenLabsSpeechTokens({ apiKey: elevenKey }),
    agent: new ElevenLabsAgentSessions({
      apiKey: elevenKey,
      agentId: process.env.ELEVENLABS_AGENT_ID ?? '',
    }),
    synthesizer: new ElevenLabsSynthesizer({ apiKey: elevenKey, voiceId }),
    blob: blobToken ? new VercelBlobStore(blobToken) : new FakeBlobStore(),
    clock: systemClock,
  };
  return live;
}
