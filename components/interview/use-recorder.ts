'use client';

import { put } from '@vercel/blob/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client-api';
import {
  TIMESLICE_MS,
  chooseRecorder,
  recordingVideoConstraints,
  type RecorderChoice,
} from '@/lib/recorder/settings';

export type RecorderState = 'idle' | 'recording' | 'uploading' | 'saved' | 'unavailable';

type PrepareResult =
  | { action: 'upload'; recordingId: string; pathname: string; token: string }
  | { action: 'use_audio' }
  | { action: 'skip'; reason: string };

type Active = {
  recorder: MediaRecorder;
  chunks: Blob[];
  choice: RecorderChoice;
  done: Promise<Blob>;
};

function startRecorder(stream: MediaStream, choice: RecorderChoice): Active {
  const recorder = new MediaRecorder(stream, choice.options);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () =>
      resolve(new Blob(chunks, { type: recorder.mimeType || choice.mimeType }));
  });
  recorder.start(TIMESLICE_MS);
  return { recorder, chunks, choice, done };
}

/**
 * Camera self-view plus an optional, compressed session recording.
 * The recording is a clone of the camera track limited to 640x360 at 15 fps with low bitrates, with a parallel
 * audio-only recording as the fallback. Everything is uploaded once, at the end, and any failure just means
 * "no recording": it never interrupts the interview.
 */
export function useRecorder(sessionId: string) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasCamera, setHasCamera] = useState(false);
  const [state, setState] = useState<RecorderState>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef<{ video: Active | null; audio: Active | null }>({
    video: null,
    audio: null,
  });
  const clonedRef = useRef<MediaStreamTrack | null>(null);
  const stoppedRef = useRef(false);

  /** Opens the camera and microphone. Falls back to audio only, then to nothing. */
  const openMedia = useCallback(async () => {
    let media: MediaStream | null = null;
    try {
      media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        media = null;
      }
    }
    streamRef.current = media;
    setStream(media);
    setHasCamera(!!media && media.getVideoTracks().length > 0);
    return media;
  }, []);

  const startRecording = useCallback(async () => {
    const media = streamRef.current ?? (await openMedia());
    if (!media || typeof MediaRecorder === 'undefined' || media.getAudioTracks().length === 0) {
      setState('unavailable');
      return;
    }
    try {
      const isSupported = (t: string) => MediaRecorder.isTypeSupported(t);
      const audioTracks = media.getAudioTracks();
      activeRef.current.audio = startRecorder(
        new MediaStream(audioTracks),
        chooseRecorder('audio', isSupported),
      );
      const camera = media.getVideoTracks()[0];
      if (camera) {
        const clone = camera.clone();
        await clone.applyConstraints(recordingVideoConstraints).catch(() => undefined);
        clonedRef.current = clone;
        activeRef.current.video = startRecorder(
          new MediaStream([clone, ...audioTracks]),
          chooseRecorder('video', isSupported),
        );
      }
      setState('recording');
    } catch (err) {
      console.warn('recording could not start', err instanceof Error ? err.message : err);
      setState('unavailable');
    }
  }, [openMedia]);

  const upload = useCallback(
    async (blob: Blob, choice: RecorderChoice): Promise<'saved' | 'use_audio' | 'skipped'> => {
      const prep = await api<PrepareResult>('/api/recordings/prepare', {
        sessionId,
        kind: choice.kind,
        sizeBytes: blob.size,
        extension: choice.extension,
      });
      if (prep.action === 'use_audio') return 'use_audio';
      if (prep.action === 'skip') return 'skipped';
      try {
        const result = await put(prep.pathname, blob, {
          access: 'private',
          token: prep.token,
          contentType: blob.type || undefined,
        });
        await api('/api/recordings/complete', {
          recordingId: prep.recordingId,
          blobUrl: result.url,
          sizeBytes: blob.size,
        });
        return 'saved';
      } catch (err) {
        await api('/api/recordings/complete', {
          recordingId: prep.recordingId,
          failed: true,
        }).catch(() => undefined);
        throw err;
      }
    },
    [sessionId],
  );

  /** Stops recording and uploads the result in the background. Safe to call more than once. */
  const stopRecording = useCallback(async () => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    const { video, audio } = activeRef.current;
    if (!video && !audio) return;
    setState('uploading');
    try {
      for (const a of [video, audio]) if (a && a.recorder.state !== 'inactive') a.recorder.stop();
      const [videoBlob, audioBlob] = await Promise.all([video?.done, audio?.done]);
      clonedRef.current?.stop();
      let outcome: 'saved' | 'use_audio' | 'skipped' = 'use_audio';
      if (video && videoBlob && videoBlob.size > 0) {
        outcome = await upload(videoBlob, video.choice);
      }
      if (outcome === 'use_audio' && audio && audioBlob && audioBlob.size > 0) {
        outcome = await upload(audioBlob, audio.choice);
      }
      setState(outcome === 'saved' ? 'saved' : 'unavailable');
    } catch (err) {
      console.warn('recording upload failed', err instanceof Error ? err.message : err);
      setState('unavailable');
    }
  }, [upload]);

  const setCameraEnabled = useCallback((enabled: boolean) => {
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = enabled));
  }, []);

  // Release the camera when leaving the room.
  useEffect(
    () => () => {
      const video = activeRef.current.video;
      if (video && video.recorder.state === 'recording') video.recorder.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return { stream, hasCamera, state, openMedia, startRecording, stopRecording, setCameraEnabled };
}
