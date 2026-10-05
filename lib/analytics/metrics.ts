/** Pure interview metrics. They only use data kept in the database, so they survive recording deletion. */

type When = Date | string | null | undefined;

export type TurnLike = {
  role: 'interviewer' | 'candidate';
  text: string;
  startedAt: When;
  endedAt: When;
  audioMs: number | null;
};

const ms = (d: When): number | null => {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Ended minus started, or null when either is missing. */
export function durationMs(startedAt: When, endedAt: When): number | null {
  const a = ms(startedAt);
  const b = ms(endedAt);
  return a === null || b === null || b < a ? null : b - a;
}

export function formatDuration(totalMs: number | null): string {
  if (totalMs === null) return '-';
  const s = Math.round(totalMs / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const WORD_MS = 400; // about 150 words per minute

/** Speaking time of one turn: recorded audio length, else the timestamps, else an estimate from word count. */
export function speakingMs(turn: TurnLike): number {
  if (turn.audioMs && turn.audioMs > 0) return turn.audioMs;
  const span = durationMs(turn.startedAt, turn.endedAt);
  if (span !== null && span > 0) return span;
  const words = turn.text.trim().split(/\s+/).filter(Boolean).length;
  return words * WORD_MS;
}

export type TalkRatio = {
  candidateMs: number;
  interviewerMs: number;
  candidateShare: number | null;
};

export function talkRatio(turns: TurnLike[]): TalkRatio {
  let candidateMs = 0;
  let interviewerMs = 0;
  for (const t of turns) {
    if (t.role === 'candidate') candidateMs += speakingMs(t);
    else interviewerMs += speakingMs(t);
  }
  const total = candidateMs + interviewerMs;
  return { candidateMs, interviewerMs, candidateShare: total > 0 ? candidateMs / total : null };
}

export type TopicCoverage = { covered: number; total: number; ratio: number | null };

export function topicCoverage(
  snapshot: { topicsCovered: string[]; allTopics: string[] } | null | undefined,
): TopicCoverage {
  if (!snapshot) return { covered: 0, total: 0, ratio: null };
  const total = snapshot.allTopics.length;
  const covered = snapshot.topicsCovered.filter((t) => snapshot.allTopics.includes(t)).length;
  return { covered, total, ratio: total > 0 ? covered / total : null };
}

/** Per-answer quality (0 to 10), from the decision snapshots in order. */
export function scoreTrend(snapshots: { quality: number | null }[]): number[] {
  return snapshots.map((s) => s.quality).filter((q): q is number => typeof q === 'number');
}

/** SVG path for a small sparkline. Values are scaled to 0..max (default 10). */
export function sparklinePath(values: number[], width = 80, height = 24, max = 10): string {
  if (values.length === 0) return '';
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = values.length > 1 ? i * step : width / 2;
      const y = height - (Math.min(Math.max(v, 0), max) / max) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export type ReplayTurn = {
  idx: number;
  role: 'interviewer' | 'candidate';
  text: string;
  offsetSec: number;
};

/** Seconds from the start of the recording to each turn. */
export function replayOffsets(
  turns: { idx: number; role: 'interviewer' | 'candidate'; text: string; startedAt: When }[],
  originAt?: When,
): ReplayTurn[] {
  const origin = ms(originAt) ?? ms(turns[0]?.startedAt) ?? 0;
  return turns.map((t) => ({
    idx: t.idx,
    role: t.role,
    text: t.text,
    offsetSec: Math.max(0, ((ms(t.startedAt) ?? origin) - origin) / 1000),
  }));
}

/** Index of the turn being played at `currentSec`: the last turn whose offset has been reached. */
export function activeTurnIdx(turns: ReplayTurn[], currentSec: number): number | null {
  let active: number | null = null;
  for (const t of turns) if (t.offsetSec <= currentSec + 0.05) active = t.idx;
  return active;
}
