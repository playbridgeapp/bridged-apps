import { STREAM_CACHE_MS } from './stream-cache.ts';
import type { Stream } from './types';

export type LookupResult<T> = { source: T; streams: Stream[]; loading: boolean; warning: string };
export type StreamLookup<T> = {
  key: string; results: LookupResult<T>[]; controller: AbortController; adopted: boolean;
  restoring: boolean; complete: boolean; expiresAt: number; promise: Promise<void>; listeners: Set<() => void>;
};

/** Detail and Play share ownership of a lookup. Only an unadopted prefetch is cancelled on departure. */
export class StreamLookups<T extends { key: string }> {
  private entries = new Map<string, StreamLookup<T>>();
  private active = 0;
  private queue: (() => void)[] = [];
  private clock: () => number;
  private cancelNative: () => void;
  constructor(clock: () => number = Date.now, cancelNative: () => void = () => {}) { this.clock = clock; this.cancelNative = cancelNative; }
  get(key: string): StreamLookup<T> | undefined {
    const entry = this.entries.get(key);
    if (entry && !entry.controller.signal.aborted && (!entry.complete || entry.expiresAt > this.clock())) return entry;
    this.entries.delete(key);
  }
  adopt(key: string): StreamLookup<T> | undefined { const entry = this.get(key); if (entry) entry.adopted = true; return entry; }
  start(key: string, sources: T[], load: (source: T, signal: AbortSignal, warn: (message: string) => void) => Promise<Stream[]>,
    restore?: () => Promise<T[]>): StreamLookup<T> {
    const previous = this.get(key);
    if (previous) return previous;
    const entry: StreamLookup<T> = { key, results: [], controller: new AbortController(), adopted: false, restoring: !!restore,
      complete: false, expiresAt: 0, promise: Promise.resolve(), listeners: new Set() };
    this.entries.set(key, entry);
    const notify = () => { if (!entry.controller.signal.aborted) entry.listeners.forEach((listener) => listener()); };
    const append = (sources: T[]) => {
      const seen = new Set(entry.results.map((result) => result.source.key));
      return sources.filter((source) => { if (seen.has(source.key)) return false; seen.add(source.key); return true; }).map((source) => {
        const result: LookupResult<T> = { source, streams: [], loading: true, warning: '' };
        entry.results.push(result);
        return this.run(async () => {
          if (entry.controller.signal.aborted) return;
          try { result.streams = await load(source, entry.controller.signal, (warning) => { result.warning = warning; }); }
          catch { result.warning = 'Could not load this source.'; }
          finally { result.loading = false; notify(); }
        });
      });
    };
    const pending = append(sources);
    entry.promise = (async () => {
      if (restore) {
        try { pending.push(...append(await restore())); } catch { /* Existing sources remain usable. */ }
        entry.restoring = false; notify();
      }
      await Promise.all(pending);
      if (entry.controller.signal.aborted) return;
      entry.complete = true; entry.expiresAt = this.clock() + STREAM_CACHE_MS; notify();
      while (this.entries.size > 30) {
        const oldest = [...this.entries.values()].find((value) => value.complete && value !== entry);
        if (!oldest) break;
        this.entries.delete(oldest.key);
      }
    })();
    return entry;
  }
  cancelUnadopted(): void {
    let cancelled = false;
    for (const [key, entry] of this.entries) if (!entry.adopted && !entry.complete) {
      entry.controller.abort(); entry.listeners.clear(); this.entries.delete(key); cancelled = true;
    }
    if (cancelled) this.cancelNative();
  }
  clear(): void {
    for (const entry of this.entries.values()) { entry.controller.abort(); entry.listeners.clear(); }
    this.entries.clear(); this.cancelNative();
  }
  private run(job: () => Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      const start = () => {
        this.active++;
        void job().finally(() => { this.active--; resolve(); this.queue.shift()?.(); });
      };
      if (this.active < 4) start(); else this.queue.push(start);
    });
  }
}
