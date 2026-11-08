import type { InvidiousApi } from './api.ts';
import { AutoplayQueue, castItem, mediaPlan, PlaylistPager, ProgressStore, videoIdFromItem } from './playback.ts';
import type { CastItem, LinkedSession, PlaybackDestination, PlaybridgeBridge, VideoDetails } from './types';

export function playbridge(): PlaybridgeBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.__bridgedTest?.playbridge ?? window.playbridge;
}

/** True when the host can play to a chosen destination (phone player or a receiver). */
export function destinationsSupported(): boolean {
  const api = playbridge();
  return !!api?.play && !!api.capabilities?.playback;
}

export function bridgeErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'not_allowed': return 'Allow this site to use your PlayBridge devices to play here.';
    case 'user_gesture_required': return 'Tap the button again to choose a device.';
    case 'session_ended': return 'The device changed before playback started. Try again.';
    case 'unsupported_queue':
    case 'unsupported_target': return 'That device can’t take this playback. Choose another device.';
    case 'invalid_request': return 'PlayBridge couldn’t read this video’s playback details.';
    default: return error instanceof Error && error.message ? error.message : 'Playback couldn’t start.';
  }
}

export async function currentDestination(): Promise<PlaybackDestination | null> {
  const api = playbridge();
  if (!api?.getPlaybackDestination || !destinationsSupported()) return null;
  const response = await api.getPlaybackDestination();
  return response.destination;
}

export async function chooseDestination(local = false): Promise<PlaybackDestination> {
  const api = playbridge();
  if (!api?.choosePlaybackDestination) throw new Error('Update PlayBridge to choose a playback destination.');
  const response = await api.choosePlaybackDestination(local ? { destinationId: 'this-device' } : undefined);
  return response.destination;
}

type SessionOptions = {
  api: InvidiousApi;
  instance: string;
  progress: ProgressStore;
  /** Play related videos after the last one; playlists continue either way. */
  autoplay: boolean;
  onWatched?: (videoId: string) => void;
  onNowPlaying?: (videoId: string) => void;
  onEnded?: () => void;
};

/** Builds the item for [video] on a destination of [kind], resolving the instance's media redirect first. */
export async function prepareItem(
  options: Pick<SessionOptions, 'api' | 'instance' | 'progress'>,
  video: VideoDetails,
  kind: PlaybackDestination['kind'],
  startPositionMs = options.progress.resumeMs(video.videoId)
): Promise<CastItem> {
  const plan = mediaPlan(video, kind);
  let path = plan.path;
  // Only the small manifest is probed: some companions stall on ranged MP4
  // requests, and every player follows the MP4 redirect itself.
  if (plan.kind === 'dash') {
    try { path = await options.api.resolveMediaPath(plan.path); } catch { /* Send the original path; receivers follow redirects too. */ }
  }
  return castItem(options.instance, video, path, plan, startPositionMs);
}

let active: { session: LinkedSession; generation: number } | null = null;
let generation = 0;

export async function stopSession(): Promise<void> {
  generation += 1;
  const current = active;
  active = null;
  if (current) await current.session.unlink().catch(() => {});
}

/**
 * Plays [video] on [destination] and keeps the session supplied with autoplay
 * items (PlayBridge players only) while this page stays open.
 */
export async function startSession(
  options: SessionOptions,
  destination: PlaybackDestination,
  video: VideoDetails,
  playlist?: PlaylistPager
): Promise<void> {
  const api = playbridge();
  if (!api?.play) throw new Error('Update PlayBridge to play on your devices.');
  if (!destination.id) throw new Error('Choose a device first.');
  await stopSession();
  const thisGeneration = generation;
  const first = await prepareItem(options, video, destination.kind);
  // The user already chose the video here, so the TV starts it without its pre-play screen.
  const session = await api.play({
    items: [first], startIndex: 0, destinationId: destination.id, metadata: first.metadata, skipPreplay: true
  });
  if (thisGeneration !== generation) {
    await session.unlink().catch(() => {});
    return;
  }
  active = { session, generation: thisGeneration };
  options.onWatched?.(video.videoId);

  const details = new Map<string, VideoDetails>([[video.videoId, video]]);
  // Continue from this video's place in the playlist, even when it's past the pages loaded so far.
  if (playlist && !playlist.has(video.videoId)) await playlist.find(video.videoId).catch(() => false);
  if (active?.session !== session) return;
  const queue = new AutoplayQueue(playlist ? () => playlist.videos : [], video.videoId, options.autoplay);
  const supplied = new Set<string>();
  let lastId = video.videoId;
  // A video whose details failed to load; tried again first on the next request.
  let retryId: string | null = null;
  let pending = false;
  let finished = destination.kind === 'external';

  session.addEventListener('needitems', async (event) => {
    const requestId = event.detail?.requestId;
    if (typeof requestId !== 'string' || pending || active?.session !== session || supplied.has(requestId)) return;
    if (finished) {
      supplied.add(requestId);
      void session.provideItems(requestId, { items: [], endOfList: true }).catch(() => {});
      return;
    }
    pending = true;
    try {
      const count = Math.min(10, Math.max(1, Number(event.detail?.count) || 1));
      const items: CastItem[] = [];
      while (items.length < count) {
        const related = details.get(lastId)?.recommendedVideos || [];
        const nextId = retryId ?? queue.next(related);
        retryId = null;
        if (!nextId) {
          // The playlist may have more pages; a failed load leaves the request for the host's retry.
          if (playlist && !playlist.done && (await playlist.more()).length) continue;
          finished = !playlist || playlist.done;
          break;
        }
        let next: VideoDetails;
        try {
          next = await options.api.video(nextId);
        } catch (error) {
          // Deleted or private videos are skipped; anything else is retried.
          if ((error as { status?: number }).status === 404 || (error as { status?: number }).status === 403) continue;
          retryId = nextId;
          if (items.length) break;
          throw error;
        }
        if (active?.session !== session) return;
        details.set(nextId, next);
        items.push(await prepareItem(options, next, destination.kind));
        lastId = nextId;
      }
      if (active?.session !== session) return;
      // A failed lookup leaves the request open so the host asks again.
      await session.provideItems(requestId, { items, endOfList: finished });
      supplied.add(requestId);
    } catch {
      /* Retried on the host's next request. */
    } finally {
      pending = false;
    }
  });

  let nowPlaying = video.videoId;
  session.addEventListener('statechange', (event) => {
    if (active?.session !== session) return;
    const detail = event.detail || {};
    const items = Array.isArray(detail.items) ? detail.items : [];
    const id = videoIdFromItem(items[Number(detail.currentIndex)]?.id);
    if (!id) return;
    if (id !== nowPlaying) {
      nowPlaying = id;
      options.onWatched?.(id);
      options.onNowPlaying?.(id);
    }
    const positionMs = Number(detail.positionMs), durationMs = Number(detail.durationMs);
    if (positionMs > 0 && durationMs > 0) options.progress.save(id, positionMs, durationMs, details.get(id));
  });
  session.addEventListener('ended', () => {
    if (active?.session === session) active = null;
    options.onEnded?.();
  });
}
