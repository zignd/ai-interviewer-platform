import { describe, expect, it } from 'vitest';
import {
  initialVoiceState,
  voiceReducer,
  type VoiceEvent,
  type VoiceState,
} from '@/lib/voice/state-machine';
import { classifyMediaError } from '@/lib/voice/transcriber';

const run = (state: VoiceState, ...events: VoiceEvent[]) => events.reduce(voiceReducer, state);

describe('voice state machine', () => {
  it('walks a normal turn: ready, thinking, speaking, listening, thinking, speaking', () => {
    let s = initialVoiceState();
    expect(s.phase).toBe('ready');
    s = run(s, { type: 'BEGIN' });
    expect(s.phase).toBe('thinking');
    s = run(s, { type: 'QUESTION_READY', done: false });
    expect(s.phase).toBe('speaking');
    s = run(s, { type: 'SPEECH_ENDED' });
    expect(s.phase).toBe('listening');
    s = run(s, { type: 'ANSWER_SUBMITTED' });
    expect(s.phase).toBe('thinking');
    s = run(s, { type: 'QUESTION_READY', done: false });
    expect(s.phase).toBe('speaking');
  });

  it('after the closing remark the interview moves to finishing, not listening', () => {
    const s = run(
      initialVoiceState(),
      { type: 'BEGIN' },
      { type: 'QUESTION_READY', done: true },
      { type: 'SPEECH_ENDED' },
    );
    expect(s.phase).toBe('finishing');
  });

  it('ignores events that do not apply to the current phase', () => {
    expect(run(initialVoiceState(), { type: 'SPEECH_ENDED' }).phase).toBe('ready');
    expect(run(initialVoiceState(), { type: 'ANSWER_SUBMITTED' }).phase).toBe('ready');
    const speaking = run(
      initialVoiceState(),
      { type: 'BEGIN' },
      { type: 'QUESTION_READY', done: false },
    );
    expect(run(speaking, { type: 'BEGIN' }).phase).toBe('speaking');
    expect(run(speaking, { type: 'ANSWER_SUBMITTED' }).phase).toBe('speaking');
  });

  it('a failed request returns to listening so the answer can be retried', () => {
    const s = run(
      initialVoiceState(),
      { type: 'BEGIN' },
      { type: 'QUESTION_READY', done: false },
      { type: 'SPEECH_ENDED' },
      { type: 'ANSWER_SUBMITTED' },
      { type: 'REQUEST_FAILED' },
    );
    expect(s.phase).toBe('listening');
  });

  it('resuming with an existing question starts by speaking it', () => {
    expect(initialVoiceState(true).phase).toBe('speaking');
  });
});

describe('classifyMediaError', () => {
  it('recognises denied permission and missing devices', () => {
    expect(classifyMediaError({ name: 'NotAllowedError' }).kind).toBe('permission_denied');
    expect(classifyMediaError({ name: 'NotFoundError' }).kind).toBe('no_microphone');
    expect(classifyMediaError(new Error('boom')).kind).toBe('unknown');
  });
});
