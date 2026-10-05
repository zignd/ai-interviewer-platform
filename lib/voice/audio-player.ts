/**
 * Plays the interviewer's spoken question. One <audio> element is reused for the whole interview,
 * so the browser's autoplay permission (granted by the "Begin" click) keeps applying.
 */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

export class QuestionPlayer {
  private readonly audio = new Audio();
  private cancel: (() => void) | null = null;

  /** Call from a click handler so later playback is allowed. */
  async unlock() {
    try {
      this.audio.src = SILENT_WAV;
      await this.audio.play();
      this.audio.pause();
    } catch {
      // Playback may still work later; unlock is best effort.
    }
  }

  /** Resolves when the audio ends or is stopped. Rejects if it can't be played. */
  play(url: string): Promise<void> {
    this.stop();
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new Error('Audio playback failed'));
      };
      const cleanup = () => {
        this.audio.removeEventListener('ended', done);
        this.audio.removeEventListener('error', fail);
        this.cancel = null;
      };
      this.cancel = done;
      this.audio.addEventListener('ended', done);
      this.audio.addEventListener('error', fail);
      this.audio.src = url;
      this.audio.play().catch(fail);
    });
  }

  stop() {
    this.audio.pause();
    this.cancel?.();
  }
}
