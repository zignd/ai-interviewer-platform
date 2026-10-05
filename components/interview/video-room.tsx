'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useRecorder } from '@/components/interview/use-recorder';
import type { useInterview } from '@/components/interview/use-interview';
import { VideoStage } from '@/components/interview/video-stage';
import { VoiceRoom } from '@/components/interview/voice-room';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { VoicePhase } from '@/lib/voice/state-machine';

type Interview = ReturnType<typeof useInterview>;

/**
 * Video mode: the same voice interview, shown as a video call with an optional camera and an optional,
 * clearly announced recording. Consent comes first, and the camera is never required.
 */
export function VideoRoom({
  interview,
  onSwitchToText,
}: {
  interview: Interview;
  onSwitchToText: () => void;
}) {
  const router = useRouter();
  const recorder = useRecorder(interview.sessionId);
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<VoicePhase | null>(null);
  const { stopRecording } = recorder;

  const onPhase = useCallback(
    (p: VoicePhase) => {
      setPhase(p);
      if (p === 'finishing') void stopRecording();
    },
    [stopRecording],
  );

  async function start(record: boolean) {
    await recorder.openMedia();
    if (record) await recorder.startRecording();
    setStarted(true);
  }

  if (!started) {
    return (
      <Card className="flex flex-col gap-4 p-6" data-testid="recording-consent">
        <h2 className="text-xl font-semibold">Before we start</h2>
        <p className="text-muted">
          This is a video call with the AI interviewer. Your camera is optional: if it is off or
          unavailable you can still take the interview by voice.
        </p>
        <div className="rounded-xl bg-accent p-4 text-sm">
          <p className="font-medium">About recording</p>
          <p className="mt-1 text-muted">
            If you choose to record, your camera and microphone are saved at low quality so you can
            replay the interview later. Recordings are rotated automatically to stay within storage
            limits, and may be deleted after a while. Your transcript and feedback are always kept.
            You can start without recording.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void start(true)} data-testid="start-with-recording">
            Start with recording
          </Button>
          <Button
            variant="outline"
            onClick={() => void start(false)}
            data-testid="start-without-recording"
          >
            Start without recording
          </Button>
        </div>
        <button
          type="button"
          className="self-start text-sm text-muted underline"
          onClick={onSwitchToText}
        >
          I&apos;d rather type my answers
        </button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <VideoStage
        question={interview.lastInterviewer?.text ?? 'Preparing your first question…'}
        phase={phase}
        stream={recorder.stream}
        hasCamera={recorder.hasCamera}
        recorderState={recorder.state}
        onToggleCamera={recorder.setCameraEnabled}
        onEnd={() => {
          void stopRecording();
          router.push(`/sessions/${interview.sessionId}`);
        }}
      />
      <VoiceRoom interview={interview} onSwitchToText={onSwitchToText} onPhase={onPhase} />
    </div>
  );
}
