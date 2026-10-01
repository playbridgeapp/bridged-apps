import type { AddonManifest, InstalledAddon, MetaPreview } from './types';
import { readPersistentSession, writePersistentSession } from './persistent-session';

const API_BASE = 'https://api.strem.io/api/';
const SESSION_KEY = 'bridged-streams.stremio-session.v1';

export interface StremioSession {
  authKey: string;
  user: { _id: string; email: string; avatar?: string };
}

export interface StremioLibraryItem extends MetaPreview {
  progress: number;
  lastVideoId?: string;
  lastWatched?: string;
  removed: boolean;
  temp: boolean;
  record: Record<string, unknown>;
}

interface AddonDescriptor {
  transportUrl: string;
  manifest: AddonManifest;
  flags?: { official?: boolean; protected?: boolean };
}

interface ApiEnvelope<T> {
  result?: T;
  error?: { message?: string; code?: number } | string;
}

async function request<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${method}`, {
        signal: controller.signal, method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch {
      throw new Error('Could not reach Stremio. Check your network connection.');
    }
    if (!response.ok) throw new Error(`Stremio returned HTTP ${response.status}.`);
    const envelope = await response.json() as ApiEnvelope<T>;
    if (envelope.error) {
      const error = envelope.error;
      throw new Error(typeof error === 'string' ? error : error.message || 'Stremio rejected the request.');
    }
    if (envelope.result === undefined) throw new Error('Stremio returned an invalid response.');
    return envelope.result;
  } finally { clearTimeout(timeout); }
}

function validSession(value: unknown): value is StremioSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<StremioSession>;
  return typeof session.authKey === 'string' && session.authKey.length > 0
    && typeof session.user?._id === 'string' && typeof session.user?.email === 'string';
}

export function savedSession(): StremioSession | null {
  return readPersistentSession(SESSION_KEY, validSession);
}

export function saveSession(session: StremioSession | null): void {
  writePersistentSession(SESSION_KEY, session);
}

export async function login(email: string, password: string): Promise<StremioSession> {
  const result = await request<unknown>('login', { email: email.trim(), password, facebook: false });
  if (!validSession(result)) throw new Error('Stremio returned an invalid login response.');
  return result;
}

export async function loginWithKey(authKey: string): Promise<StremioSession> {
  const key = authKey.trim();
  if (!key) throw new Error('Enter a Stremio auth key.');
  const user = await request<StremioSession['user']>('getUser', { authKey: key });
  const session = { authKey: key, user };
  if (!validSession(session)) throw new Error('Stremio returned an invalid user.');
  return session;
}

export async function refreshUser(session: StremioSession): Promise<StremioSession> {
  return loginWithKey(session.authKey);
}

async function fetchAddonDescriptors(authKey: string): Promise<AddonDescriptor[]> {
  const result = await request<{ addons?: AddonDescriptor[] }>(
    'addonCollectionGet', { authKey, update: true }
  );
  if (!Array.isArray(result.addons)) throw new Error('Stremio did not return an addon collection.');
  return result.addons;
}

function usableDescriptor(descriptor: AddonDescriptor): boolean {
  const manifest = descriptor.manifest;
  const url = descriptor.transportUrl;
  if (!url || !manifest?.id || !manifest.name || !Array.isArray(manifest.resources)) return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

export async function fetchAccountAddons(authKey: string): Promise<InstalledAddon[]> {
  return (await fetchAddonDescriptors(authKey)).filter(usableDescriptor).map((descriptor) => ({
    manifestUrl: descriptor.transportUrl, manifest: descriptor.manifest, flags: descriptor.flags
  }));
}

export async function addAccountAddon(authKey: string, addon: InstalledAddon): Promise<void> {
  const descriptors = await fetchAddonDescriptors(authKey);
  if (descriptors.some((descriptor) => descriptor.transportUrl === addon.manifestUrl)) return;
  descriptors.push({ transportUrl: addon.manifestUrl, manifest: addon.manifest, flags: addon.flags || {} });
  const result = await request<{ success: boolean }>('addonCollectionSet', { authKey, addons: descriptors });
  if (result.success !== true) throw new Error('Stremio did not save the addon.');
}

export async function removeAccountAddon(authKey: string, url: string): Promise<void> {
  const descriptors = await fetchAddonDescriptors(authKey);
  const target = descriptors.find((descriptor) => descriptor.transportUrl === url);
  if (!target) return;
  if (target.flags?.protected) throw new Error('Stremio protects this addon from removal.');
  const result = await request<{ success: boolean }>('addonCollectionSet', {
    authKey, addons: descriptors.filter((descriptor) => descriptor.transportUrl !== url)
  });
  if (result.success !== true) throw new Error('Stremio did not remove the addon.');
}

export async function moveAccountAddon(authKey: string, url: string, direction: -1 | 1): Promise<void> {
  const descriptors = await fetchAddonDescriptors(authKey);
  const visible = descriptors.filter(usableDescriptor);
  const visibleIndex = visible.findIndex((descriptor) => descriptor.transportUrl === url);
  if (visibleIndex < 0) throw new Error('This addon is no longer in the Stremio account. Sync again.');
  const neighbor = visible[visibleIndex + direction];
  if (!neighbor) return;
  const index = descriptors.findIndex((descriptor) => descriptor.transportUrl === url);
  const destination = descriptors.findIndex((descriptor) => descriptor.transportUrl === neighbor.transportUrl);
  [descriptors[index], descriptors[destination]] = [descriptors[destination], descriptors[index]];
  const result = await request<{ success: boolean }>('addonCollectionSet', { authKey, addons: descriptors });
  if (result.success !== true) throw new Error('Stremio did not save the addon order.');
}

function mapLibraryItem(raw: unknown): StremioLibraryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown> & {
    _id?: string; name?: string; type?: string; poster?: string; removed?: boolean; temp?: boolean;
    state?: { timeOffset?: number; duration?: number; video_id?: string; lastWatched?: string };
  };
  if (!item._id || !item.name || (item.type !== 'movie' && item.type !== 'series')) return null;
  const offset = Number(item.state?.timeOffset) || 0;
  const duration = Number(item.state?.duration) || 0;
  return {
    id: item._id,
    name: item.name,
    type: item.type,
    poster: item.poster,
    progress: duration > 0 ? Math.min(100, Math.max(0, Math.round((offset / duration) * 100))) : 0,
    lastVideoId: item.state?.video_id,
    lastWatched: item.state?.lastWatched,
    removed: item.removed === true,
    temp: item.temp === true,
    record: item
  };
}

export async function fetchAccountLibrary(authKey: string): Promise<StremioLibraryItem[]> {
  const result = await request<unknown>('datastoreGet', { authKey, collection: 'libraryItem', ids: [], all: true });
  if (!Array.isArray(result)) throw new Error('Stremio did not return a library.');
  return result.flatMap((raw): StremioLibraryItem[] => {
    const item = mapLibraryItem(raw);
    return item ? [item] : [];
  });
}

function baseLibraryRecord(meta: MetaPreview): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    _id: meta.id, name: meta.name, type: meta.type, poster: meta.poster || null,
    posterShape: 'poster', removed: true, temp: true, _ctime: now, _mtime: now,
    behaviorHints: {}, state: {
      lastWatched: null, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0,
      timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null,
      watched: null, noNotif: false
    }
  };
}

async function putLibraryItem(authKey: string, record: Record<string, unknown>): Promise<void> {
  const result = await request<{ success: boolean }>('datastorePut', {
    authKey, collection: 'libraryItem', changes: [record]
  });
  if (result.success !== true) throw new Error('Stremio did not save the library change.');
}

export async function setLibraryMembership(
  authKey: string, meta: MetaPreview, existing: StremioLibraryItem | undefined, add: boolean
): Promise<StremioLibraryItem> {
  const record = { ...(existing?.record || baseLibraryRecord(meta)),
    name: meta.name, type: meta.type, poster: meta.poster || existing?.poster || null,
    removed: !add, temp: false, _mtime: new Date().toISOString() };
  await putLibraryItem(authKey, record);
  const item = mapLibraryItem(record);
  if (!item) throw new Error('Could not update the local library state.');
  return item;
}

export async function saveWatchProgress(
  authKey: string, meta: MetaPreview, existing: StremioLibraryItem | undefined,
  videoId: string, positionMs: number, durationMs: number, observedAt = Date.now()
): Promise<StremioLibraryItem> {
  const original = existing?.record || baseLibraryRecord(meta);
  const previous = (original.state && typeof original.state === 'object') ? original.state as Record<string, unknown> : {};
  const now = new Date(observedAt).toISOString();
  const record = { ...original, _mtime: now, state: {
    ...previous, lastWatched: now, video_id: videoId,
    timeOffset: Math.max(0, Math.floor(positionMs)),
    duration: Math.max(0, Math.floor(durationMs)),
    timeWatched: Math.max(Number(previous.timeWatched) || 0, Math.floor(positionMs))
  } };
  await putLibraryItem(authKey, record);
  const item = mapLibraryItem(record);
  if (!item) throw new Error('Could not update the local watch progress.');
  return item;
}
