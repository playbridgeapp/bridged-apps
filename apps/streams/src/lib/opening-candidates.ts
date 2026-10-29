import type { Stream } from './types';

/** An attempt never revisits a failed candidate or retries after the first frame/start. */
export class OpeningCandidates {
  private candidates: Stream[];
  private index = 0;
  private started = false;
  constructor(candidates: Stream[]) { this.candidates = candidates.slice(0, 3); }
  next(): Stream | undefined { return this.started ? undefined : this.candidates[this.index++]; }
  markStarted(): void { this.started = true; }
}
