import { fetchStreams, playableStream } from './addons';
import type { CastItem, InstalledAddon, LinkedSession, Meta, PluginRepository, Stream, Video } from './types';

let activeSession: LinkedSession | null = null;
let generation = 0;

export function bridgeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.playbridge?.cast === 'function';
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
  window.playbridge!.cast(castItem(meta, stream, undefined, startPositionMs));
}

export async function stopLinkedCast(): Promise<void> {
  generation += 1;
  const session = activeSession;
  activeSession = null;
  if (session) await session.unlink();
}

function matchingStream(streams: Stream[], selected: Stream): (Stream & { url: string }) | undefined {
  const playable = streams.filter(playableStream);
  const group = selected.behaviorHints?.bingeGroup;
  return playable.find((candidate) => group && candidate.behaviorHints?.bingeGroup === group)
    || playable.find((candidate) => candidate.addonUrl === selected.addonUrl && candidate.name === selected.name)
    || playable.find((candidate) => candidate.addonUrl === selected.addonUrl)
    || playable[0];
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
    if (latest) onProgress?.({ ...latest, state: 'stopped' });
  });
}

export async function castMovie(meta: Meta, stream: Stream, startPositionMs: number,
  onProgress?: (progress: { videoId: string; positionMs: number; durationMs: number; state: string }) => void): Promise<boolean> {
  if (!playableStream(stream)) throw new Error('Choose a direct HTTP stream for casting.');
  await stopLinkedCast();
  if (!window.playbridge?.linkCast || !window.playbridge.capabilities?.linkedCast) {
    directCast(meta, stream, startPositionMs);
    return false;
  }
  const thisGeneration = generation;
  const item = castItem(meta, stream, undefined, startPositionMs);
  let session: LinkedSession;
  try {
    session = await window.playbridge.linkCast({ items: [item], startIndex: 0, metadata: metadata(meta) });
  } catch (error) {
    if ((error as { code?: string })?.code !== 'unsupported_target') throw error;
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
  onProgress?: (progress: { videoId: string; positionMs: number; durationMs: number; state: string }) => void
): Promise<void> {
  if (!playableStream(selectedStream)) throw new Error('Choose a direct HTTP stream for linked casting.');
  if (!window.playbridge?.linkCast || !window.playbridge.capabilities?.linkedCast) {
    throw new Error('This PlayBridge version does not support linked casting.');
  }
  const ordered = [...videos]
    .filter((video) => video.id && video.season != null && video.episode != null)
    .sort((a, b) => (a.season! - b.season!) || (a.episode! - b.episode!));
  const start = ordered.findIndex((video) => video.id === selectedVideo.id);
  if (start < 0) throw new Error('Episode is missing from the series metadata.');
  await stopLinkedCast();
  const thisGeneration = generation;
  const first = castItem(meta, selectedStream, selectedVideo, startPositionMs);
  const session = await window.playbridge.linkCast({ items: [first], startIndex: 0, metadata: metadata(meta) });
  if (thisGeneration !== generation) {
    await session.unlink();
    return;
  }
  activeSession = session;
  let cursor = start + 1;
  let pending = false;
  const completedRequests = new Set<string>();
  onStatus(`Linked cast started · ${first.title}`);
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
        const streams = await fetchStreams(addons, 'series', video.id, plugins, tmdbKey, onStatus);
        const match = matchingStream(streams, selectedStream);
        if (!match) {
          onStatus(`No playable stream for S${video.season}E${video.episode}. Queue ends here.`);
          break;
        }
        batch.push(castItem(meta, match, video));
        nextCursor += 1;
      }
      if (activeSession !== session) return;
      const endOfList = nextCursor >= ordered.length || batch.length < count;
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
      onStatus('Linked cast ended.');
    }
  });
  trackSessionProgress(session, onProgress);
}
