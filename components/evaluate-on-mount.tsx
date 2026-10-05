'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/** Scores a finished interview that has no evaluation yet, then refreshes the page. */
export function EvaluateOnMount({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);

  useEffect(() => {
    if (started.current === attempt) return;
    started.current = attempt;
    setError(null);
    fetch(`/api/sessions/${sessionId}/evaluate`, { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error?.message ?? 'Evaluation failed');
        router.refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Evaluation failed'));
  }, [attempt, router, sessionId]);

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-danger/30 bg-danger/5 p-6 text-center">
        <p className="font-medium text-danger">We couldn&apos;t score this interview yet.</p>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <Button className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-center" aria-live="polite">
      <p className="font-medium">Scoring your interview…</p>
      <p className="mt-1 text-sm text-muted">This usually takes a few seconds.</p>
    </div>
  );
}
