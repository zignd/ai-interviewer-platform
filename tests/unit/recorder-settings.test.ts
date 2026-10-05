import { describe, expect, it } from 'vitest';
import {
  AUDIO_BITS_PER_SECOND,
  VIDEO_BITS_PER_SECOND,
  chooseRecorder,
  pickMimeType,
  recordingPath,
  recordingVideoConstraints,
} from '@/lib/recorder/settings';

const supports =
  (...types: string[]) =>
  (t: string) =>
    types.includes(t);

describe('recorder settings', () => {
  it('prefers vp9, then vp8, then webm, then mp4 for video', () => {
    expect(
      pickMimeType('video', supports('video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus')),
    ).toBe('video/webm;codecs=vp9,opus');
    expect(pickMimeType('video', supports('video/webm;codecs=vp8,opus'))).toBe(
      'video/webm;codecs=vp8,opus',
    );
    expect(pickMimeType('video', supports('video/webm'))).toBe('video/webm');
    expect(pickMimeType('video', supports('video/mp4'))).toBe('video/mp4');
    expect(pickMimeType('video', supports())).toBeUndefined();
  });

  it('uses the low bitrates, and mp4 extension on Safari', () => {
    const v = chooseRecorder('video', supports('video/mp4'));
    expect(v.options.videoBitsPerSecond).toBe(VIDEO_BITS_PER_SECOND);
    expect(v.options.audioBitsPerSecond).toBe(AUDIO_BITS_PER_SECOND);
    expect(v.extension).toBe('mp4');
  });

  it('audio-only settings have no video bitrate', () => {
    const a = chooseRecorder('audio', supports('audio/webm;codecs=opus'));
    expect(a.options.videoBitsPerSecond).toBeUndefined();
    expect(a.options.audioBitsPerSecond).toBe(32_000);
    expect(a.extension).toBe('webm');
  });

  it('limits the recorded camera clone to 640x360 at 15 fps', () => {
    expect(recordingVideoConstraints).toEqual({
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 15 },
    });
  });

  it('builds a per-session path', () => {
    expect(recordingPath('s1', 'video', 'webm', 'abc')).toBe('recordings/s1/video-abc.webm');
  });
});
