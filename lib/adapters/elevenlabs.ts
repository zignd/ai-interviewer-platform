import type {
  AgentSessionProvider,
  ScribeToken,
  SpeechSynthesizer,
  SpeechTokenProvider,
} from '@/lib/ports';

const API = 'https://api.elevenlabs.io/v1';

/** Flash is ElevenLabs' low-latency text-to-speech model. */
export const TTS_MODEL = 'eleven_flash_v2_5';

type Options = { apiKey: string; fetchImpl?: typeof fetch };

/** Mints a single-use token (valid 15 minutes) so the API key never reaches the browser. */
export class ElevenLabsSpeechTokens implements SpeechTokenProvider {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: Options) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createScribeToken(): Promise<ScribeToken> {
    const res = await this.fetchImpl(`${API}/single-use-token/realtime_scribe`, {
      method: 'POST',
      headers: { 'xi-api-key': this.options.apiKey },
    });
    if (!res.ok) throw new Error(`ElevenLabs token request failed (${res.status})`);
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error('ElevenLabs returned no token');
    return { token: data.token, expiresAt: new Date(Date.now() + 14 * 60_000).toISOString() };
  }
}

export class ElevenLabsSynthesizer implements SpeechSynthesizer {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: Options & { voiceId: string }) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async synthesize(text: string) {
    const res = await this.fetchImpl(
      `${API}/text-to-speech/${encodeURIComponent(this.options.voiceId)}/stream?output_format=mp3_44100_64&optimize_streaming_latency=3`,
      {
        method: 'POST',
        headers: { 'xi-api-key': this.options.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: TTS_MODEL }),
      },
    );
    if (!res.ok || !res.body) throw new Error(`ElevenLabs speech request failed (${res.status})`);
    return { stream: res.body, contentType: 'audio/mpeg' };
  }
}

export class ElevenLabsAgentSessions implements AgentSessionProvider {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: Options & { agentId: string }) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createSignedUrl(): Promise<string> {
    const res = await this.fetchImpl(
      `${API}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(this.options.agentId)}`,
      { headers: { 'xi-api-key': this.options.apiKey } },
    );
    if (!res.ok) throw new Error(`ElevenLabs signed URL request failed (${res.status})`);
    const data = (await res.json()) as { signed_url?: string };
    if (!data.signed_url) throw new Error('ElevenLabs returned no signed URL');
    return data.signed_url;
  }
}
