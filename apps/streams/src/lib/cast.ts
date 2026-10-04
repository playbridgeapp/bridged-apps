import { fetchAddonSubtitles } from './subtitles';
import { fetchStreams, playableStream } from './addons';
import { savedStreamSelection, selectionContext, selectNextStream } from './stream-selection';
import type { StreamSelectionContext } from './stream-selection';
import type { PlayerOpeningOrientation } from './this-device-playback';
import type { CastItem, InstalledAddon, LinkedSession, Meta, PluginRepository, Stream, Video } from './types';

export function playbackBridge() {
  return typeof window === 'undefined' ? undefined : window.__bridgedTest?.playbridge ?? window.playbridge;
}

export type PlaybackOptions = { destinationId: string; addons: InstalledAddon[]; canStart?: () => boolean; initialOrientation?: PlayerOpeningOrientation };

async function addSubtitles(item: CastItem, meta: Meta, options?: PlaybackOptions): Promise<CastItem> {
  if (!options) return item;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const { tracks } = await fetchAddonSubtitles(options.addons, meta.type, item.id, controller.signal);
    return { ...item, subtitleResources: tracks.slice(0, 16).map(({ url, language, label, headers }) => ({ url, language, label, ...(headers ? { headers } : {}) })) };
  } finally { clearTimeout(timeout); }
}

function openPlayback(payload: Record<string, unknown>, options?: PlaybackOptions): Promise<LinkedSession> {
  const bridge = playbackBridge();
  if (options) {
    if (options.canStart && !options.canStart()) throw new Error('Playback was cancelled because the selected title changed.');
    if (!bridge?.play || !bridge.capabilities?.playback) throw new Error('Update PlayBridge to use playback destinations.');
    return bridge.play({ ...payload, destinationId: options.destinationId,
      ...(options.destinationId === 'this-device' && options.initialOrientation ? { initialOrientation: options.initialOrientation } : {}) });
  }
  return bridge!.linkCast!(payload);
}

let activeSession: LinkedSession | null = null;
let generation = 0;

export function bridgeAvailable(): boolean {
  const bridge = playbackBridge();
  return typeof bridge?.cast === 'function' || typeof bridge?.play === 'function';
}

function metadata(meta: Meta, video?: Video): Record<string, unknown> {
  return {
    title: meta.name,
    ...(meta.description ? { overview: meta.description.slice(0, 2000) } : {}),
    ...(meta.poster ? { posterUrl: meta.poster } : {}),
    ...(meta.background ? { backdropUrl: meta.background } : {}),
    ...(meta.releaseInfo ? { year: meta.releaseInfo.slice(0, 4) } : {}),
    ...(meta.genres?.length ? { genres: meta.genres.slice(0, 8) } : {}),
    ...(video?.season != null ? { season: video.season } : {}),
    ...(video?.episode != null ? { episode: video.episode } : {}),
    ...(video?.title ? { episodeTitle: video.title } : {})
  };
}

