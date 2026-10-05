'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/client-api';

/**
 * Developer tool (DEV_MODE=1): a strong sample answer to the current question that can be read aloud or
 * pasted into the typing box, to see how the interviewer scores a good answer.
 */
export function DevPanel({
  sessionId,
  questionIdx,
  onUse,
}: {
  sessionId: string;
  questionIdx: number | null;
  onUse?: (text: string) => void;
}) {
  const [state, setState] = useState<{
    idx: number | null;
    text: string | null;
    error: string | null;
  }>({
    idx: null,
    text: null,
    error: null,
  });
  const [copied, setCopied] = useState(false);
  const requested = useRef<number | null>(null);

  const load = useCallback(
    async (idx: number) => {
      requested.current = idx;
      try {
        const r = await api<{ answer: string; questionIdx: number }>(
          `/api/sessions/${sessionId}/dev-answer`,
        );
        if (requested.current === idx) setState({ idx, text: r.answer, error: null });
      } catch (err) {
        if (requested.current === idx) {
          setState({
            idx,
            text: null,
            error: err instanceof Error ? err.message : 'Could not generate a sample answer',
          });
        }
      }
    },
    [sessionId],
  );

  useEffect(() => {
    if (questionIdx !== null && requested.current !== questionIdx) void load(questionIdx);
  }, [questionIdx, load]);

  const current = state.idx === questionIdx ? state : { idx: questionIdx, text: null, error: null };
  const loading = questionIdx !== null && !current.text && !current.error;

  return (
    <Card className="border-2 border-warning/60 p-5" data-testid="dev-panel">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Suggested answer</h2>
        <span
          className="rounded-md bg-warning px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white"
          title="Visible because DEV_MODE is on"
        >
          Developer tool
        </span>
      </div>
      <p className="mb-3 text-xs text-muted">
        A strong answer to the current question, to read aloud or paste, so you can see how the
        interviewer scores it. Not shown when DEV_MODE is off.
      </p>
      {loading && <p className="text-sm text-muted">Writing a suggested answer…</p>}
      {current.error && (
        <p role="alert" className="text-sm text-danger">
          {current.error}
        </p>
      )}
      {current.text && (
        <>
          <p
            className="rounded-lg bg-background p-3 text-sm leading-relaxed"
            data-testid="dev-answer"
          >
            {current.text}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard?.writeText(current.text ?? '').catch(() => undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {onUse && (
              <Button size="sm" onClick={() => onUse(current.text ?? '')} data-testid="dev-use">
                Use as my answer
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => questionIdx !== null && void load(questionIdx)}
            >
              Another suggestion
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
