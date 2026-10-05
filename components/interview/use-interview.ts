'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { api, getJson } from '@/lib/client-api';
import type { DecisionSnapshot } from '@/lib/engine/types';
import type { SessionViewData, TurnResultData } from '@/lib/view-types';

type Turn = SessionViewData['turns'][number];

/** Server-backed state of one interview: the conversation, progress and the calls that move it forward. */
export function useInterview(initial: SessionViewData) {
  const router = useRouter();
  const sessionId = initial.session.id;
  const [turns, setTurns] = useState<Turn[]>(initial.turns);
  const [progress, setProgress] = useState(initial.progress);
  const [decisions, setDecisions] = useState<DecisionSnapshot[]>(initial.decisions);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);

  const interviewerTurn = (q: TurnResultData['question']): Turn => ({
    idx: q.idx,
    role: 'interviewer',
    text: q.text,
    kind: q.kind,
    startedAt: new Date().toISOString(),
    endedAt: null,
    audioMs: null,
  });

  /** Asks the first question. Safe to call more than once. */
  const start = useCallback(async (): Promise<TurnResultData | null> => {
    if (startedRef.current) return null;
    startedRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api<TurnResultData>(`/api/sessions/${sessionId}/start`);
      setTurns([interviewerTurn(r.question)]);
      setProgress(r.progress);
      setDecisions([r.decision]);
      return r;
    } catch (err) {
      startedRef.current = false;
      setError(err instanceof Error ? err.message : 'Could not start the interview');
      return null;
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  /** Sends an answer. Returns the server result, or null (with `error` set) if it failed. */
  const submit = useCallback(
    async (
      text: string,
      meta: { startedAt?: Date; audioMs?: number } = {},
    ): Promise<TurnResultData | null> => {
      const answer = text.trim();
      if (!answer) return null;
      setBusy(true);
      setError(null);
      const startedAt = (meta.startedAt ?? new Date()).toISOString();
      const endedAt = new Date().toISOString();
      try {
        const r = await api<TurnResultData>(`/api/sessions/${sessionId}/turn`, {
          transcript: answer,
          startedAt,
          endedAt,
          audioMs: meta.audioMs,
        });
        setTurns((prev) => [
          ...prev,
          {
            idx: r.question.idx - 1,
            role: 'candidate',
            text: answer,
            kind: null,
            startedAt,
            endedAt,
            audioMs: meta.audioMs ?? null,
          },
          interviewerTurn(r.question),
        ]);
        setProgress(r.progress);
        setDecisions((prev) => [...prev, r.decision]);
        return r;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );

  /** Reloads the conversation from the server. Used when something else (the voice agent) drives the turns. */
  const sync = useCallback(async (): Promise<SessionViewData | null> => {
    try {
      const view = await getJson<SessionViewData>(`/api/sessions/${sessionId}`);
      setTurns(view.turns);
      setProgress(view.progress);
      setDecisions(view.decisions);
      return view;
    } catch {
      return null;
    }
  }, [sessionId]);

  /** Scores the finished interview and opens the results page. */
  const finish = useCallback(async () => {
    try {
      await api(`/api/sessions/${sessionId}/evaluate`);
    } catch {
      // The results page retries the evaluation, so we can move on.
    }
    router.push(`/sessions/${sessionId}`);
  }, [router, sessionId]);

  const lastInterviewer = [...turns].reverse().find((t) => t.role === 'interviewer') ?? null;
  const latestDecision = decisions.length ? decisions[decisions.length - 1] : null;
  return {
    sessionId,
    turns,
    progress,
    decisions,
    latestDecision,
    error,
    setError,
    busy,
    start,
    submit,
    sync,
    finish,
    lastInterviewer,
  };
}
