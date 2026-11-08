import { instanceUrl, videoThumbnail } from './instance.ts';
import type { CastItem, PlaybackDestination, VideoDetails, VideoSummary } from './types';

/** The single-file MP4 every receiver can play (360p). */
export const MUXED_ITAG = '18';

export type MediaPlan = { kind: 'dash' | 'hls' | 'mp4'; path: string; contentType: string };

/**
 * What to send to a destination. PlayBridge players (phone and TVs) take the
 * instance's DASH manifest for full quality; other receivers get the muxed MP4.
 * Every path points back at the instance (local=true) so no device contacts YouTube.
 */
export function mediaPlan(video: Pick<VideoDetails, 'videoId' | 'liveNow' | 'hlsUrl'>, kind: PlaybackDestination['kind'] | 'browser'): MediaPlan {
  const id = encodeURIComponent(video.videoId);
  if (video.liveNow && video.hlsUrl) {
    const live = video.hlsUrl.includes('?') ? `${video.hlsUrl}&local=true` : `${video.hlsUrl}?local=true`;
    return { kind: 'hls', path: live, contentType: 'application/vnd.apple.mpegurl' };
  }
  if (kind === 'local' || kind === 'native') {
    return { kind: 'dash', path: `/api/manifest/dash/id/${id}?local=true`, contentType: 'application/dash+xml' };
  }
  return { kind: 'mp4', path: `/latest_version?id=${id}&itag=${MUXED_ITAG}&local=true`, contentType: 'video/mp4' };
}

export function castMetadata(instance: string, video: VideoSummary & { description?: string }): Record<string, unknown> {
  return {
    title: video.title,
    artist: video.author,
    ...(video.description ? { overview: video.description.slice(0, 2000) } : {}),
    posterUrl: videoThumbnail(instance, video.videoId, video.videoThumbnails)
  };
}

export function castItem(
  instance: string,
  video: VideoDetails,
  mediaPath: string,
  plan: MediaPlan,
  startPositionMs = 0
): CastItem {
  const subtitles = (video.captions || []).slice(0, 16).map((caption) => ({
    url: instanceUrl(instance, caption.url),
    language: caption.language_code.slice(0, 64),
    label: caption.label.slice(0, 256)
  }));
  return {
    id: `iv:${video.videoId}`,
    url: instanceUrl(instance, mediaPath),
    title: video.title.slice(0, 4096),
    contentType: plan.contentType,
    metadata: castMetadata(instance, video),
    ...(subtitles.length ? { subtitleResources: subtitles } : {}),
    ...(startPositionMs > 0 ? { startPositionMs: Math.min(604_800_000, Math.floor(startPositionMs)) } : {})
  };
}

export function videoIdFromItem(id: unknown): string | null {
  return typeof id === 'string' && id.startsWith('iv:') ? id.slice(3) : null;
}

/**
 * What plays after the current video: the rest of the playlist when playing
 * one, otherwise (only with [related] autoplay on) the top related video not
 * played this session.
 */
export class AutoplayQueue {
  private readonly played = new Set<string>();
  private readonly playlist: () => VideoSummary[];
  private readonly inPlaylist: boolean;
  private readonly related: boolean;
  private cursor = 0;

  /** [playlist] is read on every call, so pages loaded later extend the queue. */
  constructor(playlist: VideoSummary[] | (() => VideoSummary[]) = [], startVideoId?: string, related = true) {
    this.playlist = typeof playlist === 'function' ? playlist : () => playlist;
    this.related = related;
    const videos = this.playlist();
    this.inPlaylist = videos.length > 0;
    const start = videos.findIndex((video) => video.videoId === startVideoId);
    this.cursor = start >= 0 ? start + 1 : 0;
    if (startVideoId) this.played.add(startVideoId);
  }

  /**
   * The next video id, given the related list of the video now ending. Null at
   * the end of what's loaded; a playlist may continue once more pages load.
   */
  next(related: VideoSummary[] = []): string | null {
    if (this.inPlaylist) {
      const videos = this.playlist();
      while (this.cursor < videos.length) {
        const candidate = videos[this.cursor++];
        if (candidate?.videoId && !this.played.has(candidate.videoId)) return this.take(candidate.videoId);
      }
      return null;
    }
    if (!this.related) return null;
    const candidate = related.find((video) => video.videoId && !this.played.has(video.videoId) && !video.liveNow);
    return candidate ? this.take(candidate.videoId) : null;
  }

  private take(id: string): string {
    this.played.add(id);
    return id;
  }
}

const AUTOPLAY_KEY = 'bridged-invidious.autoplay.v1';

/** Whether related videos play after one ends. Off unless the user turns it on. */
export function loadAutoplay(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try { return storage?.getItem(AUTOPLAY_KEY) === 'on'; } catch { return false; }
}

