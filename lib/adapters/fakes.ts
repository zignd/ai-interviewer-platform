import type { BlobStore, SpeechSynthesizer, SpeechTokenProvider } from '@/lib/ports';

export class FakeSpeechTokens implements SpeechTokenProvider {
  async createScribeToken() {
    return {
      token: 'fake-scribe-token',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  }
}

/** A short, valid WAV of silence so <audio> elements can really "play" it in tests. */
export function silentWav(durationMs = 400, sampleRate = 8000): Uint8Array {
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataSize, true);
  return new Uint8Array(buffer);
}

export class FakeSpeechSynthesizer implements SpeechSynthesizer {
  readonly spoken: string[] = [];
  async synthesize(text: string) {
    this.spoken.push(text);
    const bytes = silentWav();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return { stream, contentType: 'audio/wav' };
  }
}

export class FakeBlobStore implements BlobStore {
  readonly deleted: string[] = [];
  failWith: Error | null = null;
  async delete(urls: string[]) {
    if (this.failWith) throw this.failWith;
    this.deleted.push(...urls);
  }
  readonly tokens: { pathname: string; maxBytes: number }[] = [];
  async createUploadToken(pathname: string, maxBytes: number) {
    if (this.failWith) throw this.failWith;
    this.tokens.push({ pathname, maxBytes });
    return `fake-upload-token:${pathname}:${maxBytes}`;
  }
}

export class FakeAgentSessions {
  async createSignedUrl() {
    return 'wss://fake.invalid/agent';
  }
}
