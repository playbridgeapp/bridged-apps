import type { JellyfinItem, JellyfinSeason } from '../types';
import { fetchWithSWR } from './cache';

export const CLIENT_NAME = 'PlayBridge Jellyfin Web';
export const CLIENT_VERSION = '1.0.0';
export const DEVICE_NAME = 'PlayBridge Web Client';

// Generate or retrieve persistent device ID
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'pb-web-client';
  let id = localStorage.getItem('playbridge_jellyfin_device_id');
  if (!id) {
    id = 'pb-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now().toString(36);
    localStorage.setItem('playbridge_jellyfin_device_id', id);
  }
  return id;
}

export function getAuthHeader(token?: string): string {
  let auth = `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${getDeviceId()}", Version="${CLIENT_VERSION}"`;
  if (token) {
    auth += `, Token="${token}"`;
  }
  return auth;
}

export function getAuthHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Emby-Authorization': getAuthHeader(token),
    'Accept': 'application/json'
  };
  if (token) {
    headers['X-Emby-Token'] = token;
    headers['X-MediaBrowser-Token'] = token;
  }
  return headers;
}

export function cleanServerUrl(url: string): string {
  let cleaned = url.trim();
  try {
    const formatted = /^https?:\/\//i.test(cleaned) ? cleaned : `http://${cleaned}`;
    const parsed = new URL(formatted);
    const path = parsed.pathname.replace(/\/web(?:\/.*)?$/i, '').replace(/\/+$/, '');
    return `${parsed.origin}${path}`;
  } catch {
    return cleaned.replace(/\/web.*$/i, '').replace(/\/+$/, '');
  }
}

export async function pingServer(serverUrl: string): Promise<{ serverName: string; version: string; id: string }> {
  const base = cleanServerUrl(serverUrl);
  const url = `${base}/System/Info/Public`;
  const res = await fetch(url, {
    headers: {
      'X-Emby-Authorization': getAuthHeader()
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to reach Jellyfin server at ${base} (HTTP ${res.status}: ${res.statusText})`);
  }
  const data = await res.json();
  return {
    serverName: data.ServerName || 'Jellyfin Server',
    version: data.Version || '',
    id: data.Id || ''
  };
}

export async function authenticateByName(
  serverUrl: string,
  username: string,
  password = ''
): Promise<{ token: string; userId: string; serverId: string; username: string }> {
  const base = cleanServerUrl(serverUrl);
  const url = `${base}/Users/AuthenticateByName`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': getAuthHeader()
    },
    body: JSON.stringify({
      Username: username,
      Pw: password
    })
  });
  if (!res.ok) {
    let errorMsg = `Login failed (HTTP ${res.status})`;
    try {
      const text = await res.text();
      if (text) errorMsg = text;
    } catch {}
    throw new Error(errorMsg);
  }
  const data = await res.json();
  return {
    token: data.AccessToken,
    userId: data.User.Id,
    serverId: data.ServerId,
    username: data.User.Name
  };
}

export async function validateToken(serverUrl: string, userId: string, token: string): Promise<boolean> {
  try {
    const base = cleanServerUrl(serverUrl);
    const url = `${base}/Users/${userId}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      headers: getAuthHeaders(token),
      signal: controller.signal
    });
    clearTimeout(timeout);

    // Explicit 401 Unauthorized or 403 Forbidden means token is invalid
    if (res.status === 401 || res.status === 403) {
      return false;
    }
    return true;
  } catch {
    // Network errors, timeouts, VPN lags: retain session and do NOT log out!
    return true;
  }
}

export function cacheKey(serverUrl: string, userId: string, resource: string, options: Record<string, unknown> = {}): string {
  const query = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)));
  return `${cleanServerUrl(serverUrl)}|${userId}|${resource}|${JSON.stringify(query)}`;
}

export interface UserView {
  Id: string;
  Name: string;
  CollectionType?: string; // 'movies', 'tvshows', 'music', 'boxsets', 'homevideos'
}

