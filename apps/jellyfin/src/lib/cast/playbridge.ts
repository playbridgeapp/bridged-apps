import { get, writable } from 'svelte/store';
import type { JellyfinItem, PlaybackDestination, PlayBridgeAPI, PlayBridgeCastPayload, PlayBridgeItem, PlayBridgeLinkSession } from '../types';
import { mediaContentType, resumePositionMs } from '../api/playback';

export interface DiagnosticLog {
  id: string;
  time: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'cast' | 'feedback';
  message: string;
  data?: unknown;
}
export const bridgeStatus = writable({ available: false, linkedCast: false, playback: false, checked: false });
export const playbackDestination = writable<PlaybackDestination | null>(null);
export const destinationBusy = writable(false);
export const playbackError = writable<string | null>(null);
export const queueError = writable<string | null>(null);
export const diagnosticLogs = writable<DiagnosticLog[]>([]);
export const activeLinkedSession = writable<PlayBridgeLinkSession | null>(null);
export const activeCastPayload = writable<unknown | null>(null);

export function playbackBridge(): PlayBridgeAPI | undefined {
  if (typeof window === 'undefined') return;
  return (window as any).__bridgedTest?.playbridge ?? window.playbridge;
}
export function supportsDestinations(): boolean {
  const api = playbackBridge();
  return !!(api?.capabilities?.playback && api.play && api.getPlaybackDestination && api.choosePlaybackDestination);
}
function safeDiagnostic(value: unknown): unknown {
  if (typeof value === 'string') return value
    .replace(/https?:\/\/[^\s"<>]+/gi, '[redacted URL]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/._=-]+/gi, '[redacted authorization]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|token|password|secret|authorization)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, '[redacted credential]');
  if (Array.isArray(value)) return value.map(safeDiagnostic);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, v]) => [key, /token|password|authorization|cookie|secret|api[_-]?key|headers|url|customData/i.test(key) ? '[redacted]' : safeDiagnostic(v)]));
  return value;
}
export function addDiagnosticLog(type: DiagnosticLog['type'], message: string, data?: unknown) {
  diagnosticLogs.update(logs => [{ id: Math.random().toString(36).slice(2, 9),
    time: new Date().toTimeString().slice(0, 8), type, message: safeDiagnostic(message) as string,
    data: safeDiagnostic(data) }, ...logs.slice(0, 99)]);
}

let destinationRequest = 0;
export async function refreshPlaybackDestination(): Promise<PlaybackDestination> {
  const api = playbackBridge();
  if (!supportsDestinations() || !api?.getPlaybackDestination) throw new Error('Update PlayBridge to choose a playback destination.');
  const request = ++destinationRequest;
  const { destination } = await api.getPlaybackDestination();
  if (request === destinationRequest) playbackDestination.set(destination);
  return destination;
}
export async function choosePlaybackDestination(local = false): Promise<void> {
  if (get(destinationBusy)) return;
  destinationBusy.set(true);
  ++destinationRequest;
  try {
    const api = playbackBridge();
    if (!api?.choosePlaybackDestination) throw new Error('Update PlayBridge to choose a playback destination.');
    const { destination } = await api.choosePlaybackDestination(local ? { destinationId: 'this-device' } : undefined);
    playbackDestination.set(destination);
    playbackError.set(null);
  } catch {
    playbackError.set('Could not choose a playback destination. Reconnect or explicitly choose This device.');
  } finally { destinationBusy.set(false); }
}

export function initPlayBridgeDetector(): () => void {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout>;
  let disposed = false;
  function check() {
    if (disposed) return;
    const api = playbackBridge();
    const available = !!(api?.cast || api?.play);
    bridgeStatus.set({ available, linkedCast: !!(api?.linkCast && api.capabilities?.linkedCast), playback: supportsDestinations(), checked: available || attempts >= 19 });
    if (available) {
      if (supportsDestinations()) void refreshPlaybackDestination().catch(() => playbackError.set('Destination unavailable. Choose a device and try again.'));
    } else if (++attempts < 20) timer = setTimeout(check, 250);
  }
  const feedback = (event: Event) => addDiagnosticLog('feedback', 'PlayBridge feedback', (event as CustomEvent).detail);
  const refresh = () => { if (!document.hidden && supportsDestinations() && !get(destinationBusy)) void refreshPlaybackDestination().catch(() => {}); };
  check();
  window.addEventListener('PlayBridgeFeedback', feedback);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => { disposed = true; clearTimeout(timer); window.removeEventListener('PlayBridgeFeedback', feedback);
    window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
}

export function formatVisualMetadata(item: JellyfinItem, posterUrl?: string, backdropUrl?: string): Record<string, unknown> {
  return { title: item.Type === 'Episode' ? item.SeriesName || item.Name : item.Name,
    ...(item.ProductionYear ? { year: String(item.ProductionYear) } : {}),
    ...(item.Overview ? { overview: item.Overview.slice(0, 2000) } : {}),
    ...(item.Genres?.length ? { genres: item.Genres.slice(0, 8) } : {}),
    ...((posterUrl || item.posterUrl) ? { posterUrl: posterUrl || item.posterUrl } : {}),
    ...((backdropUrl || item.backdropUrl) ? { backdropUrl: backdropUrl || item.backdropUrl } : {}),
    ...(item.Type === 'Episode' ? { season: item.ParentIndexNumber, episode: item.IndexNumber, episodeTitle: item.Name } : {}) };
}
export function isLocalNetworkUrl(url: string): boolean {
  try { return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$|\[::1\]$)/i.test(new URL(url).hostname); } catch { return false; }
}
export function buildSingleCastPayload(item: JellyfinItem, url: string, posterUrl?: string, backdropUrl?: string) {
  return { id: item.Id, url, title: item.Type === 'Episode' ? `S${item.ParentIndexNumber ?? 1}E${item.IndexNumber ?? 1} · ${item.Name}` : item.Name,
    contentType: mediaContentType(item.Container || new URL(url).pathname.split('.').pop(), item.Type === 'Audio'),
    startPositionMs: resumePositionMs(item), localNetwork: isLocalNetworkUrl(url), skipPreplay: item.Type === 'Audio',
    metadata: formatVisualMetadata(item, posterUrl, backdropUrl) };
}

