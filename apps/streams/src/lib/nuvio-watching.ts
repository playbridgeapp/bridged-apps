import type { NuvioProgress, NuvioWatchedItem } from './nuvio';
import type { Meta, MetaPreview, Video } from './types';

// Nuvio marks an episode complete at 90%; Stremio retains its own cutoff.
export const NUVIO_COMPLETION_FRACTION = .90;
export type NuvioWatchingItem = MetaPreview & {
  progress: number; lastVideoId: string; lastWatched: string; nextUp?: Video;
};
type CompletedEpisode = { season: number; episode: number; watchedAt: number };
type Selection = { resume?: NuvioProgress; completed?: CompletedEpisode };
export type NuvioWatchingTarget = {
  content_id: string; content_type: 'movie' | 'series'; last_watched: number; needsEpisodes: boolean;
};
export type NuvioSeriesAction = {
  kind: 'resume' | 'next-up'; video: Video; positionMs: number; watchedAt: number;
};

export function nuvioTimestamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // Older watched-history records use YYYYMMDDHHmmss rather than epoch milliseconds.
  const compact = String(value).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    const parsed = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === `${year}-${month}-${day}T${hour}:${minute}:${second}` ? parsed : 0;
  }
  const timestamp = value < 100_000_000_000 ? value * 1000 : value;
  return timestamp <= 8_640_000_000_000_000 ? timestamp : 0;
}

function coordinates(value: { season?: number | null; episode?: number | null; video_id?: string }): { season: number; episode: number } | null {
  const parts = value.video_id?.match(/:(\d+):(\d+)$/);
  const season = value.season ?? (parts ? Number(parts[1]) : undefined);
  const episode = value.episode ?? (parts ? Number(parts[2]) : undefined);
  return Number.isInteger(season) && Number.isInteger(episode) && season! >= 0 && episode! > 0
    ? { season: season!, episode: episode! } : null;
}

function started(entry: NuvioProgress): boolean {
  return Number.isFinite(entry.position) && Number.isFinite(entry.duration) && entry.position > 0 && entry.duration > 0
    && nuvioTimestamp(entry.last_watched) > 0;
}

export function nuvioProgressComplete(entry: NuvioProgress): boolean {
  return started(entry) && entry.position >= entry.duration * NUVIO_COMPLETION_FRACTION;
}

export function nuvioEpisodeMarkedWatched(entry: NuvioProgress, watched: NuvioWatchedItem[]): boolean {
  const point = entry.content_type === 'series' ? coordinates(entry) : null;
  return watched.some((item) => item.content_id === entry.content_id && item.content_type === entry.content_type
    && (point ? item.season === point.season && item.episode === point.episode : item.season == null && item.episode == null)
    && nuvioTimestamp(item.watched_at) >= nuvioTimestamp(entry.last_watched));
}

function selection(id: string, type: string, progress: NuvioProgress[], watched: NuvioWatchedItem[]): Selection {
  const entries = progress.filter((entry) => entry.content_id === id && entry.content_type === type && started(entry))
    .sort((a, b) => nuvioTimestamp(b.last_watched) - nuvioTimestamp(a.last_watched)
      || (coordinates(b)?.season ?? 0) - (coordinates(a)?.season ?? 0)
      || (coordinates(b)?.episode ?? 0) - (coordinates(a)?.episode ?? 0));
  const latest = entries[0];
  const completed = [
    ...entries.filter(nuvioProgressComplete).flatMap((entry) => {
      const point = coordinates(entry);
      return point ? [{ ...point, watchedAt: nuvioTimestamp(entry.last_watched) }] : [];
    }),
    ...watched.filter((item) => item.content_id === id && item.content_type === type && nuvioTimestamp(item.watched_at) > 0).flatMap((item) => {
      const point = coordinates(item);
      return point ? [{ ...point, watchedAt: nuvioTimestamp(item.watched_at) }] : [];
    })
  ].sort((a, b) => b.season - a.season || b.episode - a.episode || b.watchedAt - a.watchedAt)[0];
  const resume = latest && !nuvioProgressComplete(latest) && !nuvioEpisodeMarkedWatched(latest, watched)
    && (!completed || nuvioTimestamp(latest.last_watched) > completed.watchedAt) ? latest : undefined;
  return { resume, completed };
}