function contentType(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (pathname.endsWith('.mpd')) return 'application/dash+xml';
  if (pathname.endsWith('.mkv')) return 'video/x-matroska';
  if (pathname.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

function castItem(meta: Meta, stream: Stream & { url: string }, video?: Video, startPositionMs = 0): CastItem {
  const title = video
    ? `${meta.name} · S${video.season ?? 0}E${video.episode ?? 0}${video.title ? ` · ${video.title}` : ''}`
    : meta.name;
  return {
    id: video?.id || meta.id,
    url: stream.url,
    title,
    contentType: contentType(stream.url),
    metadata: metadata(meta, video),
    ...(stream.headers ? { headers: stream.headers } : {}),
    ...(Number.isFinite(startPositionMs) && startPositionMs > 0
      ? { startPositionMs: Math.min(604_800_000, Math.floor(startPositionMs)) } : {})
  };
}

export function directCast(meta: Meta, stream: Stream, startPositionMs = 0): void {
  if (!playableStream(stream)) throw new Error('This stream needs a native resolver or proxy before it can be cast.');
  if (!bridgeAvailable()) throw new Error('Open Bridged Streams in PlayBridge to cast.');
  playbackBridge()!.cast(castItem(meta, stream, undefined, startPositionMs));
}

export async function stopLinkedCast(): Promise<void> {
  generation += 1;
  const session = activeSession;
  activeSession = null;
  if (session) await session.unlink();
}

function trackSessionProgress(session: LinkedSession,
  onProgress?: (progress: { videoId: string; positionMs: number; durationMs: number; state: string }) => void): void {
  let latest: { videoId: string; positionMs: number; durationMs: number; state: string } | null = null;
  session.addEventListener('statechange', (event) => {
    const detail = event.detail || {};
    const index = Number(detail.currentIndex);
    const item = Array.isArray(detail.items) ? detail.items[index] : undefined;
    const videoId = typeof item?.id === 'string' ? item.id : undefined;
    const positionMs = Number(detail.positionMs);
    const durationMs = Number(detail.durationMs);
    if (activeSession === session && videoId && Number.isFinite(positionMs) && Number.isFinite(durationMs)
      && positionMs > 0 && durationMs > 0) {
      latest = { videoId, positionMs, durationMs, state: String(detail.state || '') };
      onProgress?.(latest);
    }
  });
  session.addEventListener('ended', () => {
    if (latest) onProgress?.({ ...latest, state: latest.state === 'ended' ? 'ended' : 'stopped' });
  });
}

export async function castMovie(meta: Meta, stream: Stream, startPositionMs: number,
  onProgress?: (progress: { videoId: string; positionMs: number; durationMs: number; state: string }) => void, options?: PlaybackOptions): Promise<boolean> {
  if (!playableStream(stream)) throw new Error('Choose a direct HTTP stream for casting.');
  await stopLinkedCast();
  if (!options && (!playbackBridge()?.linkCast || !playbackBridge()?.capabilities?.linkedCast)) {
    directCast(meta, stream, startPositionMs);
    return false;
  }
  const thisGeneration = generation;
  const item = await addSubtitles(castItem(meta, stream, undefined, startPositionMs), meta, options);
  let session: LinkedSession;
  try {
    session = await openPlayback({ items: [item], startIndex: 0, metadata: metadata(meta) }, options);
  } catch (error) {
    if (options || (error as { code?: string })?.code !== 'unsupported_target') throw error;
    directCast(meta, stream, startPositionMs);
    return false;
  }
  if (thisGeneration !== generation) {
    await session.unlink();
    return true;
  }
  activeSession = session;
  session.addEventListener('needitems', (event) => {
    const requestId = event.detail?.requestId;
    if (activeSession === session && typeof requestId === 'string') {
      void session.provideItems(requestId, { items: [], endOfList: true }).catch(() => {});
    }
  });
  session.addEventListener('ended', () => { if (activeSession === session) activeSession = null; });
  trackSessionProgress(session, onProgress);
  return true;
}

export async function lazyCastSeries(
  meta: Meta,
  videos: Video[],
  selectedVideo: Video,
  selectedStream: Stream,
  addons: InstalledAddon[],
  plugins: PluginRepository[],
  tmdbKey: string,
  startPositionMs: number,
  onStatus: (message: string) => void,
  onProgress?: (progress: { videoId: string; positionMs: number; durationMs: number; state: string }) => void,
  selection: StreamSelectionContext = selectionContext(selectedStream, savedStreamSelection()),
  options?: PlaybackOptions
): Promise<void> {
  if (!playableStream(selectedStream)) throw new Error('Choose a direct HTTP stream for linked casting.');
  if (!options && (!playbackBridge()?.linkCast || !playbackBridge()?.capabilities?.linkedCast)) {
    throw new Error('This PlayBridge version does not support linked casting.');
  }
  const ordered = [...videos]
    .filter((video) => video.id && video.season != null && video.episode != null)
    .sort((a, b) => (a.season! - b.season!) || (a.episode! - b.episode!));
  const start = ordered.findIndex((video) => video.id === selectedVideo.id);
  if (start < 0) throw new Error('Episode is missing from the series metadata.');
  await stopLinkedCast();
  const thisGeneration = generation;
  const first = await addSubtitles(castItem(meta, selectedStream, selectedVideo, startPositionMs), meta, options);
  const session = await openPlayback({ items: [first], startIndex: 0, metadata: metadata(meta) }, options);
  if (thisGeneration !== generation) {
    await session.unlink();
    return;
  }
  activeSession = session;
  let cursor = start + 1;
  let retryVideoId: string | null = null;
  let pending = false;
  const completedRequests = new Set<string>();
  onStatus(`Playback started · ${first.title}`);
  session.addEventListener('needitems', async (event) => {
    if (pending || activeSession !== session) return;
    const requestId = event.detail?.requestId;
    const count = Math.min(10, Math.max(1, Number(event.detail?.count) || 1));
    if (typeof requestId !== 'string' || !requestId) return;
    if (completedRequests.has(requestId)) return;
    pending = true;
    const batch: CastItem[] = [];
    let nextCursor = cursor;
    try {
      while (batch.length < count && nextCursor < ordered.length) {
        const video = ordered[nextCursor];
        const streams = await fetchStreams(addons, 'series', video.id, plugins, tmdbKey, onStatus, undefined, retryVideoId === video.id);
        const match = selectNextStream(streams.filter(playableStream), selection, true);
        if (!match || !playableStream(match)) {
          retryVideoId = video.id;
          onStatus(`No matching playable stream for S${video.season}E${video.episode}. PlayBridge will retry the next episode.`);
          break;
        }
        retryVideoId = null;
        batch.push(await addSubtitles(castItem(meta, match, video), meta, options));
        nextCursor += 1;
      }
      if (activeSession !== session) return;
      // A failed/empty lookup is not the end of a series. Leave an empty demand
      // outstanding so the host retries it; partial batches can advance safely.
      const endOfList = nextCursor >= ordered.length;
      if (!batch.length && !endOfList) return;
      await session.provideItems(requestId, { items: batch, endOfList });
      completedRequests.add(requestId);
      cursor = nextCursor;
      if (batch.length) onStatus(`Queued through S${ordered[cursor - 1].season}E${ordered[cursor - 1].episode}`);
    } catch (error) {
      onStatus(`Could not load the next episode: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      pending = false;
    }
  });
  session.addEventListener('ended', () => {
    if (activeSession === session) {
      activeSession = null;
      onStatus('Playback ended.');
    }
  });
  trackSessionProgress(session, onProgress);
}
