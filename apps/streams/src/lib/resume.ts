import type { NuvioLibraryItem, NuvioProgress, NuvioWatchedItem } from './nuvio';
import { NUVIO_COMPLETION_FRACTION, nuvioEpisodeMarkedWatched, nuvioSeriesAction } from './nuvio-watching.ts';
import type { StremioLibraryItem } from './stremio';
import type { Meta, Video } from './types';

interface ResumePoint {
  videoId: string;
  season?: number | null;
  episode?: number | null;
  positionMs: number;
  durationMs: number;
  watchedAt: number;
  completionFraction: number;
}

function watchedAt(value: string | number | undefined): number {
  if (typeof value === 'number') return value < 100_000_000_000 ? value * 1000 : value;
  return value ? Date.parse(value) || 0 : 0;
}

function resumable(point: ResumePoint): boolean {
  return point.positionMs > 0 && point.durationMs > 0 && point.positionMs / point.durationMs < point.completionFraction;
}

function points(meta: Meta, stremio: StremioLibraryItem[], nuvio: NuvioProgress[], watched: NuvioWatchedItem[] = []): ResumePoint[] {
  const result: ResumePoint[] = nuvio
    .filter((entry) => entry.content_id === meta.id && entry.content_type === meta.type && !nuvioEpisodeMarkedWatched(entry, watched))
    .map((entry) => ({ videoId: entry.video_id, season: entry.season, episode: entry.episode,
      positionMs: entry.position, durationMs: entry.duration, watchedAt: watchedAt(entry.last_watched), completionFraction: NUVIO_COMPLETION_FRACTION }));
  const item = stremio.find((entry) => entry.id === meta.id && entry.type === meta.type);
  const state = item?.record.state as { timeOffset?: number; duration?: number } | undefined;
  if (item?.lastVideoId) {
    const episode = item.lastVideoId.match(/:(\d+):(\d+)$/);
    result.push({ videoId: item.lastVideoId,
      season: episode ? Number(episode[1]) : undefined,
      episode: episode ? Number(episode[2]) : undefined,
      positionMs: Number(state?.timeOffset) || 0, durationMs: Number(state?.duration) || 0,
      watchedAt: watchedAt(item.lastWatched), completionFraction: .95 });
  }
  return result.sort((a, b) => b.watchedAt - a.watchedAt);
}

function matchingVideo(meta: Meta, point: ResumePoint): Video | undefined {
  return meta.videos?.find((video) => video.id === point.videoId)
    || meta.videos?.find((video) => video.season === point.season && video.episode === point.episode
      && point.season != null && point.episode != null);
}

export function defaultSeason(videos: Video[] = []): number {
  const seasons = [...new Set(videos.map((video) => video.season).filter((value): value is number => value != null))].sort((a, b) => a - b);
  return seasons.includes(1) ? 1 : seasons.find((value) => value > 0) ?? seasons[0] ?? 1;
}

export function resumeEpisode(meta: Meta, stremio: StremioLibraryItem[], nuvioLibrary: NuvioLibraryItem[], nuvio: NuvioProgress[], watched: NuvioWatchedItem[] = []): Video | null {
  if (meta.type !== 'series') return null;
  const nuvioAction = nuvioSeriesAction(meta, nuvio, watched);
  const stremioPoints = points(meta, stremio, []).filter(resumable);
  const stremioAction = stremioPoints.flatMap((point) => {
    const video = matchingVideo(meta, point);
    return video ? [{ video, watchedAt: point.watchedAt }] : [];
  })[0];
  const action = [nuvioAction, stremioAction].filter((value) => value != null).sort((a, b) => b.watchedAt - a.watchedAt)[0];
  if (action) return action.video;
  for (const point of points(meta, stremio, nuvio, watched)) {
    const video = matchingVideo(meta, point);
    if (video) return video;
  }
  const fallbackIds = [stremio.find((item) => item.id === meta.id)?.lastVideoId,
    nuvioLibrary.find((item) => item.id === meta.id)?.lastVideoId];
  return fallbackIds.flatMap((id) => meta.videos?.find((video) => video.id === id) || []).at(0) || null;
}

export function resumePositionMs(meta: Meta, video: Video | null, stremio: StremioLibraryItem[], nuvio: NuvioProgress[], watched: NuvioWatchedItem[] = []): number {
  const action = nuvioSeriesAction(meta, nuvio, watched);
  const nextUp = action?.kind === 'next-up' && video && action.video.id === video.id;
  const point = points(meta, stremio, nextUp ? [] : nuvio, watched).find((candidate) => resumable(candidate) &&
    (meta.type !== 'series' || (video && (candidate.videoId === video.id ||
      (candidate.season === video.season && candidate.episode === video.episode
        && candidate.season != null && candidate.episode != null)))));
  return point && (!nextUp || point.watchedAt > action!.watchedAt) ? Math.floor(point.positionMs) : 0;
}
