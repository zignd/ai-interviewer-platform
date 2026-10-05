'use client';

import { useCallback, useState } from 'react';
import { InterviewRoom } from '@/components/interview/interview-room';
import { WaitingRoom } from '@/components/interview/waiting-room';
import type { SessionViewData } from '@/lib/view-types';

/** Shows the waiting room until the candidate holds a confirmed slot, then the interview itself. */
export function InterviewGate({
  initial,
  transport,
  devMode = false,
}: {
  initial: SessionViewData;
  transport: 'scribe' | 'agent';
  devMode?: boolean;
}) {
  const gated = initial.session.mode !== 'text';
  const alreadyRunning =
    !gated || (initial.session.status === 'active' && initial.session.confirmedAt !== null);
  const [ready, setReady] = useState(alreadyRunning);
  const onReady = useCallback(() => setReady(true), []);

  if (!ready)
    return <WaitingRoom sessionId={initial.session.id} initial={null} onReady={onReady} />;
  return <InterviewRoom initial={initial} transport={transport} devMode={devMode} />;
}