function watchingStates(progress: NuvioProgress[], watched: NuvioWatchedItem[]) {
  const titles = new Map<string, { id: string; type: 'movie' | 'series'; progress: NuvioProgress[]; watched: NuvioWatchedItem[] }>();
  function title(entry: NuvioProgress | NuvioWatchedItem) {
    if (entry.content_id && (entry.content_type === 'movie' || entry.content_type === 'series')) {
      const key = `${entry.content_type}:${entry.content_id}`;
      if (!titles.has(key)) titles.set(key, { id: entry.content_id, type: entry.content_type, progress: [], watched: [] });
      return titles.get(key)!;
    }
  }
  for (const entry of progress) title(entry)?.progress.push(entry);
  for (const entry of watched) title(entry)?.watched.push(entry);
  return [...titles.values()].flatMap(({ id, type, progress, watched }) => {
    const state = selection(id, type, progress, watched);
    if (!state.resume && (type !== 'series' || !state.completed)) return [];
    return [{ state, target: { content_id: id, content_type: type,
      last_watched: state.resume ? nuvioTimestamp(state.resume.last_watched) : state.completed!.watchedAt,
      needsEpisodes: type === 'series' && !state.resume } }];
  }).sort((a, b) => b.target.last_watched - a.target.last_watched);
}

export function nuvioWatchingTargets(progress: NuvioProgress[], watched: NuvioWatchedItem[]): NuvioWatchingTarget[] {
  return watchingStates(progress, watched).map(({ target }) => target);
}

export function nuvioSeriesAction(meta: Meta, progress: NuvioProgress[], watched: NuvioWatchedItem[] = [], now = Date.now()): NuvioSeriesAction | null {
  if (meta.type !== 'series') return null;
  const state = selection(meta.id, meta.type, progress, watched);
  return seriesAction(meta, state, now);
}

function seriesAction(meta: Meta, state: Selection, now: number): NuvioSeriesAction | null {
  if (state.resume) {
    const point = coordinates(state.resume);
    const video = meta.videos?.find((video) => video.id === state.resume!.video_id)
      || meta.videos?.find((video) => point && video.season === point.season && video.episode === point.episode)
      || { id: state.resume.video_id, ...point };
    return { kind: 'resume', video, positionMs: Math.floor(state.resume.position), watchedAt: nuvioTimestamp(state.resume.last_watched) };
  }
  if (!state.completed) return null;
  const seed = state.completed;
  const videos = (meta.videos || []).flatMap((video) => {
    const point = coordinates({ ...video, video_id: video.id });
    return point ? [{ ...video, ...point }] : [];
  }).sort((a, b) => a.season - b.season || a.episode - b.episode);
  // Incomplete metadata must not invent an episode after an unknown seed.
  const seedIndex = videos.findIndex((video) => video.season === seed.season && video.episode === seed.episode);
  if (seedIndex < 0) return null;
  const video = videos.slice(seedIndex + 1).find((candidate) => {
    if (candidate.season < seed.season || (candidate.season === seed.season && candidate.episode <= seed.episode)) return false;
    if (candidate.season === 0 || candidate.available === false) return false;
    const release = candidate.released ? Date.parse(candidate.released) : NaN;
    if (Number.isFinite(release)) return release <= now;
    // A new season needs a known air date; same-season addons often omit dates.
    return candidate.season === seed.season;
  });
  return video ? { kind: 'next-up', video, positionMs: 0, watchedAt: seed.watchedAt } : null;
}

export function nuvioWatchingItems(progress: NuvioProgress[], watched: NuvioWatchedItem[], previews: MetaPreview[], metadata: Map<string, Meta>): NuvioWatchingItem[] {
  const known = new Map(previews.map((item) => [`${item.type}:${item.id}`, item]));
  return watchingStates(progress, watched).flatMap(({ target, state }) => {
    const key = `${target.content_type}:${target.content_id}`;
    const meta = metadata.get(key) || known.get(key);
    if (!meta) return [];
    if (meta.type === 'series') {
      const action = seriesAction(meta, state, Date.now());
      if (!action) return [];
      const point = state.resume;
      return [{ ...meta, progress: point ? Math.min(100, point.position / point.duration * 100) : 0,
        lastVideoId: action.video.id, lastWatched: new Date(action.watchedAt).toISOString(),
        nextUp: action.kind === 'next-up' ? action.video : undefined }];
    }
    const point = state.resume!;
    return [{ ...meta, progress: Math.min(100, point.position / point.duration * 100),
      lastVideoId: point.video_id, lastWatched: new Date(target.last_watched).toISOString() }];
  });
}

export function watchingCaption(item: { progress: number; nextUp?: Video }): string {
  return item.nextUp ? `Next up: S${item.nextUp.season}E${item.nextUp.episode}`
    : `${item.progress < 1 ? '<1' : Math.round(item.progress)}% watched`;
}
