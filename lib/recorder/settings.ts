/** Recording settings chosen once, in pure functions, so they are easy to test. */

export const VIDEO_BITS_PER_SECOND = 250_000;
export const AUDIO_BITS_PER_SECOND = 32_000;
/** Chunks are collected in memory every 10 s and uploaded once at the end. */
export const TIMESLICE_MS = 10_000;

/** Limits for the clone of the camera track that gets recorded. The self-view keeps full quality. */
export const recordingVideoConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 15 },
} as const;

const VIDEO_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
] as const;
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const;

export type RecorderKind = 'video' | 'audio';

export type RecorderChoice = {
  kind: RecorderKind;
  mimeType: string | undefined;
  options: { mimeType?: string; videoBitsPerSecond?: number; audioBitsPerSecond: number };
  /** File extension for the upload path. */
  extension: 'webm' | 'mp4';
};

/** Picks the best supported mime type: vp9, then vp8, then plain webm, then mp4 (Safari). */
export function pickMimeType(
  kind: RecorderKind,
  isSupported: (type: string) => boolean,
): string | undefined {
  const candidates = kind === 'video' ? VIDEO_TYPES : AUDIO_TYPES;
  return candidates.find((t) => isSupported(t));
}

export function chooseRecorder(
  kind: RecorderKind,
  isSupported: (type: string) => boolean,
): RecorderChoice {
  const mimeType = pickMimeType(kind, isSupported);
  return {
    kind,
    mimeType,
    options: {
      ...(mimeType ? { mimeType } : {}),
      ...(kind === 'video' ? { videoBitsPerSecond: VIDEO_BITS_PER_SECOND } : {}),
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    },
    extension: mimeType?.includes('mp4') ? 'mp4' : 'webm',
  };
}

/** Path inside the blob store. Includes a random suffix so it can't be guessed. */
export function recordingPath(
  sessionId: string,
  kind: RecorderKind,
  extension: string,
  nonce: string,
): string {
  return `recordings/${sessionId}/${kind}-${nonce}.${extension}`;
}
