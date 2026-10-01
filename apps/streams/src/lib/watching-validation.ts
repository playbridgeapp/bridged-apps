import type { NuvioProgress, NuvioWatchedItem } from './nuvio';
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const coordinate = (value: unknown) => value == null || (Number.isInteger(value) && (value as number) >= 0);
export function validNuvioProgress(value: unknown): value is NuvioProgress {
  if (!value || typeof value !== 'object') return false;
  const entry = value as NuvioProgress;
  return text(entry.progress_key) && text(entry.content_id) && text(entry.content_type)
    && typeof entry.video_id === 'string' && coordinate(entry.season) && coordinate(entry.episode)
    && Number.isFinite(entry.position) && entry.position >= 0 && Number.isFinite(entry.duration) && entry.duration >= 0
    && Number.isFinite(entry.last_watched) && entry.last_watched >= 0;
}
export function validNuvioWatched(value: unknown): value is NuvioWatchedItem {
  if (!value || typeof value !== 'object') return false;
  const entry = value as NuvioWatchedItem;
  return text(entry.content_id) && text(entry.content_type) && coordinate(entry.season) && coordinate(entry.episode)
    && Number.isFinite(entry.watched_at) && entry.watched_at >= 0;
}
