/**
 * The visible state of a voice interview: what the candidate sees and what the app is doing.
 *   ready     the candidate has not begun yet
 *   thinking  waiting for the server (first question, or the next one after an answer)
 *   speaking  the interviewer is asking the question aloud
 *   listening the candidate's turn, microphone live
 *   finishing the interview is over and feedback is being prepared
 */
export type VoicePhase = 'ready' | 'thinking' | 'speaking' | 'listening' | 'finishing';

export type VoiceState = {
  phase: VoicePhase;
  /** The interview is over: after the closing remark the app goes to the results. */
  done: boolean;
};

export type VoiceEvent =
  | { type: 'BEGIN' }
  | { type: 'QUESTION_READY'; done: boolean }
  | { type: 'SPEECH_ENDED' }
  | { type: 'ANSWER_SUBMITTED' }
  | { type: 'START_FAILED' }
  | { type: 'REQUEST_FAILED' };

export const initialVoiceState = (hasQuestion = false): VoiceState => ({
  phase: hasQuestion ? 'speaking' : 'ready',
  done: false,
});

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case 'BEGIN':
      return state.phase === 'ready' ? { ...state, phase: 'thinking' } : state;
    case 'QUESTION_READY':
      return state.phase === 'thinking' || state.phase === 'ready'
        ? { phase: 'speaking', done: event.done }
        : state;
    case 'SPEECH_ENDED':
      if (state.phase !== 'speaking') return state;
      return state.done ? { ...state, phase: 'finishing' } : { ...state, phase: 'listening' };
    case 'ANSWER_SUBMITTED':
      return state.phase === 'listening' ? { ...state, phase: 'thinking' } : state;
    case 'START_FAILED':
      return state.phase === 'thinking' ? { ...state, phase: 'ready' } : state;
    case 'REQUEST_FAILED':
      // Let the candidate retry from the listening state; their answer is kept in the UI.
      return state.phase === 'thinking' ? { ...state, phase: 'listening' } : state;
  }
}
