import { validNuvioProgress, validNuvioWatched } from './watching-validation.ts';
import type { MetaPreview, Video } from './types';
import type { NuvioProgress, NuvioWatchedItem } from './nuvio';

export type PlaybackWrite =
  | { kind: 'nuvio-progress'; entry: NuvioProgress; terminal?: boolean }
  | { kind: 'stremio-progress'; meta: MetaPreview; videoId: string; position: number; duration: number; terminal?: boolean }
  | { kind: 'nuvio-watched' | 'nuvio-unwatched'; items: NuvioWatchedItem[]; progressKeys: string[] }
  | { kind: 'nuvio-reset'; progressKeys: string[] }
  | { kind: 'nuvio-dismissal'; titleKey: string; stamp: number };
export type PendingPlaybackWrite = { scope: string; key: string; revision: string; observedAt: number; write: PlaybackWrite };
const STORAGE_KEY = 'bridged-streams.playback-outbox.v1';

function validWrite(value: unknown): value is PlaybackWrite {
  if (!value || typeof value !== 'object') return false;
  const write = value as PlaybackWrite;
  if (write.kind === 'nuvio-progress') return validNuvioProgress(write.entry);
  if (write.kind === 'stremio-progress') return !!write.meta && typeof write.meta.id === 'string'
    && ['movie', 'series'].includes(write.meta.type) && typeof write.meta.name === 'string' && typeof write.videoId === 'string'
    && Number.isFinite(write.position) && write.position >= 0 && Number.isFinite(write.duration) && write.duration >= 0;
  if (write.kind === 'nuvio-dismissal') return typeof write.titleKey === 'string' && Number.isFinite(write.stamp);
  if (['nuvio-watched', 'nuvio-unwatched', 'nuvio-reset'].includes(write.kind)) {
    const mutation = write as Extract<PlaybackWrite, { progressKeys: string[] }>;
    return Array.isArray(mutation.progressKeys) && mutation.progressKeys.every((key) => typeof key === 'string')
      && (mutation.kind === 'nuvio-reset' || (Array.isArray(mutation.items) && mutation.items.every(validNuvioWatched)));
  }
  return false;
}

export function pendingPlaybackWrites(): PendingPlaybackWrite[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item) => item && typeof item.scope === 'string'
      && typeof item.key === 'string' && typeof item.revision === 'string' && Number.isFinite(item.observedAt)
      && validWrite(item.write)) : [];
  } catch { return []; }
}

function save(items: PendingPlaybackWrite[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
  catch { throw new Error('Device storage is unavailable. This watching change could not be queued safely.'); }
}

export function queuePlaybackWrite(scope: string, key: string, write: PlaybackWrite, observedAt = Date.now()): PendingPlaybackWrite {
  if (!scope || !key || !Number.isFinite(observedAt) || !validWrite(write)) throw new Error('Invalid watching change.');
  const item = { scope, key, write, observedAt, revision: `${observedAt}:${Math.random()}` };
  const entries = pendingPlaybackWrites().filter((entry) => entry.scope !== scope || entry.key !== key);
  if (entries.length >= 2000) throw new Error('Too many pending watching changes. Reconnect and retry.');
  save([...entries, item]);
  return item;
}

export function acknowledgePlaybackWrite(item: PendingPlaybackWrite): void {
  save(pendingPlaybackWrites().filter((entry) => entry.revision !== item.revision));
}

export function discardPlaybackWrites(scope: string, keys?: string[]): void {
  save(pendingPlaybackWrites().filter((entry) => entry.scope !== scope || (keys && !keys.includes(entry.key))));
}

export function clearAccountPlaybackWrites(prefix: string): void {
  save(pendingPlaybackWrites().filter((entry) => !entry.scope.startsWith(prefix)));
}

export function playbackPosition(position: number, duration: number, state: string): { position: number; duration: number } | null {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || position <= 0 || duration <= 0) return null;
  // Provider error/cache-sync clips must never advance an episode.
  if (duration < 121_000) return null;
  return { position: ['ended', 'complete', 'completed'].includes(state.toLowerCase()) ? duration : Math.min(position, duration), duration };
}

export function progressEntry(meta: MetaPreview, video: Video | null, videoId: string,
  position: number, duration: number, observedAt: number): NuvioProgress {
  const parts = videoId.match(/:(\d+):(\d+)$/);
  const season = video?.season ?? (parts ? Number(parts[1]) : null);
  const episode = video?.episode ?? (parts ? Number(parts[2]) : null);
  return { progress_key: season != null && episode != null ? `${meta.id}_s${season}e${episode}` : meta.id,
    content_id: meta.id, content_type: meta.type, video_id: videoId, season, episode,
    position: Math.floor(position), duration: Math.floor(duration), last_watched: observedAt };
}
