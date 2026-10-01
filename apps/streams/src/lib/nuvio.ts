import type { MetaPreview } from './types';
import { readPersistentSession, writePersistentSession } from './persistent-session';
import { objectValue, pluginPreferences, updatePluginPreference, type PluginPreferences, type ScraperPreference } from './plugin-preferences';

const SESSION_KEY = 'bridged-streams.nuvio-session.v1';
export const NUVIO_CLOUD_URL = 'https://api.nuvio.tv';
// Public client configuration published by NuvioMedia/self-host/.env.example.
export const NUVIO_CLOUD_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';

export interface NuvioSession {
  backendUrl: string;
  publishableKey: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string };
}

export interface NuvioProfile {
  profile_index: number;
  name: string;
  uses_primary_addons?: boolean;
  uses_primary_plugins?: boolean;
  pin_enabled?: boolean;
}

export interface NuvioSourceRow {
  url: string;
  name?: string;
  enabled?: boolean;
  sort_order?: number;
}

export interface NuvioLibraryItem extends MetaPreview {
  addedAt: number;
  addonBaseUrl?: string;
  progress: number;
  lastVideoId?: string;
  lastWatched?: string;
}

export interface NuvioProgress {
  progress_key: string;
  content_id: string;
  content_type: string;
  video_id: string;
  season?: number | null;
  episode?: number | null;
  position: number;
  duration: number;
  last_watched: number;
}

export interface NuvioWatchedItem {
  content_id: string;
  content_type: string;
  title?: string;
  season?: number | null;
  episode?: number | null;
  watched_at: number;
}

export function normalizeBackendUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter a valid Nuvio backend URL.');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Nuvio backend must use HTTPS outside localhost.');
  return url.toString().replace(/\/$/, '');
}

export async function discoverNuvio(raw: string): Promise<{ backendUrl: string; publishableKey: string }> {
  const base = normalizeBackendUrl(raw);
  const response = await fetch(`${base}/.well-known/nuvio`);
  if (!response.ok) throw new Error(`Nuvio discovery returned HTTP ${response.status}. Enter the public key manually.`);
  const data = await response.json() as { version?: number; service?: string; backend_url?: string; publishable_key?: string; capabilities?: { email_password_auth?: boolean } };
  if (data.version !== 1 || data.service?.toLowerCase() !== 'nuvio' || !data.publishable_key || !data.backend_url) throw new Error('This server did not return a valid Nuvio discovery document.');
  if (data.capabilities?.email_password_auth === false) throw new Error('This Nuvio backend does not support email and password sign-in.');
  return { backendUrl: normalizeBackendUrl(data.backend_url), publishableKey: data.publishable_key };
}

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const error = data as { msg?: string; message?: string; error_description?: string; error?: string };
    return error.msg || error.message || error.error_description || error.error || `Nuvio returned HTTP ${status}.`;
  }
  return `Nuvio returned HTTP ${status}.`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new NuvioApiError(errorMessage(data, response.status), response.status, objectValue(data).code);
  return data as T;
}

class NuvioApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: unknown) { super(message); }
}

