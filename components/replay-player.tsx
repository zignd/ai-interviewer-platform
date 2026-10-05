'use client';

import { useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { activeTurnIdx, type ReplayTurn } from '@/lib/analytics/metrics';

/** Plays the session recording and highlights the transcript turn being played. Click a turn to jump to it. */
export function ReplayPlayer({
  kind,
  url,
  turns,
}: {
  kind: 'video' | 'audio';
  url: string;
  turns: ReplayTurn[];
}) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [current, setCurrent] = useState(0);
  const [failed, setFailed] = useState(false);
  const active = activeTurnIdx(turns, current);

  const common = {
    ref: mediaRef,
    controls: true,
    preload: 'metadata' as const,
    src: url,
    onTimeUpdate: () => setCurrent(mediaRef.current?.currentTime ?? 0),
    onError: () => setFailed(true),
    className: 'w-full rounded-lg bg-black',
  };

  return (
    <Card className="p-5" data-testid="replay">
      <h2 className="mb-3 text-base font-semibold">Replay</h2>
      {failed ? (
        <p role="alert" className="text-sm text-warning">
          Recording unavailable. It may have been deleted to save storage.
        </p>
      ) : kind === 'video' ? (
        <video {...common} playsInline />
      ) : (
        <audio {...common} />
      )}
      <ol className="mt-4 flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
        {turns.map((t) => (
          <li key={t.idx}>
            <button
              type="button"
              onClick={() => {
                if (mediaRef.current) mediaRef.current.currentTime = t.offsetSec;
                void mediaRef.current?.play().catch(() => undefined);
              }}
              aria-current={active === t.idx}
              className={`w-full rounded-lg px-3 py-2 text-left hover:bg-accent ${active === t.idx ? 'bg-accent font-medium' : ''}`}
            >
              <span className="mr-2 text-xs text-muted">{formatTime(t.offsetSec)}</span>
              <span className="mr-2 font-medium">
                {t.role === 'interviewer' ? 'Interviewer' : 'You'}:
              </span>
              {t.text}
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function formatTime(sec: number) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
