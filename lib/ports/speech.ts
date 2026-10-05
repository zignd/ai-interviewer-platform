export type ScribeToken = { token: string; expiresAt: string };

/** Mints short-lived credentials so the ElevenLabs API key never reaches the browser. */
export interface SpeechTokenProvider {
  createScribeToken(): Promise<ScribeToken>;
}

/** Text to speech. Returns an audio stream (MP3) for the given text. */
export interface SpeechSynthesizer {
  synthesize(text: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string }>;
}
