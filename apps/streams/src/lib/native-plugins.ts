import type { NativePluginsBridge, NativePluginsStatus, NativePluginProvider, NativeResolveRequest, NativeResolveResult, NativeResolveStream } from './types';
import { normalizePluginHeaders } from './plugin-headers.ts';

const MAX_CONCURRENT_RESOLVES = 4;
const MAX_SCRAPERS_PER_CALL = 32;

let activeResolves = 0;
interface QueuedResolve {
  resolve: () => void;
  reject: (err: Error) => void;
  generation?: number;
}
const resolveQueue: QueuedResolve[] = [];
let resolutionGeneration = 0;

export function getResolutionGeneration(): number {
  return resolutionGeneration;
}

async function acquireResolveSlot(generation?: number): Promise<() => void> {
  if (generation !== undefined && generation !== resolutionGeneration) {
    throw new Error('Resolution cancelled.');
  }

  if (activeResolves >= MAX_CONCURRENT_RESOLVES) {
    await new Promise<void>((resolve, reject) => {
      resolveQueue.push({ resolve, reject, generation });
    });
  } else {
    activeResolves += 1;
  }

  if (generation !== undefined && generation !== resolutionGeneration) {
    if (resolveQueue.length > 0) {
      const next = resolveQueue.shift()!;
      next.resolve();
    } else {
      activeResolves -= 1;
    }
    throw new Error('Resolution cancelled.');
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (resolveQueue.length > 0) {
      const next = resolveQueue.shift()!;
      next.resolve();
    } else {
      activeResolves -= 1;
    }
  };
}

export function hasNativePluginsApi(customBridge?: NativePluginsBridge | null): boolean {
  if (customBridge !== undefined) return customBridge !== null;
  if (typeof window === 'undefined') return false;
  const bridge = window.__bridgedTest?.playbridge ?? window.playbridge;
  if (!bridge) return false;
  return Boolean(bridge.plugins && typeof bridge.plugins.status === 'function' && typeof bridge.plugins.resolve === 'function');
}

export function getNativePluginsBridge(customBridge?: NativePluginsBridge | null): NativePluginsBridge | null {
  if (customBridge !== undefined) return customBridge;
  if (typeof window === 'undefined') return null;
  const bridge = window.__bridgedTest?.playbridge ?? window.playbridge;
  if (!bridge) return null;
  // If bridge.plugins exists with required methods, return it
  // Do NOT refuse plugins if capabilities.nativePlugins is temporarily 0 before delayed ready
  if (bridge.plugins && typeof bridge.plugins.status === 'function' && typeof bridge.plugins.resolve === 'function') {
    return bridge.plugins;
  }
  return null;
}

export function isNativePluginsSupported(customBridge?: NativePluginsBridge | null): boolean {
  if (customBridge !== undefined) return customBridge !== null;
  if (typeof window === 'undefined') return false;
  const bridge = window.__bridgedTest?.playbridge ?? window.playbridge;
  if (!bridge) return false;
  // If explicitly reporting capability 0 and has NO plugins object, it is a non-native store build
  if (bridge.capabilities?.nativePlugins === 0 && !bridge.plugins) return false;
  const native = getNativePluginsBridge(customBridge);
  if (!native) return false;
  const cached = statusCache.get(native);
  if (cached && !cached.value.available) {
    return false;
  }
  return Boolean(bridge.plugins && typeof bridge.plugins.status === 'function');
}

let statusRevision = 0;
const statusCache = new WeakMap<NativePluginsBridge, { value: NativePluginsStatus; timestamp: number; revision: number }>();
const inFlightStatusMap = new WeakMap<NativePluginsBridge, { promise: Promise<NativePluginsStatus | null>; revision: number }>();

export function clearNativeStatusCache(): void {
  statusRevision += 1;
}

export async function fetchNativePluginsStatus(
  customBridge?: NativePluginsBridge | null,
  forceRefresh = false
): Promise<NativePluginsStatus | null> {
  const native = getNativePluginsBridge(customBridge);
  if (!native) return null;

  const currentRevision = statusRevision;
  const cached = statusCache.get(native);
  if (!forceRefresh && cached && cached.revision === currentRevision && Date.now() - cached.timestamp < 5000) {
    return cached.value;
  }

  const existingInFlight = inFlightStatusMap.get(native);
  if (!forceRefresh && existingInFlight && existingInFlight.revision === currentRevision) {
    return existingInFlight.promise;
  }

  const promise = (async () => {
    const releaseSlot = await acquireResolveSlot();
    try {
      const status = await native.status();
      if (!status || typeof status !== 'object' || typeof status.available !== 'boolean' ||
          typeof status.enabled !== 'boolean' || !Array.isArray(status.providers)) {
        throw new Error('Device plugin status is unavailable.');
      }
      const normalized: NativePluginsStatus = {
        available: Boolean(status.available),
        enabled: Boolean(status.enabled),
        providers: Array.isArray(status.providers) ? status.providers.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const p = item as Partial<NativePluginProvider>;
          if (typeof p.repoUrl !== 'string' || typeof p.scraperId !== 'string') return [];
          return [{
            repoUrl: p.repoUrl,
            scraperId: p.scraperId,
            name: typeof p.name === 'string' && p.name ? p.name : p.scraperId,
            enabled: p.enabled === true,
            requiresApproval: p.requiresApproval !== false
          }];
        }) : []
      };
      if (currentRevision === statusRevision) {
        statusCache.set(native, { value: normalized, timestamp: Date.now(), revision: currentRevision });
      }
      return normalized;
    } finally {
      releaseSlot();
      if (inFlightStatusMap.get(native)?.revision === currentRevision) {
        inFlightStatusMap.delete(native);
      }
    }
  })();

  inFlightStatusMap.set(native, { promise, revision: currentRevision });
  return promise;
}

