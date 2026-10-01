import { validNuvioProgress, validNuvioWatched } from './watching-validation.ts';
import { deltaSync } from './delta-sync.ts';
import { fetchNuvioDelta, fetchNuvioProgress, fetchNuvioWatched, nuvioDeltaCursor } from './nuvio';
import type { NuvioProgress, NuvioSession, NuvioWatchedItem } from './nuvio';

export const watchedKey = (item: Pick<NuvioWatchedItem, 'content_id' | 'content_type' | 'season' | 'episode'>) =>
  item.content_id && item.content_type ? `${item.content_type}:${item.content_id}:${item.season ?? -1}:${item.episode ?? -1}` : '';

export function syncNuvioProgress(session: NuvioSession, index: number, scope: string, forceFallback = true) {
  return deltaSync<NuvioProgress>(scope, 'progress', {
    full: () => fetchNuvioProgress(session, index), cursor: () => nuvioDeltaCursor(session, index, 'watch_progress'),
    delta: (cursor, limit) => fetchNuvioDelta(session, index, 'watch_progress', cursor, limit),
    key: (entry) => entry.progress_key,
    valid: validNuvioProgress
  }, forceFallback);
}

export function syncNuvioWatched(session: NuvioSession, index: number, scope: string, forceFallback = true) {
  return deltaSync<NuvioWatchedItem>(scope, 'watched', {
    full: () => fetchNuvioWatched(session, index), cursor: () => nuvioDeltaCursor(session, index, 'watched_items'),
    delta: (cursor, limit) => fetchNuvioDelta(session, index, 'watched_items', cursor, limit), key: watchedKey,
    valid: validNuvioWatched
  }, forceFallback);
}
