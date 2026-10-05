/**
 * Live speech-to-text for one answer.
 * The real implementation streams the microphone to ElevenLabs Scribe v2 Realtime.
 * A fake (used when the server hands out a "fake-" token, e.g. in end-to-end tests) replays a script.
 */

export type TranscriberEvents = {
  onPartial: (text: string) => void;
  onCommitted: (text: string) => void;
  onError: (error: TranscriberError) => void;
};

export type TranscriberErrorKind =
  'permission_denied' | 'no_microphone' | 'quota' | 'connection' | 'unknown';

export class TranscriberError extends Error {
  constructor(
    public readonly kind: TranscriberErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface Transcriber {
  /** Opens the microphone and the connection. Rejects with a TranscriberError. */
  start(): Promise<void>;
  /** Asks the service to finalise what it has heard so far. */
  commit(): void;
  /** Releases the microphone and closes the connection. Safe to call twice. */
  stop(): void;
}

export type TranscriberConfig = { token: string; keyterms: string[]; modelId: string };

/** Maps browser media errors to something we can explain to the candidate. */
export function classifyMediaError(err: unknown): TranscriberError {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new TranscriberError('permission_denied', 'Microphone access was blocked.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new TranscriberError('no_microphone', 'No microphone was found.');
  }
  return new TranscriberError(
    'unknown',
    err instanceof Error ? err.message : 'The microphone could not be started.',
  );
}

export const FAKE_TOKEN_PREFIX = 'fake-';

let micChecked = false;

/** Asks for the microphone once per page so a denied permission gives a clear error before we connect. */
async function ensureMicrophone() {
  if (micChecked) return;
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
    micChecked = true;
  } catch (err) {
    throw classifyMediaError(err);
  }
}

export async function createTranscriber(
  config: TranscriberConfig,
  events: TranscriberEvents,
): Promise<Transcriber> {
  if (config.token.startsWith(FAKE_TOKEN_PREFIX)) return new FakeTranscriber(events);
  const { Scribe, RealtimeEvents, CommitStrategy } = await import('@elevenlabs/client');
  return new ScribeTranscriber(config, events, { Scribe, RealtimeEvents, CommitStrategy });
}

type ScribeModule = Pick<
  typeof import('@elevenlabs/client'),
  'Scribe' | 'RealtimeEvents' | 'CommitStrategy'
>;

class ScribeTranscriber implements Transcriber {
  private connection: ReturnType<ScribeModule['Scribe']['connect']> | null = null;
  constructor(
    private readonly config: TranscriberConfig,
    private readonly events: TranscriberEvents,
    private readonly lib: ScribeModule,
  ) {}

  async start() {
    await ensureMicrophone();
    const { Scribe, RealtimeEvents, CommitStrategy } = this.lib;
    const connection = Scribe.connect({
      token: this.config.token,
      modelId: this.config.modelId,
      commitStrategy: CommitStrategy.MANUAL,
      keyterms: this.config.keyterms,
      microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.connection = connection;
    connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (d) => this.events.onPartial(d.text ?? ''));
    connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (d) =>
      this.events.onCommitted(d.text ?? ''),
    );
    const fail = (kind: TranscriberErrorKind, message: string) =>
      this.events.onError(new TranscriberError(kind, message));
    connection.on(RealtimeEvents.QUOTA_EXCEEDED, () =>
      fail('quota', 'Speech recognition quota reached.'),
    );
    connection.on(RealtimeEvents.RATE_LIMITED, () => fail('quota', 'Speech recognition is busy.'));
    connection.on(RealtimeEvents.AUTH_ERROR, () =>
      fail('connection', 'Speech recognition could not authenticate.'),
    );
    connection.on(RealtimeEvents.ERROR, () =>
      fail('connection', 'Speech recognition had a problem.'),
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new TranscriberError('connection', 'Speech recognition did not connect in time.')),
        8000,
      );
      connection.on(RealtimeEvents.SESSION_STARTED, () => {
        clearTimeout(timer);
        resolve();
      });
      connection.on(RealtimeEvents.AUTH_ERROR, () => {
        clearTimeout(timer);
        reject(new TranscriberError('connection', 'Speech recognition could not authenticate.'));
      });
    });
  }

  commit() {
    try {
      this.connection?.commit();
    } catch {
      // Closing the connection right after is fine; we fall back to the last partial text.
    }
  }

  stop() {
    try {
      this.connection?.close();
    } catch {
      // Already closed.
    }
    this.connection = null;
  }
}

declare global {
  interface Window {
    /** Test hook: answers the fake transcriber will "speak", in order. */
    __fakeSpeech?: string[];
    /** Test hook: make the fake transcriber really ask for the microphone, to exercise permission handling. */
    __fakeMicProbe?: boolean;
  }
}

const DEFAULT_FAKE_ANSWER =
  'On my last project we had a checkout page that became slow because we fetched too much data on every render. ' +
  'I profiled it, moved the state down and cached the API response, which cut the load time from four seconds to one.';

/**
 * Replays scripted answers word by word. It does not open the microphone unless a test sets
 * `window.__fakeMicProbe`, because headless browsers on some machines cannot capture audio.
 */
export class FakeTranscriber implements Transcriber {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private spoken = '';
  private stopped = false;

  constructor(private readonly events: TranscriberEvents) {}

  async start() {
    if (typeof window !== 'undefined' && window.__fakeMicProbe) await ensureMicrophone();
    const text =
      (typeof window !== 'undefined' && window.__fakeSpeech?.shift()) || DEFAULT_FAKE_ANSWER;
    const words = text.split(' ');
    words.forEach((_, i) => {
      this.timers.push(
        setTimeout(
          () => {
            if (this.stopped) return;
            this.spoken = words.slice(0, i + 1).join(' ');
            this.events.onPartial(this.spoken);
          },
          20 * (i + 1),
        ),
      );
    });
  }

  commit() {
    if (this.stopped) return;
    const text = this.spoken;
    this.spoken = '';
    this.timers.forEach(clearTimeout);
    this.timers = [];
    setTimeout(() => this.events.onCommitted(text), 10);
  }

  stop() {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
