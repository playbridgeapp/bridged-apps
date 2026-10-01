import type { NuvioProgress, NuvioWatchedItem } from './nuvio';
import type { MetaPreview, Video } from './types';
import { nuvioProgressComplete, nuvioTimestamp } from './nuvio-watching.ts';

export type WatchingDismissals = Record<string, number>;
const PREFIX = 'bridged-streams.watching-dismissals.v1.';
export const titleKey = (item: Pick<MetaPreview, 'type' | 'id'>) => `${item.type}:${item.id}`;

export function watchingDismissals(scope: string): WatchingDismissals {
  try {
    const value = JSON.parse(localStorage.getItem(PREFIX + scope) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))) : {};
  } catch { return {}; }
}
export function saveWatchingDismissals(scope: string, value: WatchingDismissals): void {
  localStorage.setItem(PREFIX + scope, JSON.stringify(value));
}
export function clearWatchingDismissals(scopePrefix: string): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    for (const key of keys) if (key?.startsWith(PREFIX + scopePrefix)) localStorage.removeItem(key);
  } catch { /* unavailable storage */ }
}

export function watchingEpisodeMatches(meta: MetaPreview, video: Video | null,
  item: { content_id: string; content_type: string; season?: number | null; episode?: number | null; video_id?: string }): boolean {
  const parts = item.video_id?.match(/:(\d+):(\d+)$/);
  const season = item.season ?? (parts ? Number(parts[1]) : null);
  const episode = item.episode ?? (parts ? Number(parts[2]) : null);
  return item.content_id === meta.id && item.content_type === meta.type
    && (video ? season === video.season && episode === video.episode : season == null && episode == null);
}

export function visibleWatching(item: MetaPreview & { lastWatched?: string }, dismissals: WatchingDismissals): boolean {
  const stamp = dismissals[titleKey(item)];
  return stamp === undefined || (Date.parse(item.lastWatched || '') || 0) > stamp;
}

export function episodeWatched(meta: MetaPreview, video: Video | null, progress: NuvioProgress[], watched: NuvioWatchedItem[]): boolean {
  const matches = (item: NuvioProgress | NuvioWatchedItem) => watchingEpisodeMatches(meta, video, item);
  const point = progress.filter(matches).sort((a, b) => b.last_watched - a.last_watched)[0];
  const marker = watched.filter(matches).sort((a, b) => nuvioTimestamp(b.watched_at) - nuvioTimestamp(a.watched_at))[0];
  return !!(point && nuvioProgressComplete(point)) || !!marker;
}

export function watchedItem(meta: MetaPreview, video: Video | null, now = Date.now()): NuvioWatchedItem {
  return { content_id: meta.id, content_type: meta.type, title: video?.title || meta.name,
    season: video?.season ?? null, episode: video?.episode ?? null, watched_at: now };
}
