'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { RecorderState } from '@/components/interview/use-recorder';
import type { VoicePhase } from '@/lib/voice/state-machine';

/** The video-call look: interviewer tile, candidate self-view, subtitles and call controls. */
export function VideoStage({
  question,
  phase,
  stream,
  hasCamera,
  recorderState,
  onToggleCamera,
  onEnd,
}: {
  question: string;
  phase: VoicePhase | null;
  stream: MediaStream | null;
  hasCamera: boolean;
  recorderState: RecorderState;
  onToggleCamera: (enabled: boolean) => void;
  onEnd: () => void;
}) {
  const [cameraOn, setCameraOn] = useState(true);
  const speaking = phase === 'speaking';

  return (
    <section
      aria-label="Video call"
      className="relative overflow-hidden rounded-2xl border border-border bg-slate-900 text-white shadow-sm"
      data-testid="video-stage"
    >
      <div className="grid min-h-72 place-items-center p-8">
        <div className="flex flex-col items-center gap-3">
          <div
            className={`relative grid h-24 w-24 place-items-center rounded-full bg-primary text-2xl font-semibold ${speaking ? 'pulse-ring' : ''}`}
            aria-hidden="true"
          >
            AI
          </div>
          <p className="text-sm text-slate-300">
            AI Interviewer ·{' '}
            {phase === 'speaking'
              ? 'speaking'
              : phase === 'listening'
                ? 'listening'
                : phase === 'thinking'
                  ? 'thinking'
                  : 'ready'}
          </p>
        </div>
      </div>

      {/* Candidate self-view, picture in picture. */}
      <div className="absolute right-3 top-3 h-24 w-40 overflow-hidden rounded-xl border border-white/20 bg-slate-700">
        {hasCamera && cameraOn ? (
          <video
            ref={(el) => {
              if (el && el.srcObject !== stream) el.srcObject = stream;
            }}
            autoPlay
            muted
            playsInline
            className="h-full w-full -scale-x-100 object-cover"
            aria-label="Your camera"
            data-testid="self-view"
          />
        ) : (
          <div
            className="grid h-full w-full place-items-center text-lg font-semibold"
            data-testid="self-initials"
          >
            You
          </div>
        )}
      </div>

      {recorderState === 'recording' && (
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-xs">
          <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" /> Recording
        </span>
      )}

      {/* Subtitles. */}
      <p
        className="mx-auto mb-16 max-w-2xl rounded-lg bg-black/60 px-4 py-2 text-center text-base leading-relaxed"
        data-testid="subtitles"
        aria-live="polite"
      >
        {question}
      </p>

      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-3">
        {hasCamera && (
          <Button
            variant="outline"
            size="sm"
            className="border-white/30 bg-white/10 text-white hover:bg-white/20"
            aria-pressed={!cameraOn}
            onClick={() => {
              setCameraOn((v) => {
                onToggleCamera(!v);
                return !v;
              });
            }}
          >
            {cameraOn ? 'Turn camera off' : 'Turn camera on'}
          </Button>
        )}
        <Button variant="danger" size="sm" onClick={onEnd}>
          End call
        </Button>
      </div>
    </section>
  );
}