// Nuvio Mobile keeps scraper controls locally. Our own platform blob lets Bridged
// Streams sync them through Nuvio without replacing native mobile or TV settings.
const PLUGIN_SETTINGS_PLATFORM = 'bridged-streams';
type SettingsSnapshot = { settings_json: Record<string, unknown>; updated_at: string | null };
async function pluginSettingsSnapshot(session: NuvioSession, profileIndex: number): Promise<SettingsSnapshot> {
  const rows = await rpc<unknown>(session, 'sync_pull_profile_settings_blob', {
    p_profile_id: profileIndex, p_platform: PLUGIN_SETTINGS_PLATFORM,
  });
  if (!Array.isArray(rows)) throw new Error('Nuvio returned invalid plugin settings.');
  const row = objectValue(rows[0]);
  return { settings_json: objectValue(row.settings_json), updated_at: typeof row.updated_at === 'string' ? row.updated_at : null };
}
function preferencesFromSnapshot(snapshot: SettingsSnapshot): PluginPreferences {
  return pluginPreferences(objectValue(objectValue(snapshot.settings_json.features).plugins).repositories);
}
export async function fetchNuvioPluginPreferences(session: NuvioSession, profileIndex: number): Promise<PluginPreferences> {
  return preferencesFromSnapshot(await pluginSettingsSnapshot(session, profileIndex));
}
const pluginSettingsWrites = new Map<string, Promise<unknown>>();
export function changeNuvioScraperPreference(session: NuvioSession, profileIndex: number, url: string, id: string,
  patch: Omit<ScraperPreference, 'id'>): Promise<PluginPreferences> {
  const scope = `${session.backendUrl}:${session.user.id}:${profileIndex}`;
  const operation = (pluginSettingsWrites.get(scope) || Promise.resolve()).catch(() => {}).then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await pluginSettingsSnapshot(session, profileIndex);
      const preferences = updatePluginPreference(preferencesFromSnapshot(snapshot), url, id, patch);
      const features = objectValue(snapshot.settings_json.features);
      const settings = { ...snapshot.settings_json, version: snapshot.settings_json.version ?? 1,
        features: { ...features, plugins: { ...objectValue(features.plugins), repositories: preferences } } };
      const body = { p_profile_id: profileIndex, p_platform: PLUGIN_SETTINGS_PLATFORM, p_settings_json: settings };
      try {
        await rpc(session, 'sync_push_profile_settings_blob_guarded', { ...body, p_expected_updated_at: snapshot.updated_at });
      } catch (error) {
        if (error instanceof NuvioApiError && error.code === '40001' && attempt < 2) continue;
        if (error instanceof NuvioApiError && error.code === 'PGRST202') {
          // Older cloud/self-host releases expose only the original settings RPC.
          await rpc(session, 'sync_push_profile_settings_blob', body);
        } else throw error;
      }
      return preferences;
    }
    throw new Error('Plugin settings changed on another device. Sync and try again.');
  });
  pluginSettingsWrites.set(scope, operation);
  void operation.finally(() => { if (pluginSettingsWrites.get(scope) === operation) pluginSettingsWrites.delete(scope); }).catch(() => {});
  return operation;
}

type AuthResponse = { access_token: string; refresh_token: string; expires_in: number; user: { id: string; email: string } };

function sessionFromAuth(backendUrl: string, publishableKey: string, data: AuthResponse): NuvioSession {
  if (!data.access_token || !data.refresh_token || !data.user?.id) throw new Error('Nuvio returned an invalid login response.');
  return { backendUrl, publishableKey, accessToken: data.access_token, refreshToken: data.refresh_token,
    expiresAt: Date.now() + Math.max(0, data.expires_in || 3600) * 1000, user: data.user };
}

export function savedNuvioSession(): NuvioSession | null {
  return readPersistentSession(SESSION_KEY, (value): value is NuvioSession => {
    if (!value || typeof value !== 'object') return false;
    const session = value as Partial<NuvioSession>;
    return typeof session.accessToken === 'string' && !!session.accessToken
      && typeof session.refreshToken === 'string' && !!session.refreshToken
      && typeof session.publishableKey === 'string' && !!session.publishableKey
      && typeof session.backendUrl === 'string' && !!session.backendUrl
      && typeof session.expiresAt === 'number' && typeof session.user?.id === 'string';
  });
}

export function saveNuvioSession(session: NuvioSession | null): void {
  writePersistentSession(SESSION_KEY, session);
}

export async function loginNuvio(rawBackend: string, key: string, email: string, password: string): Promise<NuvioSession> {
  const backendUrl = normalizeBackendUrl(rawBackend);
  const publishableKey = key.trim();
  if (!publishableKey) throw new Error('Enter the Nuvio public publishable key.');
  const response = await fetch(`${backendUrl}/auth/v1/token?grant_type=password`, { method: 'POST',
    headers: { apikey: publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }) });
  return sessionFromAuth(backendUrl, publishableKey, await responseJson<AuthResponse>(response));
}

let refreshPromise: Promise<NuvioSession> | null = null;

