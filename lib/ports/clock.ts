export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Controllable clock for tests. */
export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2026-01-01T12:00:00.000Z')) {}
  now() {
    return new Date(this.current.getTime());
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date) {
    this.current = date;
  }
}