export function matchNativeProvider(repoUrl: string, scraperId: string, providers: NativePluginProvider[]): NativePluginProvider | undefined {
  return providers.find((p) => p.repoUrl === repoUrl && p.scraperId === scraperId);
}

export async function resolveNativePluginStreams(
  request: NativeResolveRequest,
  customBridge?: NativePluginsBridge | null
): Promise<NativeResolveResult> {
  const native = getNativePluginsBridge(customBridge);
  if (!native) throw new Error('Native plugin engine is not available on this device.');

  const callGen = resolutionGeneration;
  if (callGen !== resolutionGeneration) {
    return { streams: [], warnings: [] };
  }

  if (!request.scraperIds.length) throw new Error('No device providers selected.');
  const scraperIds = request.scraperIds;
  const chunks: string[][] = [];
  for (let i = 0; i < scraperIds.length; i += MAX_SCRAPERS_PER_CALL) {
    chunks.push(scraperIds.slice(i, i + MAX_SCRAPERS_PER_CALL));
  }

  const allStreams: NativeResolveStream[] = [];
  const allWarnings: string[] = [];

  for (const chunk of chunks) {
    if (callGen !== resolutionGeneration) {
      return { streams: allStreams, warnings: allWarnings };
    }

    let releaseSlot: (() => void) | null = null;
    try {
      releaseSlot = await acquireResolveSlot(callGen);
      if (callGen !== resolutionGeneration) {
        return { streams: allStreams, warnings: allWarnings };
      }

      // Never pass credentials, script code, or settings across the bridge.
      const payload: NativeResolveRequest = {
        repoUrl: request.repoUrl,
        scraperIds: chunk,
        tmdbId: request.tmdbId,
        mediaType: request.mediaType,
        ...(request.season != null ? { season: request.season } : {}),
        ...(request.episode != null ? { episode: request.episode } : {})
      };
      const result = await native.resolve(payload);
      if (callGen !== resolutionGeneration) {
        return { streams: allStreams, warnings: allWarnings };
      }
      if (!result || typeof result !== 'object') throw new Error('Native scraper returned an invalid response.');

      if (Array.isArray(result.streams)) {
        for (const item of result.streams) {
          if (!item || typeof item !== 'object') continue;
          const stream = item as Partial<NativeResolveStream>;
          if (typeof stream.url !== 'string' || !stream.url) continue;
          allStreams.push({
            addonName: typeof stream.addonName === 'string' ? stream.addonName : 'Device plugin',
            addonUrl: typeof stream.addonUrl === 'string' ? stream.addonUrl : `${request.repoUrl}:${chunk[0] || ''}`,
            url: stream.url,
            ...(typeof stream.name === 'string' ? { name: stream.name } : {}),
            ...(typeof stream.title === 'string' ? { title: stream.title } : {}),
            headers: normalizePluginHeaders(stream.headers)
          });
        }
      }
      if (Array.isArray(result.warnings)) {
        for (const w of result.warnings) {
          if (typeof w === 'string' && w) allWarnings.push(w);
        }
      }
    } catch (error) {
      if (callGen !== resolutionGeneration) {
        return { streams: allStreams, warnings: allWarnings };
      }
      throw error;
    } finally {
      if (releaseSlot) releaseSlot();
    }
  }

  return { streams: allStreams, warnings: allWarnings };
}

export function cancelNativeResolution(customBridge?: NativePluginsBridge | null): void {
  resolutionGeneration += 1;
  for (let i = resolveQueue.length - 1; i >= 0; i--) {
    const waiter = resolveQueue[i];
    if (waiter.generation !== undefined) {
      resolveQueue.splice(i, 1);
      waiter.reject(new Error('Resolution cancelled.'));
    }
  }
  const native = getNativePluginsBridge(customBridge);
  if (native && typeof native.cancel === 'function') {
    try {
      native.cancel();
    } catch {
      // Ignore cancellation exceptions
    }
  }
}

export async function manageDevicePlugins(customBridge?: NativePluginsBridge | null): Promise<boolean> {
  const native = getNativePluginsBridge(customBridge);
  if (!native || typeof native.manage !== 'function') {
    throw new Error('Device plugin settings are not available on this device.');
  }
  const result = await native.manage();
  return result?.opened === true;
}
