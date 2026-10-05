'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function StartInterview({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(mode: 'text' | 'voice' | 'video') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId, mode }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error?.message ?? 'Could not start the interview');
      const { id } = await res.json();
      router.push(`/interview/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the interview');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={() => start('voice')}
        disabled={busy}
        aria-label={`Start interview for ${jobTitle}`}
      >
        {busy ? 'Starting…' : 'Start interview'}
      </Button>
      <Button
        variant="outline"
        onClick={() => start('video')}
        disabled={busy}
        aria-label={`Start video interview for ${jobTitle}`}
      >
        Start with camera (video call)
      </Button>
      <button
        type="button"
        onClick={() => start('text')}
        disabled={busy}
        aria-label={`Answer by typing for ${jobTitle}`}
        className="text-sm text-muted underline hover:text-foreground disabled:opacity-50"
      >
        Prefer to type your answers?
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