export async function castDirect(payload: PlayBridgeCastPayload): Promise<boolean> {
  const api = playbackBridge();
  if (!api?.cast) { playbackError.set('Casting is unavailable. Open this app in PlayBridge.'); return false; }
  try {
    await api.cast(payload);
    activeCastPayload.set(safeDiagnostic(payload));
    addDiagnosticLog('success', 'Direct cast dispatched. This legacy host does not report playback progress.');
    return true;
  } catch {
    playbackError.set('Casting failed. Reconnect the receiver and try again.');
    return false;
  }
}

let generation = 0;
let releaseListeners: (() => void) | null = null;
let retryDemand: (() => Promise<void>) | null = null;
export function releaseLinkedSession(): void {
  generation++;
  const session = get(activeLinkedSession);
  releaseListeners?.(); releaseListeners = null; retryDemand = null;
  activeLinkedSession.set(null); queueError.set(null);
  if (session) void session.unlink().catch(() => addDiagnosticLog('warn', 'Could not unlink the previous native session.'));
}
export async function retryQueue(): Promise<void> { await retryDemand?.(); }

/** Resolve only the selected item initially, then supply forward items on demand. */
export async function openLinkedQueue(options: {
  count: number; startIndex: number; destinationId?: string; first: PlayBridgeItem;
  prepare: (index: number) => Promise<PlayBridgeItem>; canStart: () => boolean;
  onState: (detail: any) => void; onEnded: (detail: any) => void;
}): Promise<PlayBridgeLinkSession> {
  const ownGeneration = generation;
  const api = playbackBridge();
  const payload = { items: [options.first], startIndex: 0, localNetwork: isLocalNetworkUrl(options.first.url),
    skipPreplay: options.first.contentType?.startsWith('audio/') === true };
  if (!options.canStart()) throw new Error('Playback was cancelled.');
  const session = options.destinationId
    ? await api!.play!({ ...payload, destinationId: options.destinationId })
    : await api!.linkCast!(payload);
  if (generation !== ownGeneration || !options.canStart()) {
    await session.unlink(); throw new Error('Playback was cancelled.');
  }
  activeLinkedSession.set(session);
  activeCastPayload.set(safeDiagnostic(payload));
  let cursor = options.startIndex + 1;
  let supplying = false;
  const pending = new Map<string, number>();
  const current = () => generation === ownGeneration && get(activeLinkedSession) === session && options.canStart();
  const supply = async () => {
    if (supplying || !current()) return;
    supplying = true;
    try {
      for (const [requestId, count] of pending) {
        const batch: PlayBridgeItem[] = [];
        for (let i = cursor; i < Math.min(options.count, cursor + count); i++) {
          try { batch.push(await options.prepare(i)); } catch { break; }
          if (!current()) return;
        }
        if (!current()) return;
        if (!batch.length && cursor < options.count) {
          queueError.set('The next item could not be prepared. Retry the queue.');
          break;
        }
        try {
          await session.provideItems(requestId, { items: batch, endOfList: cursor + batch.length >= options.count });
          if (!current()) return;
          cursor += batch.length;
          pending.delete(requestId);
          queueError.set(null);
        } catch {
          queueError.set('The queue could not be supplied. Retry the queue.');
          break;
        }
      }
    } finally { supplying = false; }
  };
  retryDemand = supply;
  const need = (event: any) => {
    const { requestId, count } = event.detail || {};
    if (!requestId || !current()) return;
    pending.set(requestId, Math.max(1, Math.min(50, Number(count) || 2)));
    void supply();
  };
  const state = (event: any) => { if (current()) options.onState(event.detail || {}); };
  const ended = (event: any) => {
    if (!current()) return;
    options.onEnded(event.detail || {});
    releaseListeners?.(); releaseListeners = null; retryDemand = null;
    activeLinkedSession.set(null); queueError.set(null);
  };
  releaseListeners = () => { session.removeEventListener('needitems', need); session.removeEventListener('statechange', state); session.removeEventListener('ended', ended); };
  session.addEventListener('statechange', state);
  session.addEventListener('needitems', need);
  // Register terminal replay last, so cleanup removes every listener.
  session.addEventListener('ended', ended);
  return session;
}
