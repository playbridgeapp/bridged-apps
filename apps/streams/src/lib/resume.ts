import type { NuvioLibraryItem, NuvioProgress } from './nuvio';
import type { StremioLibraryItem } from './stremio';
import type { Meta, Video } from './types';

interface ResumePoint {
  videoId: string;
  season?: number | null;
  episode?: number | null;
  positionMs: number;
  durationMs: number;
  watchedAt: number;
}

function watchedAt(value: string | number | undefined): number {
  if (typeof value === 'number') return value < 100_000_000_000 ? value * 1000 : value;
  return value ? Date.parse(value) || 0 : 0;
}

function resumable(point: ResumePoint): boolean {
  return point.positionMs > 0 && point.durationMs > 0 && point.positionMs / point.durationMs < .95;
}

function points(meta: Meta, stremio: StremioLibraryItem[], nuvio: NuvioProgress[]): ResumePoint[] {
  const result: ResumePoint[] = nuvio
    .filter((entry) => entry.content_id === meta.id && entry.content_type === meta.type)
    .map((entry) => ({ videoId: entry.video_id, season: entry.season, episode: entry.episode,
      positionMs: entry.position, durationMs: entry.duration, watchedAt: watchedAt(entry.last_watched) }));
  const item = stremio.find((entry) => entry.id === meta.id && entry.type === meta.type);
  const state = item?.record.state as { timeOffset?: number; duration?: number } | undefined;
  if (item?.lastVideoId) {
    const episode = item.lastVideoId.match(/:(\d+):(\d+)$/);
    result.push({ videoId: item.lastVideoId,
      season: episode ? Number(episode[1]) : undefined,
      episode: episode ? Number(episode[2]) : undefined,
      positionMs: Number(state?.timeOffset) || 0, durationMs: Number(state?.duration) || 0,
      watchedAt: watchedAt(item.lastWatched) });
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

export function resumeEpisode(meta: Meta, stremio: StremioLibraryItem[], nuvioLibrary: NuvioLibraryItem[], nuvio: NuvioProgress[]): Video | null {
  if (meta.type !== 'series') return null;
  for (const point of points(meta, stremio, nuvio).filter(resumable)) {
    const video = matchingVideo(meta, point);
    if (video) return video;
  }
  for (const point of points(meta, stremio, nuvio)) {
    const video = matchingVideo(meta, point);
    if (video) return video;
  }
  const fallbackIds = [stremio.find((item) => item.id === meta.id)?.lastVideoId,
    nuvioLibrary.find((item) => item.id === meta.id)?.lastVideoId];
  return fallbackIds.flatMap((id) => meta.videos?.find((video) => video.id === id) || []).at(0) || null;
}

export function resumePositionMs(meta: Meta, video: Video | null, stremio: StremioLibraryItem[], nuvio: NuvioProgress[]): number {
  const point = points(meta, stremio, nuvio).find((candidate) => resumable(candidate) &&
    (meta.type !== 'series' || (video && (candidate.videoId === video.id ||
      (candidate.season === video.season && candidate.episode === video.episode
        && candidate.season != null && candidate.episode != null)))));
  return point ? Math.floor(point.positionMs) : 0;
}
