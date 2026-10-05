'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client-api';
import { AgentRoom } from '@/components/interview/agent-room';
import { DevPanel } from '@/components/interview/dev-panel';
import { DecisionPanel } from '@/components/interview/decision-panel';
import { ProgressHeader } from '@/components/interview/progress-header';
import { TextRoom } from '@/components/interview/text-room';
import { useInterview } from '@/components/interview/use-interview';
import { VideoRoom } from '@/components/interview/video-room';
import { VoiceRoom } from '@/components/interview/voice-room';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { SessionViewData } from '@/lib/view-types';

export function InterviewRoom({
  initial,
  transport = 'scribe',
  devMode = false,
}: {
  initial: SessionViewData;
  transport?: 'scribe' | 'agent';
  devMode?: boolean;
}) {
  const [devDraft, setDevDraft] = useState<{ text: string; n: number } | null>(null);
  const interview = useInterview(initial);
  const [inputMode, setInputMode] = useState<'voice' | 'text'>(
    initial.session.mode === 'text' ? 'text' : 'voice',
  );
  const [panelOpen, setPanelOpen] = useState(true);
  const history = interview.turns.filter((t) => t !== interview.lastInterviewer);
  const [expired, setExpired] = useState(false);
  const gated = initial.session.mode !== 'text';
  const sessionId = initial.session.id;

  // Heartbeat: tells the server this interview is still open so its slot isn't given away.
  useEffect(() => {
    if (!gated) return;
    const timer = setInterval(async () => {
      try {
        const state = await api<{ status: string }>(`/api/sessions/${sessionId}/queue`);
        if (state.status === 'abandoned') setExpired(true);
      } catch {
        // A missed beat is tolerated; the server waits 30 s before giving up.
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [gated, sessionId]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      {expired && (
        <div role="alert" className="rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm">
          This interview timed out (time limit reached or connection lost), so your slot was
          released. Whatever you answered is saved.{' '}
          <Link href={`/sessions/${sessionId}`} className="font-medium underline">
            See your results
          </Link>
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <ProgressHeader
            title={initial.job.title}
            asked={interview.progress.questionsAsked}
            target={interview.progress.target}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          aria-controls="decision-panel"
        >
          {panelOpen ? 'Hide decision panel' : 'Show decision panel'}
        </Button>
      </div>

      <div
        className={
          panelOpen ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]' : 'mx-auto w-full max-w-3xl'
        }
      >
        <div className="flex min-w-0 flex-col gap-6">
          {inputMode === 'voice' && transport === 'agent' ? (
            <AgentRoom interview={interview} onSwitchToText={() => setInputMode('text')} />
          ) : inputMode === 'voice' && initial.session.mode === 'video' ? (
            <VideoRoom interview={interview} onSwitchToText={() => setInputMode('text')} />
          ) : inputMode === 'voice' ? (
            <VoiceRoom interview={interview} onSwitchToText={() => setInputMode('text')} />
          ) : (
            <TextRoom interview={interview} draft={devDraft} />
          )}
          {history.length > 0 && (
            <details className="rounded-2xl border border-border bg-card p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Conversation so far ({history.length} messages)
              </summary>
              <ol className="mt-4 flex flex-col gap-3">
                {history.map((t) => (
                  <li key={t.idx} className="text-sm">
                    <span className="font-medium">
                      {t.role === 'interviewer' ? 'Interviewer' : 'You'}:
                    </span>{' '}
                    <span className="text-muted">{t.text}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>

        {(panelOpen || devMode) && (
          <div className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
            {devMode && (
              <DevPanel
                sessionId={sessionId}
                questionIdx={interview.lastInterviewer?.idx ?? null}
                onUse={
                  inputMode === 'text' ? (text) => setDevDraft({ text, n: Date.now() }) : undefined
                }
              />
            )}
            {panelOpen && (
              <aside id="decision-panel" aria-label="Decision panel">
                <Card className="p-5">
                  <h2 className="mb-4 text-base font-semibold">Decision panel</h2>
                  <DecisionPanel
                    decision={interview.latestDecision}
                    allTopics={initial.allTopics}
                    target={interview.progress.target}
                  />
                </Card>
              </aside>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
