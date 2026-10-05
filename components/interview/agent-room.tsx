'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { useInterview } from '@/components/interview/use-interview';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { api } from '@/lib/client-api';

type Interview = ReturnType<typeof useInterview>;
type AgentSession = { signedUrl: string; openingText: string; questionIdx: number };
type Phase = 'ready' | 'connecting' | 'live' | 'finishing';

type Conversation = {
  endSession: () => Promise<void>;
  getInputVolume?: () => Promise<number>;
};

/**
 * Voice interview driven by an ElevenLabs agent: ElevenLabs listens, decides when the candidate is done,
 * and speaks. Every question still comes from our interview engine through the Custom LLM route.
 */
export function AgentRoom({
  interview,
  onSwitchToText,
}: {
  interview: Interview;
  onSwitchToText: () => void;
}) {
  const { sessionId, lastInterviewer, sync } = interview;
  const [phase, setPhase] = useState<Phase>('ready');
  const [mode, setMode] = useState<'speaking' | 'listening'>('speaking');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const conversationRef = useRef<Conversation | null>(null);
  const completedRef = useRef(false);
  const modeRef = useRef<'speaking' | 'listening'>('speaking');
  const finishedRef = useRef(false);

  const end = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setPhase('finishing');
    try {
      await conversationRef.current?.endSession();
    } catch {
      // Already closed.
    }
    conversationRef.current = null;
    await interview.finish();
  }, [interview]);

  // While the call is live, mirror the server's view of the interview and notice when it is over.
  useEffect(() => {
    if (phase !== 'live') return;
    let stopped = false;
    const timer = setInterval(async () => {
      const view = await sync();
      if (stopped || !view) return;
      if (view.session.status === 'completed') completedRef.current = true;
      // The closing remark has been spoken once the agent goes back to listening.
      if (completedRef.current && modeRef.current === 'listening') void end();
    }, 1200);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [phase, sync, end]);

  useEffect(
    () => () => {
      void conversationRef.current?.endSession().catch(() => undefined);
    },
    [],
  );

  async function begin() {
    setPhase('connecting');
    setError(null);
    try {
      const session = await api<AgentSession>(`/api/sessions/${sessionId}/agent-session`);
      const { Conversation } = await import('@elevenlabs/client');
      const conversation = await Conversation.startSession({
        signedUrl: session.signedUrl,
        connectionType: 'websocket',
        overrides: { agent: { firstMessage: session.openingText } },
        customLlmExtraBody: { session_id: sessionId },
        onModeChange: ({ mode: m }: { mode: 'speaking' | 'listening' }) => {
          modeRef.current = m;
          setMode(m);
        },
        onMessage: (m: { source: string; message: string }) => {
          if (m.source === 'user') setHeard(m.message);
        },
        onError: (message: string) => setError(message || 'The voice connection had a problem.'),
        onDisconnect: () => {
          if (!completedRef.current && !finishedRef.current) {
            setError(
              'The voice connection ended unexpectedly. You can reconnect or type your answers.',
            );
            setPhase('ready');
          }
        },
      });
      conversationRef.current = conversation as unknown as Conversation;
      setPhase('live');
      void sync();
    } catch (err) {
      const denied = err instanceof Error && /permission|denied|NotAllowed/i.test(err.message);
      setError(
        denied
          ? 'Microphone access is blocked. Allow it in your browser, or type your answers instead.'
          : err instanceof Error
            ? err.message
            : 'Could not start the voice interview.',
      );
      setPhase('ready');
    }
  }

  if (phase === 'ready' || phase === 'connecting') {
    return (
      <Card className="flex flex-col items-center gap-4 p-8 text-center">
        <h2 className="text-xl font-semibold">Voice interview</h2>
        <p className="max-w-md text-muted">
          The interviewer will speak each question and listen for your answer. Your browser will ask
          for microphone access.
        </p>
        <Button
          size="lg"
          onClick={begin}
          disabled={phase === 'connecting'}
          data-testid="begin-voice"
        >
          {phase === 'connecting' ? 'Connecting…' : 'Begin voice interview'}
        </Button>
        <button type="button" className="text-sm text-muted underline" onClick={onSwitchToText}>
          I&apos;d rather type my answers
        </button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </Card>
    );
  }

  const speaking = mode === 'speaking' && phase === 'live';
  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6" aria-live="polite">
        <div className="mb-4 flex items-center gap-4">
          <div
            className={`relative grid h-14 w-14 shrink-0 place-items-center rounded-full ${speaking ? 'bg-primary' : 'bg-danger'} pulse-ring`}
            aria-hidden="true"
          >
            <span className="h-3 w-3 rounded-full bg-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Badge tone="primary">Interviewer</Badge>
              {lastInterviewer?.kind === 'follow_up' && <Badge tone="warning">Follow-up</Badge>}
            </div>
            <p
              className="mt-1 text-sm text-muted"
              data-testid="voice-phase"
              data-phase={phase === 'finishing' ? 'finishing' : speaking ? 'speaking' : 'listening'}
            >
              {phase === 'finishing'
                ? 'Interview complete'
                : speaking
                  ? 'The interviewer is speaking'
                  : 'Your turn: speak naturally'}
            </p>
          </div>
        </div>
        <p className="text-lg leading-relaxed" data-testid="current-question">
          {lastInterviewer?.text ?? ''}
        </p>
      </Card>
      {phase === 'finishing' ? (
        <Card className="p-6 text-center">
          <p className="font-medium">That was the last question. Thank you!</p>
          <p className="mt-1 text-sm text-muted">Preparing your feedback…</p>
        </Card>
      ) : (
        <Card className="p-5">
          <h2 className="mb-2 text-sm font-medium">What I heard</h2>
          <p
            className="min-h-16 rounded-lg bg-background p-3 text-base leading-relaxed"
            data-testid="live-caption"
          >
            {heard || (
              <span className="text-muted">
                Your last answer appears here after you finish speaking.
              </span>
            )}
          </p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={() => void end()}>
              End interview
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
