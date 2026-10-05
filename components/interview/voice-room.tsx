'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { TextAnswer } from '@/components/interview/text-answer';
import type { useInterview } from '@/components/interview/use-interview';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { api } from '@/lib/client-api';
import { QuestionPlayer } from '@/lib/voice/audio-player';
import { initialVoiceState, voiceReducer, type VoicePhase } from '@/lib/voice/state-machine';
import { createTranscriber, TranscriberError, type Transcriber } from '@/lib/voice/transcriber';
import {
  emptyBuffer,
  finishReason,
  onCommitted,
  onPartial,
  transcriptOf,
  wordCount,
  type TurnBuffer,
} from '@/lib/voice/turn-assembler';

type Interview = ReturnType<typeof useInterview>;
type SpeechSession = { token: string; keyterms: string[]; modelId: string };

const phaseLabel = {
  ready: 'Ready when you are',
  thinking: 'Thinking…',
  speaking: 'The interviewer is speaking',
  listening: 'Your turn: speak naturally',
  finishing: 'Interview complete',
} as const;

export function VoiceRoom({
  interview,
  onSwitchToText,
  onPhase,
}: {
  interview: Interview;
  onSwitchToText: () => void;
  /** Lets a parent (the video call layout) follow what the interview is doing. */
  onPhase?: (phase: VoicePhase) => void;
}) {
  const { sessionId, lastInterviewer } = interview;
  const [vs, dispatch] = useReducer(voiceReducer, undefined, () => initialVoiceState(false));
  useEffect(() => {
    onPhase?.(vs.phase);
  }, [vs.phase, onPhase]);
  // Values tied to one listening round (or one spoken question) are stored with their key and ignored once it changes,
  // so nothing has to be reset synchronously inside an effect.
  const [live, setLive] = useState<{ key: string; text: string }>({ key: '', text: '' });
  const [mic, setMic] = useState<{ key: string; message: string } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [audio, setAudio] = useState<{ key: number; message: string } | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [listenKey, setListenKey] = useState(0);

  const playerRef = useRef<QuestionPlayer | null>(null);
  const bufferRef = useRef<TurnBuffer>(emptyBuffer());
  const transcriberRef = useRef<Transcriber | null>(null);
  const committedWaiter = useRef<(() => void) | null>(null);
  const finalizingRef = useRef(false);
  const interviewRef = useRef(interview);

  const questionIdx = lastInterviewer?.idx ?? null;
  const roundKey = `${questionIdx}:${listenKey}`;
  const liveText = live.key === roundKey ? live.text : '';
  const micNotice = mic?.key === roundKey ? mic.message : null;
  const audioNotice = audio && audio.key === questionIdx ? audio.message : null;

  const submitAnswer = useCallback(async (text: string, startedAt: Date, audioMs?: number) => {
    dispatch({ type: 'ANSWER_SUBMITTED' });
    const result = await interviewRef.current.submit(text, { startedAt, audioMs });
    if (result) {
      setDraft('');
      setTyping(false);
      dispatch({ type: 'QUESTION_READY', done: result.done });
    } else {
      // Keep what they said so nothing is lost; they can edit and resend.
      setDraft(text);
      setTyping(true);
      dispatch({ type: 'REQUEST_FAILED' });
    }
  }, []);

  /** Ends the current answer: finalise the transcript, stop the microphone and send it. */
  const finalize = useCallback(async () => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    const transcriber = transcriberRef.current;
    if (transcriber) {
      const committed = new Promise<void>((resolve) => {
        committedWaiter.current = resolve;
        setTimeout(resolve, 1500);
      });
      transcriber.commit();
      await committed;
    }
    const buffer = bufferRef.current;
    const text = transcriptOf(buffer);
    const startedAt = new Date(buffer.startedAt ?? Date.now());
    const audioMs = buffer.startedAt ? Date.now() - buffer.startedAt : undefined;
    transcriber?.stop();
    transcriberRef.current = null;
    finalizingRef.current = false;
    if (wordCount(buffer) === 0) {
      setHint("I didn't hear anything. Take your time and answer when you're ready.");
      setListenKey((k) => k + 1);
      return;
    }
    setHint(null);
    await submitAnswer(text, startedAt, audioMs);
  }, [submitAnswer]);
  const finalizeRef = useRef(finalize);
  useEffect(() => {
    interviewRef.current = interview;
    finalizeRef.current = finalize;
  });

  // Speak each new question.
  useEffect(() => {
    if (vs.phase !== 'speaking' || questionIdx === null) return;
    const player = playerRef.current;
    if (!player) {
      dispatch({ type: 'SPEECH_ENDED' });
      return;
    }
    let cancelled = false;
    player
      .play(`/api/sessions/${sessionId}/tts?turn=${questionIdx}`)
      .catch(() =>
        setAudio({
          key: questionIdx,
          message: 'Voice playback is unavailable, so please read the question on screen.',
        }),
      )
      .finally(() => {
        if (!cancelled) dispatch({ type: 'SPEECH_ENDED' });
      });
    return () => {
      cancelled = true;
      player.stop();
    };
  }, [vs.phase, questionIdx, sessionId]);

  // Listen for the answer.
  useEffect(() => {
    if (vs.phase !== 'listening') return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    bufferRef.current = emptyBuffer();

    (async () => {
      try {
        const speech = await api<SpeechSession>(`/api/sessions/${sessionId}/speech-token`);
        if (cancelled) return;
        const transcriber = await createTranscriber(speech, {
          onPartial: (t) => {
            bufferRef.current = onPartial(bufferRef.current, t, Date.now());
            setLive({ key: roundKey, text: transcriptOf(bufferRef.current) });
          },
          onCommitted: (t) => {
            bufferRef.current = onCommitted(bufferRef.current, t, Date.now());
            setLive({ key: roundKey, text: transcriptOf(bufferRef.current) });
            committedWaiter.current?.();
          },
          onError: (e) => setMic({ key: roundKey, message: e.message }),
        });
        transcriberRef.current = transcriber;
        await transcriber.start();
        if (cancelled) {
          transcriber.stop();
          return;
        }
        timer = setInterval(() => {
          if (finishReason(bufferRef.current, Date.now())) void finalizeRef.current();
        }, 250);
      } catch (err) {
        if (cancelled) return;
        transcriberRef.current?.stop();
        transcriberRef.current = null;
        const message =
          err instanceof TranscriberError && err.kind === 'permission_denied'
            ? 'Microphone access is blocked. Allow it in your browser, or type your answers instead.'
            : err instanceof TranscriberError && err.kind === 'no_microphone'
              ? 'No microphone was found. You can type your answers instead.'
              : err instanceof Error
                ? `${err.message} You can type your answer instead.`
                : 'Voice input is unavailable. You can type your answer instead.';
        setMic({ key: roundKey, message });
        setTyping(true);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      transcriberRef.current?.stop();
      transcriberRef.current = null;
    };
  }, [vs.phase, roundKey, sessionId]);

  // After the closing remark, score the interview and move on.
  const finishedRef = useRef(false);
  useEffect(() => {
    if (vs.phase !== 'finishing' || finishedRef.current) return;
    finishedRef.current = true;
    void interviewRef.current.finish();
  }, [vs.phase]);

  async function begin() {
    const player = new QuestionPlayer();
    playerRef.current = player;
    await player.unlock();
    dispatch({ type: 'BEGIN' });
    if (lastInterviewer) {
      dispatch({ type: 'QUESTION_READY', done: false });
      return;
    }
    const result = await interview.start();
    if (result) dispatch({ type: 'QUESTION_READY', done: result.done });
    else dispatch({ type: 'START_FAILED' });
  }

  const listening = vs.phase === 'listening';

  if (vs.phase === 'ready') {
    return (
      <Card className="flex flex-col items-center gap-4 p-8 text-center">
        <h2 className="text-xl font-semibold">Voice interview</h2>
        <p className="max-w-md text-muted">
          The interviewer will ask each question out loud, then listen. Speak naturally and take
          your time to think: a short pause won&apos;t cut you off. Your browser will ask for
          microphone access.
        </p>
        <Button size="lg" onClick={begin} data-testid="begin-voice">
          Begin voice interview
        </Button>
        <button type="button" className="text-sm text-muted underline" onClick={onSwitchToText}>
          I&apos;d rather type my answers
        </button>
        {interview.error && (
          <p role="alert" className="text-sm text-danger">
            {interview.error}
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6" aria-live="polite">
        <div className="mb-4 flex items-center gap-4">
          <div
            className={`relative grid h-14 w-14 shrink-0 place-items-center rounded-full ${listening ? 'bg-danger' : 'bg-primary'} ${vs.phase === 'speaking' || listening ? 'pulse-ring' : ''}`}
            aria-hidden="true"
          >
            <span className="h-3 w-3 rounded-full bg-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Badge tone="primary">Interviewer</Badge>
              {lastInterviewer?.kind === 'follow_up' && <Badge tone="warning">Follow-up</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted" data-testid="voice-phase" data-phase={vs.phase}>
              {phaseLabel[vs.phase]}
            </p>
          </div>
        </div>
        <p className="text-lg leading-relaxed" data-testid="current-question">
          {lastInterviewer?.text ?? ''}
        </p>
        {audioNotice && <p className="mt-3 text-sm text-warning">{audioNotice}</p>}
        {vs.phase === 'speaking' && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={() => playerRef.current?.stop()}
          >
            Skip audio
          </Button>
        )}
      </Card>

      {vs.phase === 'finishing' ? (
        <Card className="p-6 text-center">
          <p className="font-medium">That was the last question. Thank you!</p>
          <p className="mt-1 text-sm text-muted">Preparing your feedback…</p>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">What I&apos;m hearing</h2>
            {listening && <Badge tone="danger">Microphone live</Badge>}
          </div>
          <p
            className="min-h-16 rounded-lg bg-background p-3 text-base leading-relaxed"
            data-testid="live-caption"
            aria-live="polite"
          >
            {liveText || (
              <span className="text-muted">
                {listening
                  ? micNotice
                    ? ''
                    : 'Listening… start speaking when you are ready.'
                  : vs.phase === 'thinking'
                    ? 'Thinking about your answer…'
                    : 'Your words will appear here while you speak.'}
              </span>
            )}
          </p>
          {hint && <p className="mt-2 text-sm text-warning">{hint}</p>}
          {micNotice && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {micNotice}
            </p>
          )}
          {interview.error && !typing && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {interview.error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              className="text-sm text-muted underline"
              onClick={() => setTyping((v) => !v)}
              aria-expanded={typing}
            >
              {typing ? 'Hide the typing box' : 'Prefer to type?'}
            </button>
            <div className="flex gap-2">
              {micNotice && listening && (
                <Button variant="outline" onClick={() => setListenKey((k) => k + 1)}>
                  Retry microphone
                </Button>
              )}
              <Button
                onClick={() => void finalize()}
                disabled={!listening || !!micNotice}
                data-testid="done-speaking"
              >
                I&apos;m done
              </Button>
            </div>
          </div>
        </Card>
      )}

      {typing && vs.phase !== 'finishing' && (
        <TextAnswer
          key={draft}
          heading="Type your answer"
          initialValue={draft}
          disabled={interview.busy || vs.phase !== 'listening'}
          busy={interview.busy}
          error={interview.error}
          onSubmit={(text, startedAt) => {
            // Typed answers replace whatever the microphone heard.
            transcriberRef.current?.stop();
            transcriberRef.current = null;
            void submitAnswer(text, startedAt);
          }}
        />
      )}
    </div>
  );
}
