import type { Stream } from './types';

export const STREAM_CACHE_MS = 5 * 60_000;
const MAX_ENTRIES = 120;
type Entry = { streams?: Stream[]; expiresAt: number; pending?: Promise<Stream[]> };
const entries = new Map<string, Entry>();

export function cachedStreamLookup(key: string, load: () => Promise<Stream[]>, force = false,
  shouldCache: (streams: Stream[]) => boolean = () => true): Promise<Stream[]> {
  const previous = entries.get(key);
  if (!force && previous?.streams && previous.expiresAt > Date.now()) return Promise.resolve(previous.streams);
  if (!force && previous?.pending) return previous.pending;
  const pending = load();
  entries.set(key, { expiresAt: 0, pending });
  void pending.then((streams) => {
    if (entries.get(key)?.pending !== pending) return;
    entries.delete(key);
    if (!shouldCache(streams)) return;
    entries.set(key, { streams, expiresAt: Date.now() + STREAM_CACHE_MS });
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  }, () => {
    if (entries.get(key)?.pending === pending) entries.delete(key);
  });
  return pending;
}
