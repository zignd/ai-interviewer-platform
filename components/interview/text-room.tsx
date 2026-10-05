'use client';

import { useEffect, useState } from 'react';
import { TextAnswer } from '@/components/interview/text-answer';
import type { useInterview } from '@/components/interview/use-interview';
import { Badge, Card } from '@/components/ui/card';

type Interview = ReturnType<typeof useInterview>;

export function TextRoom({
  interview,
  draft = null,
}: {
  interview: Interview;
  /** Text to place in the answer box (developer mode). */
  draft?: { text: string; n: number } | null;
}) {
  const { lastInterviewer, start, submit, finish, busy, error } = interview;
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!lastInterviewer) void start();
  }, [lastInterviewer, start]);

  async function send(text: string, startedAt: Date) {
    const result = await submit(text, { startedAt });
    if (result?.done) {
      setFinishing(true);
      await finish();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6" aria-live="polite">
        <div className="mb-3 flex items-center gap-2">
          <Badge tone="primary">Interviewer</Badge>
          {lastInterviewer?.kind === 'follow_up' && <Badge tone="warning">Follow-up</Badge>}
        </div>
        {lastInterviewer ? (
          <p className="text-lg leading-relaxed" data-testid="current-question">
            {lastInterviewer.text}
          </p>
        ) : (
          <p className="text-lg text-muted">Preparing your first question…</p>
        )}
      </Card>

      {finishing ? (
        <Card className="p-6 text-center">
          <p className="font-medium">That was the last question. Thank you!</p>
          <p className="mt-1 text-sm text-muted">Preparing your feedback…</p>
        </Card>
      ) : (
        <TextAnswer
          key={`${lastInterviewer?.idx ?? 'none'}-${draft?.n ?? 0}`}
          initialValue={draft?.text ?? ''}
          disabled={busy || !lastInterviewer}
          busy={busy}
          error={error}
          onSubmit={send}
        />
      )}
    </div>
  );
}