export async function freshNuvioSession(session: NuvioSession): Promise<NuvioSession> {
  const stored = savedNuvioSession();
  if (stored?.backendUrl === session.backendUrl && stored.user.id === session.user.id && stored.expiresAt > session.expiresAt) session = stored;
  if (Date.now() < session.expiresAt - 60_000) return session;
  if (!refreshPromise) refreshPromise = (async () => {
    const response = await fetch(`${session.backendUrl}/auth/v1/token?grant_type=refresh_token`, { method: 'POST',
      headers: { apikey: session.publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken }) });
    const refreshed = sessionFromAuth(session.backendUrl, session.publishableKey, await responseJson<AuthResponse>(response));
    if (savedNuvioSession()?.user.id === session.user.id) saveNuvioSession(refreshed);
    return refreshed;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function request<T>(session: NuvioSession, path: string, body?: Record<string, unknown>): Promise<T> {
  const current = await freshNuvioSession(session);
  const response = await fetch(`${current.backendUrl}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: current.publishableKey, authorization: `Bearer ${current.accessToken}`,
      accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return responseJson<T>(response);
}

function rpc<T>(session: NuvioSession, name: string, body: Record<string, unknown> = {}): Promise<T> {
  return request<T>(session, `/rest/v1/rpc/${name}`, body);
}

export async function fetchNuvioProfiles(session: NuvioSession): Promise<NuvioProfile[]> {
  const profiles = await rpc<unknown>(session, 'sync_pull_profiles');
  if (!Array.isArray(profiles) || !profiles.every((profile) => profile && typeof profile === 'object'
    && Number.isInteger(profile.profile_index) && typeof profile.name === 'string')) {
    throw new Error('Nuvio returned an invalid profile list. Try again.');
  }
  return (profiles as NuvioProfile[]).sort((a, b) => a.profile_index - b.profile_index);
}

export async function createNuvioPrimaryProfile(session: NuvioSession): Promise<NuvioProfile[]> {
  const existing = await fetchNuvioProfiles(session);
  if (existing.length) return existing;
  await rpc(session, 'sync_push_profiles', { p_client_max_profiles: 6, p_profiles: [{
    profile_index: 1, name: 'Main', avatar_color_hex: '#1E88E5', uses_primary_addons: false,
    uses_primary_plugins: false, avatar_id: null, avatar_url: null,
    profile_background_id: null, profile_background_url: null
  }] });
  return fetchNuvioProfiles(session);
}

export async function verifyNuvioPin(session: NuvioSession, profileIndex: number, pin: string): Promise<boolean> {
  const result = await rpc<{ unlocked?: boolean; message?: string }>(session, 'verify_profile_pin', { p_profile_id: profileIndex, p_pin: pin });
  if (!result.unlocked) throw new Error(result.message || 'The profile PIN was not accepted.');
  return true;
}

export function fetchNuvioSources(session: NuvioSession, kind: 'addons' | 'plugins', profileIndex: number): Promise<NuvioSourceRow[]> {
  return request<NuvioSourceRow[]>(session, `/rest/v1/${kind}?profile_id=eq.${profileIndex}&select=url,name,enabled,sort_order&order=sort_order.asc`);
}

function normalizedSourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    if (!url.pathname.endsWith('/manifest.json')) url.pathname = `${url.pathname.replace(/\/+$/, '')}/manifest.json`;
    return url.toString();
  } catch { return raw.trim(); }
}

export async function changeNuvioSource(session: NuvioSession, kind: 'addons' | 'plugins', profileIndex: number,
  source: { url: string; name?: string }, action: 'add' | 'remove'): Promise<void> {
  const existing = await fetchNuvioSources(session, kind, profileIndex);
  const present = existing.some((row) => normalizedSourceUrl(row.url) === normalizedSourceUrl(source.url));
  if ((action === 'add' && present) || (action === 'remove' && !present)) return;
  const next = action === 'add' ? [...existing, { url: source.url, name: source.name || '', enabled: true }]
    : existing.filter((row) => normalizedSourceUrl(row.url) !== normalizedSourceUrl(source.url));
  await pushNuvioSources(session, kind, profileIndex, next);
}

async function pushNuvioSources(session: NuvioSession, kind: 'addons' | 'plugins', profileIndex: number, rows: NuvioSourceRow[]): Promise<void> {
  const seen = new Set<string>();
  const uniqueRows = rows.filter((row) => {
    const key = normalizedSourceUrl(row.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  await rpc(session, kind === 'addons' ? 'sync_push_addons' : 'sync_push_plugins', {
    p_profile_id: profileIndex,
    [kind === 'addons' ? 'p_addons' : 'p_plugins']: uniqueRows.map((row, index) => ({
      url: row.url, name: row.name || '', enabled: row.enabled !== false, sort_order: index
    }))
  });
}

export async function setNuvioAddonEnabled(session: NuvioSession, profileIndex: number, url: string, enabled: boolean): Promise<void> {
  const rows = await fetchNuvioSources(session, 'addons', profileIndex);
  const target = rows.find((row) => normalizedSourceUrl(row.url) === normalizedSourceUrl(url));
  if (!target) throw new Error('This addon is no longer in the Nuvio profile. Sync again.');
  await pushNuvioSources(session, 'addons', profileIndex, rows.map((row) => row === target ? { ...row, enabled } : row));
}

export async function moveNuvioAddon(session: NuvioSession, profileIndex: number, url: string, direction: -1 | 1): Promise<void> {
  const allRows = await fetchNuvioSources(session, 'addons', profileIndex);
  const seen = new Set<string>();
  const rows = allRows.filter((row) => {
    const key = normalizedSourceUrl(row.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const index = rows.findIndex((row) => normalizedSourceUrl(row.url) === normalizedSourceUrl(url));
  if (index < 0) throw new Error('This addon is no longer in the Nuvio profile. Sync again.');
  const destination = index + direction;
  if (destination < 0 || destination >= rows.length) return;
  [rows[index], rows[destination]] = [rows[destination], rows[index]];
  await pushNuvioSources(session, 'addons', profileIndex, rows);
}

export async function fetchNuvioLibrary(session: NuvioSession, profileIndex: number): Promise<NuvioLibraryItem[]> {
  const result: NuvioLibraryItem[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await rpc<Array<{ content_id: string; content_type: string; name: string; poster?: string; background?: string; description?: string; release_info?: string; imdb_rating?: number; genres?: string[]; addon_base_url?: string; added_at?: number }>>(
      session, 'sync_pull_library', { p_profile_id: profileIndex, p_limit: 100, p_offset: offset });
    result.push(...page.filter((item) => item.content_type === 'movie' || item.content_type === 'series').map((item) => ({
      id: item.content_id, type: item.content_type as 'movie' | 'series', name: item.name, poster: item.poster,
      background: item.background, description: item.description, releaseInfo: item.release_info,
      imdbRating: item.imdb_rating?.toString(), genres: item.genres, addonBaseUrl: item.addon_base_url,
      addedAt: item.added_at || 0, progress: 0
    })));
    if (page.length < 100) return result;
  }
}

export async function fetchNuvioProgress(session: NuvioSession, profileIndex: number): Promise<NuvioProgress[]> {
  return rpc<NuvioProgress[]>(session, 'sync_pull_watch_progress', { p_profile_id: profileIndex });
}

export async function fetchNuvioWatched(session: NuvioSession, profileIndex: number): Promise<NuvioWatchedItem[]> {
  const result: NuvioWatchedItem[] = [];
  for (let page = 1; page <= 100; page++) {
    const items = await rpc<NuvioWatchedItem[]>(session, 'sync_pull_watched_items', {
      p_profile_id: profileIndex, p_page: page, p_page_size: 100
    });
    result.push(...items);
    if (items.length < 100) return result;
  }
  throw new Error('Nuvio watched-history pagination limit exceeded.');
}

export function decorateNuvioLibrary(items: NuvioLibraryItem[], progress: NuvioProgress[]): NuvioLibraryItem[] {
  const latest = new Map<string, NuvioProgress>();
  progress.forEach((entry) => {
    if ((latest.get(entry.content_id)?.last_watched || 0) < entry.last_watched) latest.set(entry.content_id, entry);
  });
  return items.map((item) => {
    const entry = latest.get(item.id);
    // Continue Watching uses this ratio; round only when displaying its caption.
    return entry ? { ...item, progress: entry.duration > 0 ? Math.min(100, entry.position / entry.duration * 100) : 0,
      lastVideoId: entry.video_id, lastWatched: new Date(entry.last_watched).toISOString() } : item;
  });
}

export function pushNuvioLibraryItem(session: NuvioSession, profileIndex: number, item: MetaPreview): Promise<unknown> {
  return rpc(session, 'sync_push_library_items', { p_profile_id: profileIndex, p_items: [{
    content_id: item.id, content_type: item.type, name: item.name, poster: item.poster || null,
    poster_shape: 'POSTER', background: item.background || null, logo: null, description: item.description || null,
    release_info: item.releaseInfo || null, imdb_rating: Number(item.imdbRating) || null, genres: item.genres || [],
    addon_base_url: null, added_at: Date.now()
  }] });
}

export function deleteNuvioLibraryItem(session: NuvioSession, profileIndex: number, item: MetaPreview): Promise<unknown> {
  return rpc(session, 'sync_delete_library_items', { p_profile_id: profileIndex,
    p_keys: [{ content_id: item.id, content_type: item.type }] });
}

export function pushNuvioProgress(session: NuvioSession, profileIndex: number, meta: MetaPreview,
  video: { id: string; season?: number; episode?: number } | null, position: number, duration: number): Promise<unknown> {
  const progressKey = video?.season != null && video.episode != null ? `${meta.id}_s${video.season}e${video.episode}` : meta.id;
  return rpc(session, 'sync_push_watch_progress', { p_profile_id: profileIndex, p_entries: [{
    content_id: meta.id, content_type: meta.type, video_id: video?.id || meta.id,
    season: video?.season ?? null, episode: video?.episode ?? null, position: Math.floor(position),
    duration: Math.floor(duration), last_watched: Date.now(), progress_key: progressKey
  }] });
}