export async function getUserViews(
  serverUrl: string,
  userId: string,
  token: string,
  onUpdate?: (views: UserView[]) => void
): Promise<UserView[]> {
  const key = cacheKey(serverUrl, userId, 'views');
  return fetchWithSWR(
    key,
    async () => {
      const base = cleanServerUrl(serverUrl);
      const url = `${base}/Users/${userId}/Views`;
      const res = await fetch(url, {
          headers: getAuthHeaders(token)
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.Items || []).map((v: any) => ({
        Id: v.Id,
        Name: v.Name,
        CollectionType: v.CollectionType
      }));
    },
    onUpdate,
    15 * 60 * 1000 // 15 min fresh
  );
}

export async function getResumeItems(
  serverUrl: string,
  userId: string,
  token: string,
  onUpdate?: (items: JellyfinItem[]) => void
): Promise<JellyfinItem[]> {
  const key = cacheKey(serverUrl, userId, 'resume');
  return fetchWithSWR(
    key,
    async () => {
      const base = cleanServerUrl(serverUrl);
      const url = `${base}/Users/${userId}/Items/Resume?Limit=12&Recursive=true&Fields=Overview,PrimaryImageAspectRatio,ProductionYear,CommunityRating,OfficialRating,RunTimeTicks,MediaStreams,UserData,MediaSources,Artists,Album,AlbumArtist`;
      const res = await fetch(url, {
          headers: getAuthHeaders(token)
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.Items || [];
    },
    onUpdate,
    2 * 60 * 1000 // 2 min fresh
  );
}

export async function getNextUpEpisodes(
  serverUrl: string,
  userId: string,
  token: string,
  onUpdate?: (items: JellyfinItem[]) => void
): Promise<JellyfinItem[]> {
  const key = cacheKey(serverUrl, userId, 'nextup');
  return fetchWithSWR(
    key,
    async () => {
      const base = cleanServerUrl(serverUrl);
      const url = `${base}/Shows/NextUp?UserId=${userId}&Limit=16&Fields=Overview,PrimaryImageAspectRatio,ProductionYear,CommunityRating,OfficialRating,RunTimeTicks,MediaStreams,UserData,MediaSources,SeriesName,SeasonName,IndexNumber,ParentIndexNumber`;
      const res = await fetch(url, {
          headers: getAuthHeaders(token)
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.Items || [];
    },
    onUpdate,
    2 * 60 * 1000 // 2 min fresh
  );
}

export async function getLatestMedia(
  serverUrl: string,
  userId: string,
  token: string,
  parentId?: string,
  onUpdate?: (items: JellyfinItem[]) => void
): Promise<JellyfinItem[]> {
  const key = cacheKey(serverUrl, userId, 'latest', { parentId });
  return fetchWithSWR(
    key,
    async () => {
      const base = cleanServerUrl(serverUrl);
      let url = `${base}/Users/${userId}/Items/Latest?Limit=20&Fields=Overview,PrimaryImageAspectRatio,ProductionYear,CommunityRating,OfficialRating,RunTimeTicks,MediaStreams,UserData,MediaSources,Artists,Album,AlbumArtist,SeriesName,SeasonName,IndexNumber,ParentIndexNumber`;
      if (parentId) {
        url += `&ParentId=${parentId}`;
      }
      const res = await fetch(url, {
          headers: getAuthHeaders(token)
      });
      if (!res.ok) return [];
      return await res.json();
    },
    onUpdate,
    5 * 60 * 1000 // 5 min fresh
  );
}

export function resolveUserViewPosterUrl(serverUrl: string, viewId: string): string {
  if (!serverUrl || !viewId) return '';
  const base = cleanServerUrl(serverUrl);
  return `${base}/Items/${viewId}/Images/Primary?quality=90`;
}

export async function getLibraryItems(
  serverUrl: string,
  userId: string,
  token: string,
  options: {
    parentId?: string;
    includeItemTypes?: string;
    sortBy?: string;
    sortOrder?: 'Ascending' | 'Descending';
    searchTerm?: string;
    limit?: number;
    startIndex?: number;
    genres?: string;
    recursive?: boolean;
    filters?: string;
  } = {},
  onUpdate?: (data: { items: JellyfinItem[]; totalRecordCount: number }) => void
): Promise<{ items: JellyfinItem[]; totalRecordCount: number }> {
  const key = cacheKey(serverUrl, userId, 'library', options);
  return fetchWithSWR(
    key,
    async () => {
      const base = cleanServerUrl(serverUrl);
      const isRecursive = options.recursive !== false;
      const params = new URLSearchParams({
        userId,
        Recursive: isRecursive ? 'true' : 'false',
        Fields: 'Overview,PrimaryImageAspectRatio,ProductionYear,CommunityRating,OfficialRating,RunTimeTicks,MediaStreams,Taglines,Genres,UserData,MediaSources,SeriesName,SeasonName,IndexNumber,ParentIndexNumber,Artists,Album,AlbumArtist,AlbumId',
        EnableImageTypes: 'Primary,Backdrop,Banner,Thumb',
        ImageTypeLimit: '1'
      });

      if (options.parentId) params.set('ParentId', options.parentId);
      if (options.includeItemTypes) params.set('IncludeItemTypes', options.includeItemTypes);
      if (options.sortBy) params.set('SortBy', options.sortBy);
      if (options.sortOrder) params.set('SortOrder', options.sortOrder);
      if (options.searchTerm) params.set('SearchTerm', options.searchTerm);
      if (options.limit) params.set('Limit', options.limit.toString());
      if (options.startIndex) params.set('StartIndex', options.startIndex.toString());
      if (options.genres) params.set('Genres', options.genres);
      if (options.filters) params.set('Filters', options.filters);

      const url = `${base}/Users/${userId}/Items?${params.toString()}`;
      const res = await fetch(url, {
          headers: getAuthHeaders(token)
      });
      if (!res.ok) throw new Error(`Jellyfin library request failed (HTTP ${res.status}).`);
      const data = await res.json();
      return {
        items: data.Items || [],
        totalRecordCount: data.TotalRecordCount || 0
      };
    },
    onUpdate,
    5 * 60 * 1000 // 5 min fresh
  );
}

export async function getPlayableFolderItems(
  serverUrl: string,
  userId: string,
  token: string,
  parentId: string,
  onUpdate?: (items: JellyfinItem[]) => void
): Promise<JellyfinItem[]> {
  const key = cacheKey(serverUrl, userId, 'playable', { parentId });
  return fetchWithSWR(
    key,
    async () => {
      const base = cleanServerUrl(serverUrl);
      const params = new URLSearchParams({
        userId,
        ParentId: parentId,
        Recursive: 'true',
        IncludeItemTypes: 'Audio,Movie,Episode,Video',
        SortBy: 'ParentIndexNumber,IndexNumber,SortName',
        SortOrder: 'Ascending',
        Fields: 'Overview,PrimaryImageAspectRatio,ProductionYear,CommunityRating,OfficialRating,RunTimeTicks,MediaStreams,UserData,MediaSources,SeriesName,SeasonName,IndexNumber,ParentIndexNumber,Artists,Album,AlbumArtist,AlbumId'
      });
      const res = await fetch(`${base}/Users/${userId}/Items?${params.toString()}`, {
          headers: getAuthHeaders(token)
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.Items || []).filter((i: any) => ['Audio', 'Movie', 'Episode', 'Video'].includes(i.Type));
    },
    onUpdate,
    15 * 60 * 1000 // 15 min fresh
  );
}

export async function getItemDetails(
  serverUrl: string,
  userId: string,
  token: string,
  itemId: string
): Promise<JellyfinItem | null> {
  const key = cacheKey(serverUrl, userId, 'item', { itemId });
  return fetchWithSWR(
    key,
    async () => {
      const base = cleanServerUrl(serverUrl);
      const url = `${base}/Users/${userId}/Items/${itemId}`;
      const res = await fetch(url, {
          headers: getAuthHeaders(token)
      });
      if (!res.ok) return null;
      return await res.json();
    },
    undefined,
    15 * 60 * 1000
  );
}

export async function getSeasons(
  serverUrl: string,
  userId: string,
  token: string,
  seriesId: string,
  onUpdate?: (seasons: JellyfinSeason[]) => void
): Promise<JellyfinSeason[]> {
  const key = cacheKey(serverUrl, userId, 'seasons', { seriesId });
  return fetchWithSWR(
    key,
    async () => {
      const base = cleanServerUrl(serverUrl);
      const url = `${base}/Shows/${seriesId}/Seasons?userId=${userId}&Fields=Overview,PrimaryImageAspectRatio`;
      const res = await fetch(url, {
          headers: getAuthHeaders(token)
      });
      if (!res.ok) return [];
      const data = await res.json();
      const rawSeasons: any[] = data.Items || [];

      const seasonsWithEpisodes: JellyfinSeason[] = await Promise.all(
        rawSeasons.map(async (s) => {
          const epUrl = `${base}/Shows/${seriesId}/Episodes?seasonId=${s.Id}&userId=${userId}&Fields=Overview,PrimaryImageAspectRatio,RunTimeTicks,MediaStreams,UserData,MediaSources`;
          const epRes = await fetch(epUrl, {
              headers: getAuthHeaders(token)
          });
          const epData = epRes.ok ? await epRes.json() : { Items: [] };
          return {
            Id: s.Id,
            Name: s.Name,
            IndexNumber: s.IndexNumber ?? 1,
            SeriesId: seriesId,
            Episodes: epData.Items || []
          };
        })
      );

      return seasonsWithEpisodes;
    },
    onUpdate,
    30 * 60 * 1000 // 30 min fresh
  );
}

export function buildImageUrl(
  serverUrl: string,
  itemId: string,
  token: string,
  imageType: 'Primary' | 'Backdrop' | 'Thumb' | 'Banner' = 'Primary',
  options: { tag?: string; maxWidth?: number; maxHeight?: number; quality?: number; index?: number } = {}
): string {
  const base = cleanServerUrl(serverUrl);
  const params = new URLSearchParams();
  if (token) params.set('api_key', token);
  if (options.tag) params.set('tag', options.tag);
  if (options.maxWidth) params.set('maxWidth', options.maxWidth.toString());
  if (options.maxHeight) params.set('maxHeight', options.maxHeight.toString());
  if (options.quality) params.set('quality', options.quality.toString());

  const indexPart = imageType === 'Backdrop' && options.index != null ? `/${options.index}` : '';
  const query = params.toString() ? `?${params.toString()}` : '';
  return `${base}/Items/${itemId}/Images/${imageType}${indexPart}${query}`;
}

export function buildDirectStreamUrl(
  serverUrl: string,
  itemId: string,
  token: string,
  mediaSourceId?: string,
  container?: string
): string {
  const base = cleanServerUrl(serverUrl);
  const sourceId = mediaSourceId || itemId;
  const deviceId = getDeviceId();
  const ext = container ? `.${container}` : '';
  return `${base}/Videos/${itemId}/stream${ext}?Static=true&mediaSourceId=${sourceId}&deviceId=${deviceId}&api_key=${token}`;
}

export function buildAudioStreamUrl(
  serverUrl: string,
  itemId: string,
  token: string,
  mediaSourceId?: string
): string {
  const base = cleanServerUrl(serverUrl);
  const deviceId = getDeviceId();
  const params = new URLSearchParams({ static: 'true', deviceId, api_key: token });
  if (mediaSourceId) params.set('MediaSourceId', mediaSourceId);
  return `${base}/Audio/${itemId}/stream?${params}`;
}

export function buildHlsStreamUrl(
  serverUrl: string,
  itemId: string,
  token: string,
  mediaSourceId?: string
): string {
  const base = cleanServerUrl(serverUrl);
  const sourceId = mediaSourceId || itemId;
  const deviceId = getDeviceId();
  return `${base}/Videos/${itemId}/master.m3u8?MediaSourceId=${sourceId}&DeviceId=${deviceId}&api_key=${token}&PlaySessionId=${Date.now()}`;
}

export interface PlaybackReport {
  ItemId: string;
  MediaSourceId: string;
  PlaySessionId?: string;
  PositionTicks: number;
  IsPaused: boolean;
  PlayMethod: string;
  CanSeek: boolean;
}

export async function reportPlayback(
  serverUrl: string, token: string, event: 'start' | 'progress' | 'stop', report: PlaybackReport
): Promise<void> {
  const endpoint = event === 'start' ? '' : event === 'progress' ? '/Progress' : '/Stopped';
  const res = await fetch(`${cleanServerUrl(serverUrl)}/Sessions/Playing${endpoint}`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...report, QueueableMediaTypes: ['Video', 'Audio'],
      ...(event === 'progress' ? { EventName: report.IsPaused ? 'Pause' : 'TimeUpdate' } : {}) })
  });
  if (!res.ok) throw new Error(`Playback report failed (HTTP ${res.status})`);
}

export async function toggleFavoriteItem(
  serverUrl: string,
  userId: string,
  token: string,
  itemId: string,
  isFavorite: boolean
): Promise<boolean> {
  try {
    const base = cleanServerUrl(serverUrl);
    const method = isFavorite ? 'POST' : 'DELETE';
    const url = `${base}/Users/${userId}/FavoriteItems/${itemId}`;
    const res = await fetch(url, {
      method,
        headers: getAuthHeaders(token)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getItemLyrics(
  serverUrl: string,
  token: string,
  itemId: string
): Promise<{ Lyrics?: Array<{ Text: string; Start?: number }>; Text?: string } | null> {
  try {
    const base = cleanServerUrl(serverUrl);
    const url = `${base}/Audio/${itemId}/Lyrics`;
    const res = await fetch(url, {
        headers: getAuthHeaders(token)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
