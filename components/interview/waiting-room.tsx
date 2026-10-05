'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/client-api';
import type { QueueState } from '@/lib/queue/service';

/** Shown while all interview slots are taken, and when a slot is reserved and needs confirming. */
export function WaitingRoom({
  sessionId,
  initial,
  onReady,
}: {
  sessionId: string;
  initial: QueueState | null;
  onReady: () => void;
}) {
  const [state, setState] = useState<QueueState | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const readyRef = useRef(false);
  const router = useRouter();

  // Polling doubles as the heartbeat that keeps our place in line.
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const next = await api<QueueState>(`/api/sessions/${sessionId}/queue`);
        if (stopped) return;
        setState(next);
        if (next.ready && !readyRef.current) {
          readyRef.current = true;
          onReady();
        }
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : 'Could not check the queue');
      }
    }
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [sessionId, onReady]);

  async function confirm() {
    setBusy(true);
    try {
      const next = await api<QueueState>(`/api/sessions/${sessionId}/ready`);
      setState(next);
      if (next.ready && !readyRef.current) {
        readyRef.current = true;
        onReady();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm');
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      await api(`/api/sessions/${sessionId}/leave`);
    } finally {
      router.push('/');
    }
  }

  if (state?.status === 'abandoned' || state?.status === 'completed') {
    return (
      <Card className="mx-auto max-w-lg p-8 text-center" role="alert">
        <h2 className="text-lg font-semibold">Your place in line expired</h2>
        <p className="mt-2 text-sm text-muted">
          We stopped holding your spot because we lost contact with this page. You can start again.
        </p>
        <Link href="/">
          <Button className="mt-4">Back to the roles</Button>
        </Link>
      </Card>
    );
  }

  if (state?.needsConfirmation) {
    return (
      <Card className="mx-auto max-w-lg p-8 text-center" aria-live="polite">
        <h2 className="text-xl font-semibold">A spot opened up</h2>
        <p className="mt-2 text-muted">
          Ready to begin? Please confirm within {state.confirmSecondsLeft ?? 30} seconds or we will
          offer the spot to the next person.
        </p>
        <Button
          size="lg"
          className="mt-5"
          onClick={confirm}
          disabled={busy}
          data-testid="confirm-ready"
        >
          I&apos;m ready
        </Button>
        <button
          type="button"
          className="mt-3 block w-full text-sm text-muted underline"
          onClick={leave}
        >
          Leave the queue
        </button>
      </Card>
    );
  }

  const position = state?.position ?? null;
  const minutes = state?.waitSeconds ? Math.max(1, Math.round(state.waitSeconds / 60)) : null;
  return (
    <Card
      className="mx-auto max-w-lg p-8 text-center"
      aria-live="polite"
      data-testid="waiting-room"
    >
      <h2 className="text-xl font-semibold">All interview rooms are busy</h2>
      <p className="mt-2 text-muted">
        To keep the experience smooth we run {state?.maxActive ?? 4} interviews at a time. Keep this
        page open and you will move forward automatically.
      </p>
      <p className="mt-5 text-3xl font-semibold" data-testid="queue-position">
        {position ? `You are #${position} in line` : 'Checking your place…'}
      </p>
      {minutes && (
        <p className="mt-1 text-sm text-muted">
          Estimated wait: about {minutes} minute{minutes === 1 ? '' : 's'}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        className="mt-5 text-sm text-muted underline"
        onClick={leave}
        disabled={busy}
      >
        Leave the queue
      </button>
    </Card>
  );
}
