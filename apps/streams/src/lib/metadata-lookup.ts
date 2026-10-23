import type { Meta } from './types';

export const METADATA_PRIORITY_GRACE_MS = 300;
export const METADATA_DEADLINE_MS = 8000;

/** Prefer earlier providers, but never make a ready fallback wait indefinitely. */
export function lookupMetadata(
  providers: Array<(signal: AbortSignal) => Promise<Meta | null>>,
  signal?: AbortSignal,
  onUpgrade?: (meta: Meta) => void,
): Promise<Meta | null> {
  return new Promise((resolve, reject) => {
    const controllers = providers.map(() => new AbortController());
    const pending = new Set(providers.map((_, index) => index));
    const results = new Map<number, Meta>();
    const deadlines: ReturnType<typeof setTimeout>[] = [];
    let grace: ReturnType<typeof setTimeout> | undefined;
    let winner: Meta | null = null;
    let winnerIndex = Infinity;
    let delivered = false;
    let closed = false;
    const cleanup = () => {
      closed = true;
      clearTimeout(grace);
      deadlines.forEach(clearTimeout);
      controllers.forEach((controller) => controller.abort());
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      if (!delivered) reject(new DOMException('Aborted', 'AbortError'));
    };
    const deliver = () => {
      if (closed || delivered) return;
      winnerIndex = Math.min(...results.keys());
      winner = results.get(winnerIndex) || null;
      delivered = true;
      clearTimeout(grace);
      resolve(winner);
      // Only a pending higher-priority source can improve the chosen result.
      if (!onUpgrade || !winner || ![...pending].some((index) => index < winnerIndex)) cleanup();
    };
    const settled = (index: number, meta: Meta | null) => {
      if (closed || !pending.delete(index)) return;
      clearTimeout(deadlines[index]);
      if (meta) results.set(index, meta);
      if (delivered) {
        if (meta && index < winnerIndex && meta.id === winner?.id && meta.type === winner.type) {
          // Never change playback identity or replace a known episode list with an empty one.
          winner = { ...winner, ...Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined && value !== '')),
            id: winner.id, type: winner.type, videos: meta.videos?.length ? meta.videos : winner.videos };
          winnerIndex = index;
          onUpgrade?.(winner);
        }
        if (![...pending].some((candidate) => candidate < winnerIndex)) cleanup();
      } else if (results.size) {
        const first = Math.min(...results.keys());
        if (![...pending].some((candidate) => candidate < first)) deliver();
        else if (grace === undefined) grace = setTimeout(deliver, METADATA_PRIORITY_GRACE_MS);
      } else if (!pending.size) deliver();
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    if (!providers.length) { deliver(); return; }
    providers.forEach((provider, index) => {
      deadlines[index] = setTimeout(() => {
        settled(index, null);
        controllers[index].abort();
      }, METADATA_DEADLINE_MS);
      Promise.resolve().then(() => provider(controllers[index].signal))
        .then((meta) => settled(index, meta), () => settled(index, null));
    });
  });
}