export function saveAutoplay(enabled: boolean, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try { storage?.setItem(AUTOPLAY_KEY, enabled ? 'on' : 'off'); } catch { /* Storage may be unavailable. */ }
}

const PROGRESS_KEY = 'bridged-invidious.progress.v1';
const PROGRESS_LIMIT = 300;

export type ProgressEntry = { positionMs: number; durationMs: number; updatedAt: number; video?: VideoSummary };

/** Watch positions kept in this browser, newest first, capped at [PROGRESS_LIMIT]. */
export class ProgressStore {
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;

  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()) {
    this.storage = storage;
  }

  all(): Record<string, ProgressEntry> {
    try {
      const value = JSON.parse(this.storage?.getItem(PROGRESS_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  get(videoId: string): ProgressEntry | undefined {
    return this.all()[videoId];
  }

  /** Where to start [videoId]: the saved position unless it's near either end. */
  resumeMs(videoId: string): number {
    const entry = this.get(videoId);
    if (!entry || entry.durationMs <= 0) return 0;
    const fraction = entry.positionMs / entry.durationMs;
    return entry.positionMs > 10_000 && fraction < 0.95 ? entry.positionMs : 0;
  }

  save(videoId: string, positionMs: number, durationMs: number, video?: VideoSummary, now = Date.now()): void {
    if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || positionMs < 0 || durationMs <= 0) return;
    const entries = this.all();
    const previous = entries[videoId];
    entries[videoId] = { positionMs, durationMs, updatedAt: now, video: video ? compact(video) : previous?.video };
    const kept = Object.entries(entries).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, PROGRESS_LIMIT);
    try { this.storage?.setItem(PROGRESS_KEY, JSON.stringify(Object.fromEntries(kept))); } catch { /* Quota or private mode. */ }
  }

  /** Partly watched videos, most recent first. */
  continueWatching(limit = 20): (VideoSummary & { progress: number })[] {
    return Object.entries(this.all())
      .filter(([, entry]) => entry.video && entry.durationMs > 0 && entry.positionMs / entry.durationMs < 0.95 && entry.positionMs > 10_000)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, limit)
      .map(([, entry]) => ({ ...entry.video!, progress: entry.positionMs / entry.durationMs }));
  }
}

function compact(video: VideoSummary): VideoSummary {
  return {
    videoId: video.videoId,
    title: video.title,
    author: video.author,
    authorId: video.authorId,
    lengthSeconds: video.lengthSeconds,
    videoThumbnails: video.videoThumbnails?.filter((thumb) => thumb.quality === 'medium').slice(0, 1)
  };
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

type PlaylistVideo = VideoSummary & { index?: number };
type PlaylistPage = { videoCount?: number; videos: PlaylistVideo[] };

/**
 * A playlist loaded page by page. Invidious pages overlap, so videos merge by
 * their playlist position; loading stops once a page adds nothing new.
 */
export class PlaylistPager {
  videos: PlaylistVideo[] = [];
  done = false;
  private readonly fetchPage: (page: number) => Promise<PlaylistPage>;
  private readonly seen = new Set<string>();
  private page = 0;
  private loading: Promise<PlaylistVideo[]> | null = null;

  constructor(fetchPage: (page: number) => Promise<PlaylistPage>, first?: PlaylistPage) {
    this.fetchPage = fetchPage;
    if (first) { this.page = 1; this.add(first); }
  }

  /** Loads the next page; resolves to the videos it added. Concurrent calls share one request. */
  more(): Promise<PlaylistVideo[]> {
    if (this.done) return Promise.resolve([]);
    this.loading ??= this.fetchPage(this.page + 1)
      .then((page) => { this.page += 1; return this.add(page); })
      .finally(() => { this.loading = null; });
    return this.loading;
  }

  /** Loads pages until [videoId] is present or the playlist ends, up to [maxPages] more pages. */
  async find(videoId: string, maxPages = 12): Promise<boolean> {
    for (let pages = 0; !this.has(videoId) && !this.done && pages < maxPages; pages++) await this.more();
    return this.has(videoId);
  }

  has(videoId: string): boolean {
    return this.videos.some((video) => video.videoId === videoId);
  }

  private add(page: PlaylistPage): PlaylistVideo[] {
    const added: PlaylistVideo[] = [];
    for (const video of page.videos || []) {
      if (!video?.videoId) continue;
      const key = Number.isInteger(video.index) ? `#${video.index}` : `v:${video.videoId}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      added.push(video);
    }
    this.videos = [...this.videos, ...added].sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity));
    const complete = page.videoCount != null && this.videos.length >= page.videoCount;
    if (!added.length || complete) this.done = true;
    return added;
  }
}
