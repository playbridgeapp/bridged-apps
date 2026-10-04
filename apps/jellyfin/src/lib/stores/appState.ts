import { writable, derived, get } from 'svelte/store';
import type { JellyfinItem, ServerConfig, JellyfinSeason, SavedAccount } from '../types';
import { DEMO_MOVIES, DEMO_SHOWS, DEMO_ALL_ITEMS } from '../data/demoData';
import * as jfApi from '../api/jellyfin';
import { getCachedData, hydrateCacheFromStorage, clearAllCache, invalidateCache } from '../api/cache';
import {
  castDirect, buildSingleCastPayload, addDiagnosticLog, openLinkedQueue, releaseLinkedSession,
  activeLinkedSession, playbackBridge, supportsDestinations, playbackDestination, refreshPlaybackDestination,
  playbackError, choosePlaybackDestination
} from '../cast/playbridge';
import { preparePlayback } from '../api/playback';
import { PlaybackReporter } from '../api/playback-reporter';
import type { PlaybackSelection, PreparedPlayback } from '../types';

const STORAGE_KEY = 'playbridge_jellyfin_session';
const ACCOUNTS_KEY = 'playbridge_jellyfin_saved_accounts';

const INITIAL_SERVER: ServerConfig = {
  url: '',
  token: '',
  userId: '',
  username: '',
  serverName: '',
  isDemo: false,
  connected: false
};

export const serverConfig = writable<ServerConfig>(INITIAL_SERVER);
export const savedAccounts = writable<SavedAccount[]>([]);
export const userViews = writable<jfApi.UserView[]>([]);
export const activeTab = writable<string>('home');
export const searchQuery = writable<string>('');
export const selectedGenre = writable<string>('all');
export const sortBy = writable<string>('DateCreated');

// Jellyfin Home Sections & Per-Library Stores (Matching Official Jellyfin Web)
export const nextUpMedia = writable<JellyfinItem[]>([]);
export const libraryLatestMap = writable<Record<string, JellyfinItem[]>>({});

// Modals and drawers
export const isServerModalOpen = writable<boolean>(false);
export const isDiagnosticsOpen = writable<boolean>(false);
export const detailModalItem = writable<JellyfinItem | null>(null);
export const isQueueDrawerOpen = writable<boolean>(false);
export const isLyricsOpen = writable<boolean>(false);
export const lyricsData = writable<{ Lyrics?: Array<{ Text: string; Start?: number }>; Text?: string } | null>(null);

// Music Player Modes (Inspired by Finamp)
export const isShuffle = writable<boolean>(false);
export const repeatMode = writable<'off' | 'all' | 'one'>('off'); // 'off' | 'all' | 'one'

// Toast notification
export const activeToast = writable<{ message: string; type: 'cast' | 'info' | 'success' } | null>(null);
let toastTimeout: any;

export function showToast(message: string, type: 'cast' | 'info' | 'success' = 'cast') {
  activeToast.set({ message, type });
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    activeToast.set(null);
  }, 3500);
}

// Player state
export interface ActivePlayerState {
  isOpen: boolean; // active media session
  isExpanded: boolean; // true = full screen overlay, false = floating mini player
  item: JellyfinItem | null;
  streamUrl: string;
  isCasting: boolean;
  isLinkedCast: boolean;
  title: string;
  season?: number;
  episode?: number;
  playlist?: JellyfinItem[];
  currentIndex?: number;
  prepared?: PreparedPlayback;
  positionMs?: number;
  durationMs?: number;
  nativeState?: string;
  destinationName?: string;
}

const IDLE_PLAYER: ActivePlayerState = {
  isOpen: false,
  isExpanded: false,
  item: null,
  streamUrl: '',
  isCasting: false,
  isLinkedCast: false,
  title: '',
  playlist: [],
  currentIndex: 0
};

export const activePlayer = writable<ActivePlayerState>({ ...IDLE_PLAYER });

/** Stop in-browser / cast playback and close player chrome. Used on server switch, logout, and demo load. */
export function stopPlayback() {
  playbackGeneration++;
  playbackBusy.set(false);
  browserRecovery = null; browserRecoveryAvailable.set(false);
  browserPrefetch = null; nextBrowserPlayback.set(null);
  reporter?.stop(); reporter = null;
  releaseLinkedSession();
  activePlayer.set({ ...IDLE_PLAYER });
  isQueueDrawerOpen.set(false);
  isLyricsOpen.set(false);
  lyricsData.set(null);
  detailModalItem.set(null);
}

// Library State
export const latestMedia = writable<JellyfinItem[]>([]);
export const resumeMedia = writable<JellyfinItem[]>([]);
export const moviesList = writable<JellyfinItem[]>([]);
export const showsList = writable<JellyfinItem[]>([]);
export const allLibraryItems = writable<JellyfinItem[]>([]);
export const isLoadingLibrary = writable<boolean>(false);
export const serverError = writable<string | null>(null);

// Utility: Fisher-Yates array shuffle
export function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function getSavedAccountsFromStorage(): SavedAccount[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveAccountToList(account: SavedAccount) {
  if (typeof window === 'undefined') return;
  const current = getSavedAccountsFromStorage();
  const existingIdx = current.findIndex(
    (a) => a.id === account.id || (a.url === account.url && a.userId === account.userId)
  );
  if (existingIdx >= 0) {
    current[existingIdx] = { ...current[existingIdx], ...account, lastActive: Date.now() };
  } else {
    current.push({ ...account, lastActive: Date.now() });
  }
  savedAccounts.set(current);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(current));
}

export function removeSavedAccount(accountId: string) {
  if (typeof window === 'undefined') return;
  const current = getSavedAccountsFromStorage().filter((a) => a.id !== accountId);
  savedAccounts.set(current);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(current));

  const active = get(serverConfig);
  if (active.url && `${active.url}_${active.userId}` === accountId) {
    if (current.length > 0) {
      switchAccount(current[0]);
    } else {
      logout();
    }
  }
  showToast('Account removed', 'info');
}

function hydrateLibrary(config: ServerConfig) {
  const views = getCachedData<jfApi.UserView[]>(jfApi.cacheKey(config.url, config.userId, 'views'));
  const movies = getCachedData<{ items: JellyfinItem[] }>(jfApi.cacheKey(config.url, config.userId, 'library', { includeItemTypes: 'Movie' }));
  const shows = getCachedData<{ items: JellyfinItem[] }>(jfApi.cacheKey(config.url, config.userId, 'library', { includeItemTypes: 'Series' }));
  if (views) userViews.set(views);
  if (movies) moviesList.set(movies.items);
  if (shows) showsList.set(shows.items);
  if (movies && shows) allLibraryItems.set([...movies.items, ...shows.items]);
}

export async function switchAccount(account: SavedAccount) {
  stopPlayback();
  isLoadingLibrary.set(true);
  serverError.set(null);

  // Always reset to home view on switched server
  activeTab.set('home');

  if (account.isDemo) {
    loadDemoMode();
    return;
  }

  const config: ServerConfig = {
    url: account.url,
    token: account.token,
    userId: account.userId,
    username: account.username,
    serverName: account.serverName,
    isDemo: false,
    connected: true
  };

  serverConfig.set(config);
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  // Update last active in list
  saveAccountToList(account);

  // Clear previous server's state first
  userViews.set([]);
  latestMedia.set([]);
  resumeMedia.set([]);
  moviesList.set([]);
  showsList.set([]);
  allLibraryItems.set([]);

  nextUpMedia.set([]); libraryLatestMap.set({}); playbackSelections.set({});
  hydrateLibrary(config);

  showToast(`Switched to ${account.username} on ${account.serverName}`, 'success');
  addDiagnosticLog('success', `Switched active server to ${account.serverName} (${account.username})`);

  // Refresh in background
  await refreshServerLibrary(config);
}

// Initialize Session on Startup
export async function initializeSession() {
  if (typeof window === 'undefined') return;

  // Hydrate memory cache from IndexedDB
  await hydrateCacheFromStorage();

  // Load saved accounts
  const accounts = getSavedAccountsFromStorage();
  savedAccounts.set(accounts);

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const config: ServerConfig = JSON.parse(saved);
      if (config.isDemo) {
        loadDemoMode();
        return;
      }
      if (config.url && config.token && config.userId) {
        serverConfig.set(config);

        hydrateLibrary(config);

        // Validate token silently (only logs out on explicit 401/403)
        const valid = await jfApi.validateToken(config.url, config.userId, config.token);
        if (get(serverConfig) !== config) return;
        if (valid) {
          addDiagnosticLog('success', `Restored active Jellyfin session: ${config.serverName} (${config.username})`);
          await refreshServerLibrary(config);
        } else {
          addDiagnosticLog('warn', 'Saved Jellyfin session expired (401 Unauthorized). Please sign in again.');
          logout();
        }
      }
    } catch (e) {
      console.error('Session init error:', e);
    } finally {
      isLoadingLibrary.set(false);
    }
  }
}

// Initialize demo mode
export function loadDemoMode() {
  stopPlayback();
  const config: ServerConfig = {
    url: '',
    token: '',
    userId: 'demo-user-1',
    username: 'Demo User',
    serverName: 'PlayBridge Demo Showcase',
    isDemo: true,
    connected: true
  };
  serverConfig.set(config);
  userViews.set([
    { Id: 'view-movies', Name: 'Movies', CollectionType: 'movies' },
    { Id: 'view-shows', Name: 'TV Shows', CollectionType: 'tvshows' }
  ]);
  latestMedia.set(DEMO_MOVIES);
  resumeMedia.set(DEMO_MOVIES.filter((m) => m.UserData?.PlaybackPositionTicks));
  nextUpMedia.set([
    {
      Id: 'demo-ep-next',
      Name: 'The Alibi',
      Type: 'Episode',
      SeriesName: 'Chernobyl',
      SeasonName: 'Season 1',
      IndexNumber: 2,
      ParentIndexNumber: 1,
      RunTimeTicks: 36000000000,
      Overview: 'With millions of people at risk, Ulana Khomyuk investigates the causes of the explosion.',
      posterUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
      backdropUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1600&auto=format&fit=crop&q=80',
      UserData: { PlaybackPositionTicks: 0, Played: false }
    }
  ]);
  libraryLatestMap.set({
    'view-movies': DEMO_MOVIES,
    'view-shows': DEMO_SHOWS
  });
  moviesList.set(DEMO_MOVIES);
  showsList.set(DEMO_SHOWS);
  allLibraryItems.set(DEMO_ALL_ITEMS);
  serverError.set(null);
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }
  addDiagnosticLog('info', 'Loaded built-in Demo media library');
}

// Connect to live Jellyfin Server
export async function connectToJellyfinServer(serverUrl: string, username: string, password = '', rememberMe = true) {
  stopPlayback();
  isLoadingLibrary.set(true);
  serverError.set(null);
  try {
    const cleanUrl = jfApi.cleanServerUrl(serverUrl);
    addDiagnosticLog('info', `Pinging Jellyfin server at ${cleanUrl}...`);
    const ping = await jfApi.pingServer(cleanUrl);

    addDiagnosticLog('info', `Authenticating user "${username}"...`);
    const auth = await jfApi.authenticateByName(cleanUrl, username, password);

    const config: ServerConfig = {
      url: cleanUrl,
      token: auth.token,
      userId: auth.userId,
      username: auth.username,
      serverName: ping.serverName,
      isDemo: false,
      connected: true
    };

    serverConfig.set(config);

    const account: SavedAccount = {
      id: `${cleanUrl}_${auth.userId}`,
      url: cleanUrl,
      token: auth.token,
      userId: auth.userId,
      username: auth.username,
      serverName: ping.serverName,
      lastActive: Date.now()
    };

    if (rememberMe && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      saveAccountToList(account);
    }
    addDiagnosticLog('success', `Connected & authenticated on Jellyfin: ${ping.serverName}`);

    // Fetch user library content with background cache warming
    await refreshServerLibrary(config);
    isServerModalOpen.set(false);
  } catch (err: any) {
    serverError.set(err.message || 'Failed to connect to Jellyfin server');
    addDiagnosticLog('error', `Connection error: ${err.message}`, err);
    throw err;
  } finally {
    isLoadingLibrary.set(false);
  }
}

export function logout() {
  stopPlayback();
  serverConfig.set(INITIAL_SERVER);
  playbackSelections.set({});
  userViews.set([]);
  latestMedia.set([]);
  resumeMedia.set([]);
  nextUpMedia.set([]);
  libraryLatestMap.set({});
  moviesList.set([]);
  showsList.set([]);
  allLibraryItems.set([]);
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
  addDiagnosticLog('info', 'Logged out from Jellyfin server');
}

export async function refreshServerLibrary(config: ServerConfig) {
  const current = () => get(serverConfig) === config;
  if (!current()) return;
  const scoped = <T>(callback: (value: T) => void) => (value: T) => { if (current()) callback(value); };
  if (config.isDemo) {
    loadDemoMode();
    return;
  }

  try {
    const [views, latest, resume, nextUp, moviesRes, showsRes] = await Promise.all([
      jfApi.getUserViews(config.url, config.userId, config.token, scoped((fresh) => userViews.set(fresh))),
      jfApi.getLatestMedia(config.url, config.userId, config.token, undefined, scoped((fresh) => latestMedia.set(fresh))),
      jfApi.getResumeItems(config.url, config.userId, config.token, scoped((fresh) => resumeMedia.set(fresh))),
      jfApi.getNextUpEpisodes(config.url, config.userId, config.token, scoped((fresh) => nextUpMedia.set(fresh))),
      jfApi.getLibraryItems(config.url, config.userId, config.token, { includeItemTypes: 'Movie' }, scoped((fresh) => moviesList.set(fresh.items))),
      jfApi.getLibraryItems(config.url, config.userId, config.token, { includeItemTypes: 'Series' }, scoped((fresh) => showsList.set(fresh.items)))
    ]);

    if (!current()) return;
    userViews.set(views);
    latestMedia.set(latest.length > 0 ? latest : moviesRes.items);
    resumeMedia.set(resume);
    nextUpMedia.set(nextUp);
    moviesList.set(moviesRes.items);
    showsList.set(showsRes.items);
    allLibraryItems.set([...moviesRes.items, ...showsRes.items, ...(latest || [])]);

    // Fetch per-library recently added in parallel for each library view
    if (views.length > 0) {
      const latestPromises = views.map(async (v) => {
        const items = await jfApi.getLatestMedia(config.url, config.userId, config.token, v.Id, (fresh) => {
          if (current()) libraryLatestMap.update((m) => ({ ...m, [v.Id]: fresh }));
        });
        return { viewId: v.Id, items };
      });
      const perLibResults = await Promise.all(latestPromises);
      const newMap: Record<string, JellyfinItem[]> = {};
      for (const res of perLibResults) {
        if (res.items && res.items.length > 0) {
          newMap[res.viewId] = res.items;
        }
      }
      if (current()) libraryLatestMap.set(newMap);
    }

    addDiagnosticLog('info', `Loaded ${views.length} libraries, ${moviesRes.items.length} movies, ${showsRes.items.length} series, and ${nextUp.length} next up episodes.`);
  } catch (err: any) {
    addDiagnosticLog('warn', `Failed to refresh server library in background: ${err.message}`);
  } finally {
    if (current()) isLoadingLibrary.set(false);
  }
}

export async function clearAppCache(fullReset = false) {
  clearAllCache();
  if (fullReset) {
    if (typeof window !== 'undefined') {
      localStorage.clear();
    }
    logout();
    showToast('App data & cache fully reset', 'info');
  } else {
    showToast('Cache cleared. Re-syncing library...', 'info');
    const config = get(serverConfig);
    if (config.connected) {
      userViews.set([]);
      latestMedia.set([]);
      resumeMedia.set([]);
      nextUpMedia.set([]);
      libraryLatestMap.set({});
      moviesList.set([]);
      showsList.set([]);
      allLibraryItems.set([]);
      await refreshServerLibrary(config);
    }
  }
}

// Open Detail View
export async function openItemDetail(item: JellyfinItem) {
  if (get(playbackBusy)) stopPlayback();
  const config = get(serverConfig);
  const request = ++detailRequest;
  detailModalItem.set(item);
  if (!config.isDemo) {
    const full = await jfApi.getItemDetails(config.url, config.userId, config.token, item.Id).catch(() => null);
    if (get(serverConfig) !== config || request !== detailRequest || get(detailModalItem)?.Id !== item.Id) return;
    if (full) item = { ...item, ...full };
  }
  if (!config.isDemo && item.Type === 'Series' && (!item.seasons || item.seasons.length === 0)) {
    try {
      const seasons = await jfApi.getSeasons(config.url, config.userId, config.token, item.Id, (fresh) => {
        item.seasons = fresh;
      });
      item.seasons = seasons;
    } catch (err) {
      console.error('Failed to load seasons', err);
    }
  } else if (!config.isDemo && (item.Type === 'MusicAlbum' || item.Type === 'Folder' || item.Type === 'Playlist') && !item.tracks) {
    try {
      const tracks = await jfApi.getPlayableFolderItems(config.url, config.userId, config.token, item.Id, (fresh) => {
        item.tracks = fresh;
      });
      item.tracks = tracks;
    } catch (err) {
      console.error('Failed to load album/folder tracks', err);
    }
  }
  if (get(serverConfig) === config && request === detailRequest && get(detailModalItem)?.Id === item.Id) detailModalItem.set(item);
}
let detailRequest = 0;

// Media Stream Resolver
export function resolveItemStreamUrl(item: JellyfinItem): string {
  const config = get(serverConfig);
  if (config.isDemo || item.streamUrl) {
    return item.streamUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
  }
  if (item.Type === 'Audio') {
    return jfApi.buildAudioStreamUrl(config.url, item.Id, config.token);
  }
  const mediaSourceId = item.MediaSources && item.MediaSources[0]?.Id;
  return jfApi.buildDirectStreamUrl(config.url, item.Id, config.token, mediaSourceId);
}

export function resolveItemPosterUrl(item: JellyfinItem): string {
  const config = get(serverConfig);
  if (config.isDemo || item.posterUrl) {
    return item.posterUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg';
  }
  return jfApi.buildImageUrl(config.url, item.Id, config.token, 'Primary', { maxWidth: 500, quality: 90 });
}

export function resolveItemBackdropUrl(item: JellyfinItem): string {
  const config = get(serverConfig);
  if (config.isDemo || item.backdropUrl) {
    return item.backdropUrl || 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1600&q=80';
  }
  if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
    return jfApi.buildImageUrl(config.url, item.Id, config.token, 'Backdrop', { maxWidth: 1920, quality: 85 });
  }
  return resolveItemPosterUrl(item);
}

// A single route for cards, details, folders, episodes, and browser/native handoff.
export const playbackBusy = writable(false);
export const browserRecoveryAvailable = writable(false);
let browserRecovery: (() => Promise<boolean>) | null = null;
export async function recoverBrowserPlayback() { await browserRecovery?.(); }
export const localPlaybackMode = writable<'browser' | 'native'>('browser');
export const playbackSelections = writable<Record<string, PlaybackSelection>>({});
export const nextBrowserPlayback = writable<PreparedPlayback | null>(null);
let browserPrefetch: {
  config: ServerConfig; queue: JellyfinItem[]; index: number; selection: string;
  generation: number; promise: Promise<PreparedPlayback>;
} | null = null;

/** Share the negotiated source between standby audio and the next queue transition. */
export function prefetchNextBrowserTrack(state: ActivePlayerState) {
  if (get(playbackBusy)) return;
  const queue = state.playlist;
  const index = (state.currentIndex ?? 0) + 1;
  if (!state.isOpen || state.isCasting || state.item?.Type !== 'Audio' || !queue?.[index] || queue[index].Type !== 'Audio') {
    browserPrefetch = null; nextBrowserPlayback.set(null); return;
  }
  const config = get(serverConfig);
  const selection = get(playbackSelections)[queue[index].Id] || {};
  const signature = JSON.stringify(selection);
  if (browserPrefetch?.config === config && browserPrefetch.queue === queue
    && browserPrefetch.index === index && browserPrefetch.selection === signature
    && browserPrefetch.generation === playbackGeneration) return;
  const pending = { config, queue, index, selection: signature, generation: playbackGeneration,
    promise: preparePlayback(config, queue[index], selection, 'browser') };
  browserPrefetch = pending; nextBrowserPlayback.set(null);
  void pending.promise.then(prepared => {
    if (browserPrefetch === pending && pending.generation === playbackGeneration && get(serverConfig) === config) {
      nextBrowserPlayback.set(prepared);
    }
  }).catch(() => {
    // Speculative failure must not interrupt the current song; Next can retry.
    if (browserPrefetch === pending) { browserPrefetch = null; nextBrowserPlayback.set(null); }
  });
}
let playbackGeneration = 0;
let reporter: PlaybackReporter | null = null;

export function recordBrowserProgress(positionMs: number, paused: boolean, force = false) {
  const state = get(activePlayer);
  if (!state.isOpen || state.isCasting) return;
  reporter?.update(positionMs, paused, force);
}
export function recordBrowserStopped() { reporter?.stop(); reporter = null; }

function createReporter(config: ServerConfig, item: JellyfinItem, prepared: PreparedPlayback) {
  return new PlaybackReporter(config, item, prepared, () => {
    invalidateCache(jfApi.cacheKey(config.url, config.userId, 'resume'));
    invalidateCache(jfApi.cacheKey(config.url, config.userId, 'nextup'));
    if (get(serverConfig) !== config || config.isDemo) return;
    void Promise.all([
      jfApi.getResumeItems(config.url, config.userId, config.token),
      jfApi.getNextUpEpisodes(config.url, config.userId, config.token)
    ]).then(([resume, nextUp]) => {
      if (get(serverConfig) === config) { resumeMedia.set(resume); nextUpMedia.set(nextUp); }
    }).catch(() => {});
  });
}

async function resolveQueue(config: ServerConfig, item: JellyfinItem, playlist?: JellyfinItem[]) {
  const playable = (i: JellyfinItem) => ['Audio', 'Movie', 'Episode', 'Video', 'MusicVideo'].includes(i.Type);
  if (playlist?.length) return playlist.filter(playable);
  if (item.Type === 'Series') {
    const seasons = item.seasons?.length ? item.seasons : config.isDemo ? [] :
      await jfApi.getSeasons(config.url, config.userId, config.token, item.Id);
    return seasons.flatMap(s => s.Episodes).filter(playable);
  }
  if (['MusicAlbum', 'Folder', 'Playlist', 'BoxSet'].includes(item.Type)) {
    return (item.tracks || (config.isDemo ? [] :
      await jfApi.getPlayableFolderItems(config.url, config.userId, config.token, item.Id))).filter(playable);
  }
  return playable(item) ? [item] : [];
}

export async function playMedia(item: JellyfinItem, playlist?: JellyfinItem[], startIndex?: number, forceExpand = false) {
  await startPlayback(item, playlist, startIndex, forceExpand, 'auto');
}
/** Explicit web playback, used for browser recovery and tests. */
export async function playInBrowser(item: JellyfinItem, playlist?: JellyfinItem[], startIndex?: number, forceExpand = false) {
  await startPlayback(item, playlist, startIndex, forceExpand, 'browser');
}
async function startPlayback(item: JellyfinItem, playlist: JellyfinItem[] | undefined, startIndex: number | undefined,
  forceExpand: boolean, mode: 'auto' | 'browser' | 'cast', overridePositionMs?: number): Promise<boolean> {
  const config = get(serverConfig);
  // Capture the selected destination before any media preparation begins.
  const useDestinations = mode !== 'browser' && supportsDestinations();
  const selectedDestination = useDestinations ? get(playbackDestination) : null;
  const useNative = useDestinations && (mode === 'cast' || selectedDestination?.kind !== 'local'
    || get(localPlaybackMode) === 'native');
  const destinationId = useDestinations ? selectedDestination?.id : undefined;
  stopPlayback();
  const ownGeneration = playbackGeneration;
  playbackBusy.set(true); playbackError.set(null);
  const current = () => ownGeneration === playbackGeneration && get(serverConfig) === config;
  const offerBrowserRecovery = () => {
    browserRecovery = () => get(serverConfig) === config
      ? startPlayback(item, playlist, startIndex, forceExpand, 'browser', overridePositionMs) : Promise.resolve(false);
    browserRecoveryAvailable.set(true);
  };
  try {
    const destination = useDestinations ? await refreshPlaybackDestination() : null;
    if (!current()) return false;
    if (useDestinations && (!destinationId || destination?.id !== destinationId || !destination.connected)) {
      throw new Error('The playback destination changed or disconnected. Choose a device and try again.');
    }
    let queue = await resolveQueue(config, item, playlist);
    if (!current()) return false;
    if (!queue.length) throw new Error('No playable items were found.');
    let index = startIndex;
    if (index === undefined && item.Type === 'Series') {
      const resumeIndex = queue.findIndex(ep => !!ep.UserData?.PlaybackPositionTicks && !ep.UserData.Played);
      const nextIndex = queue.findIndex(ep => !ep.UserData?.Played && ep.ParentIndexNumber !== 0);
      index = resumeIndex >= 0 ? resumeIndex : nextIndex >= 0 ? nextIndex : 0;
    }
    index = Math.max(0, Math.min(index ?? 0, queue.length - 1));
    const target = queue[index];
    const prepared = new Map<number, PreparedPlayback>();
    const prepare = async (queueIndex: number) => {
      const media = queue[queueIndex];
      const result = await preparePlayback(config, media, get(playbackSelections)[media.Id],
        useNative ? destination!.kind : mode === 'cast' ? 'external' : 'browser', queueIndex === index && overridePositionMs !== undefined ? overridePositionMs : undefined);
      if (!current()) throw new Error('Playback was cancelled.');
      prepared.set(queueIndex, result);
      return { ...buildSingleCastPayload(media, result.url, resolveItemPosterUrl(media), resolveItemBackdropUrl(media)),
        contentType: result.contentType, startPositionMs: result.startPositionMs, subtitleResources: result.subtitleResources };
    };
    const first = await prepare(index);
    if (!current()) return false;
    if (useDestinations && !useNative) {
      const latest = await refreshPlaybackDestination();
      if (!current()) return false;
      if (latest?.id !== destinationId || !latest.connected) {
        throw new Error('The playback destination changed or disconnected. Choose a device and try again.');
      }
    }
    const initialState: ActivePlayerState = { isOpen: true, isExpanded: forceExpand || ['Movie', 'Episode', 'Video'].includes(target.Type),
      item: target, streamUrl: first.url, isCasting: false, isLinkedCast: false, title: target.Name,
      season: target.ParentIndexNumber, episode: target.IndexNumber, playlist: queue, currentIndex: index,
      prepared: prepared.get(index), positionMs: first.startPositionMs, nativeState: 'loading',
      destinationName: destination?.kind === 'local' ? 'This device' : destination?.name };
    const api = playbackBridge();
    if (useNative || (mode === 'cast' && api?.linkCast && api.capabilities?.linkedCast)) {
      let reportingIndex = index;
      reporter = createReporter(config, target, prepared.get(index)!);
      let confirmedResume = false;
      let latestState: any = null;
      let endedDuringOpening = false;
      const applyState = (detail: any) => {
        latestState = detail;
        const nativeIndex = Number(detail.currentIndex);
        if (!Number.isInteger(nativeIndex) || nativeIndex < 0) return;
        const queueIndex = index! + nativeIndex;
        const media = queue[queueIndex];
        if (!media || !prepared.has(queueIndex)) return;
        if (reportingIndex !== queueIndex) {
          reporter?.stop(); reportingIndex = queueIndex; confirmedResume = false;
          reporter = createReporter(config, media, prepared.get(queueIndex)!);
        }
        const result = prepared.get(queueIndex)!;
        const position = Number(detail.positionMs);
        const duration = Number(detail.durationMs);
        if (Number.isFinite(position) && position >= Math.max(0, result.startPositionMs - 1500)) confirmedResume = true;
        if (confirmedResume && Number.isFinite(position) && position >= 0 && duration > 0
          && ['playing', 'paused', 'buffering', 'ended', 'stopped'].includes(detail.state)) {
          reporter?.update(position, detail.state === 'paused', detail.state === 'ended' || detail.state === 'stopped');
        }
        if (get(activePlayer).isCasting) activePlayer.update(s => ({ ...s, item: media, streamUrl: result.url,
          prepared: result, currentIndex: queueIndex, title: media.Name,
          positionMs: confirmedResume && Number.isFinite(position) ? position : result.startPositionMs,
          durationMs: Number.isFinite(duration) ? duration : undefined, nativeState: detail.state || 'loading' }));
      };
      nativeQueueStart = index;
      await openLinkedQueue({ count: queue.length, startIndex: index, destinationId, first, prepare, canStart: current,
        onState: applyState, onEnded: () => {
          endedDuringOpening = true;
          reporter?.stop(); reporter = null; activePlayer.set({ ...IDLE_PLAYER });
        } });
      if (!current() || endedDuringOpening) return false;
      activePlayer.set({ ...initialState, isCasting: true, isLinkedCast: true, isExpanded: false });
      if (latestState) applyState(latestState);
    } else if (mode === 'cast') {
      const items = [first];
      // Legacy direct casts retain their bounded playlist contract. Modern and
      // linked hosts use demand-driven preparation instead.
      for (let i = index + 1; i < Math.min(queue.length, index + 50); i++) items.push(await prepare(i));
      if (!current()) return false;
      if (!await castDirect({ ...first, items, startIndex: 0 })) { if (current()) offerBrowserRecovery(); return false; }
      if (!current()) return false;
      activePlayer.set({ ...initialState, isCasting: true, isExpanded: false, destinationName: 'PlayBridge receiver' });
    } else {
      reporter = createReporter(config, target, prepared.get(index)!);
      activePlayer.set(initialState);
      if (target.Type === 'Audio' && !config.isDemo) {
        void jfApi.getItemLyrics(config.url, config.token, target.Id).then(res => { if (current() && get(activePlayer).prepared === initialState.prepared) lyricsData.set(res); }).catch(() => {});
      }
    }
    detailModalItem.set(null);
    showToast(useNative ? `Opening playback on ${initialState.destinationName}` : mode === 'cast' ? 'Cast dispatched' : `Playing "${target.Name}"`, 'info');
    return true;
  } catch (err) {
    if (current()) {
      reporter?.stop(); reporter = null;
      playbackError.set(err instanceof Error ? err.message : 'Playback could not start. Try again.');
      if (useDestinations || mode === 'cast') offerBrowserRecovery();
    }
    return false;
  } finally { if (current()) playbackBusy.set(false); }
}

export async function playOnThisScreen() {
  const state = get(activePlayer);
  if (!state.item) return;
  await startPlayback(state.item, state.playlist, state.currentIndex, true, 'browser', state.positionMs);
}
export async function castCurrentPlayback(positionMs: number) {
  const state = get(activePlayer);
  if (!state.item) return;
  if (supportsDestinations()) {
    await choosePlaybackDestination();
    if (!get(playbackDestination)?.connected || get(playbackError)) return;
  }
  await startPlayback(state.item, state.playlist, state.currentIndex, false, 'cast', positionMs);
}

// Trigger Shuffle Play for Folders, Albums, and Playlists (Finamp Inspired)
export async function shufflePlay(parentItem: JellyfinItem, providedItems?: JellyfinItem[]): Promise<void> {
  const config = get(serverConfig);
  let tracks: JellyfinItem[] = [];

  if (providedItems && providedItems.length > 0) {
    tracks = providedItems.filter((i) => i.Type === 'Audio' || i.Type === 'Movie' || i.Type === 'Episode');
  }

  if (tracks.length === 0 && !config.isDemo) {
    try {
      tracks = await jfApi.getPlayableFolderItems(config.url, config.userId, config.token, parentItem.Id);
      parentItem.tracks = tracks;
    } catch (err) {
      console.error('Failed to resolve tracks for shuffle play', err);
    }
  }

  if (tracks.length === 0) {
    showToast(`No playable tracks found to shuffle`, 'info');
    return;
  }

  const shuffled = shuffleArray(tracks);
  isShuffle.set(true);
  await playMedia(shuffled[0], shuffled, 0, false);
  showToast(`Shuffling "${parentItem.Name}" (${shuffled.length} tracks)`, 'info');
}

// Trigger Shuffle Direct Cast for Folders, Albums, and Playlists
export async function shuffleCast(parentItem: JellyfinItem, providedItems?: JellyfinItem[]): Promise<boolean> {
  const config = get(serverConfig);
  let tracks: JellyfinItem[] = [];

  if (providedItems && providedItems.length > 0) {
    tracks = providedItems.filter((i) => i.Type === 'Audio' || i.Type === 'Movie' || i.Type === 'Episode');
  }

  if (tracks.length === 0 && !config.isDemo) {
    try {
      tracks = await jfApi.getPlayableFolderItems(config.url, config.userId, config.token, parentItem.Id);
      parentItem.tracks = tracks;
    } catch (err) {
      console.error('Failed to resolve tracks for shuffle cast', err);
    }
  }

  if (tracks.length === 0) {
    showToast(`No playable tracks found to shuffle cast`, 'info');
    return false;
  }

  const shuffled = shuffleArray(tracks);
  isShuffle.set(true);
  return playFolderOrAlbumWithCast(parentItem, shuffled, 0);
}

// Toggle Shuffle mode on active queue
export function toggleShuffle() {
  if (get(activePlayer).isCasting) { showToast('Manage the native queue in PlayBridge Remote.', 'info'); return; }
  isShuffle.update((val) => {
    const next = !val;
    const current = get(activePlayer);
    if (current.playlist && current.playlist.length > 1) {
      if (next) {
        // Shuffle remaining queue while keeping current item
        const curItem = current.item;
        const others = current.playlist.filter((i) => i.Id !== curItem?.Id);
        const shuffled = curItem ? [curItem, ...shuffleArray(others)] : shuffleArray(current.playlist);
        activePlayer.update((s) => ({ ...s, playlist: shuffled, currentIndex: 0 }));
      }
    }
    showToast(next ? 'Shuffle enabled' : 'Shuffle disabled', 'info');
    return next;
  });
}

// Cycle Repeat mode: off -> all -> one -> off
export function cycleRepeatMode() {
  if (get(activePlayer).isCasting) { showToast('Manage native playback in PlayBridge Remote.', 'info'); return; }
  repeatMode.update((mode) => {
    let next: 'off' | 'all' | 'one' = 'off';
    if (mode === 'off') next = 'all';
    else if (mode === 'all') next = 'one';
    else next = 'off';

    const label = next === 'all' ? 'Repeat All' : next === 'one' ? 'Repeat One' : 'Repeat Off';
    showToast(label, 'info');
    return next;
  });
}

// Toggle Favorite Item on Jellyfin Server (Finamp Feature)
export async function toggleFavorite(item: JellyfinItem): Promise<boolean> {
  const config = get(serverConfig);
  const next = !item.UserData?.IsFavorite;
  if (!config.isDemo && !await jfApi.toggleFavoriteItem(config.url, config.userId, config.token, item.Id, next)) {
    showToast('Favorite could not be saved. Please retry.', 'info');
    return !!item.UserData?.IsFavorite;
  }
  if (get(serverConfig) !== config) return !!item.UserData?.IsFavorite;
  item.UserData = { ...item.UserData, IsFavorite: next };
  const update = (items: JellyfinItem[]) => items.map(i => i.Id === item.Id ? { ...i, UserData: { ...i.UserData, IsFavorite: next } } : i);
  allLibraryItems.update(update); moviesList.update(update); showsList.update(update);
  latestMedia.update(update); resumeMedia.update(update); nextUpMedia.update(update);
  detailModalItem.update(current => current?.Id === item.Id ? { ...current, UserData: item.UserData } : current);
  activePlayer.update(s => s.item?.Id === item.Id ? { ...s, item: { ...s.item, UserData: item.UserData } } : s);
  clearAllCache();
  favoritesRevision.update(n => n + 1);
  showToast(next ? `Added "${item.Name}" to Favorites` : `Removed "${item.Name}" from Favorites`, 'success');
  return next;
}
export const favoritesRevision = writable(0);

// Compatibility exports: explicit Cast is separate from the selected-destination Play action.
export async function playWithDirectCast(item: JellyfinItem): Promise<boolean> {
  return startPlayback(item, undefined, undefined, false, 'cast');
}
export async function playFolderOrAlbumWithCast(parent: JellyfinItem, items?: JellyfinItem[], startIndex = 0): Promise<boolean> {
  return startPlayback(parent, items, startIndex, false, 'cast');
}
export async function playWithLinkedQueue(series: JellyfinItem, seasons?: JellyfinSeason[], startIndex = 0): Promise<boolean> {
  return startPlayback(series, seasons?.flatMap(s => s.Episodes), startIndex, false, 'cast');
}
export function skipNextTrack() {
  const state = get(activePlayer);
  if (!state.playlist?.length) return;
  const repeat = get(repeatMode);
  let index = repeat === 'one' ? state.currentIndex ?? 0 : (state.currentIndex ?? 0) + 1;
  if (index >= state.playlist.length) {
    if (repeat !== 'all') { if (!state.isCasting) stopPlayback(); return; }
    index = 0;
  }
  playQueueTrack(index);
}
export function skipPrevTrack() {
  const state = get(activePlayer);
  if (state.playlist?.length) playQueueTrack(Math.max(0, (state.currentIndex ?? 0) - 1));
}
export function playQueueTrack(index: number) {
  const state = get(activePlayer);
  const item = state.playlist?.[index];
  if (!item) return;
  if (state.isLinkedCast) {
    // Native queue indices begin at the initially selected item, not episode 1.
    // Only supplied items can be jumped to; otherwise explicitly start a new queue.
    const relativeIndex = index - nativeQueueStart;
    const session = get(activeLinkedSession);
    if (session && relativeIndex >= 0) {
      void session.jump(relativeIndex).catch(() => showToast('That item is not yet in the native queue. Use Play on its episode card.', 'info'));
    } else if (relativeIndex < 0) {
      void startPlayback(item, state.playlist, index, false, 'cast');
    }
  } else {
    if (state.isCasting) void startPlayback(item, state.playlist, index, state.isExpanded, 'cast');
    else void advanceBrowserQueue(state, index);
  }
}
async function advanceBrowserQueue(state: ActivePlayerState, index: number) {
  if (get(playbackBusy)) return;
  const config = get(serverConfig);
  const item = state.playlist![index];
  const selection = get(playbackSelections)[item.Id] || {};
  const cached = browserPrefetch;
  const canReuse = get(repeatMode) !== 'one' && cached?.config === config && cached.queue === state.playlist
    && cached.index === index && cached.selection === JSON.stringify(selection) && cached.generation === playbackGeneration;
  const ownGeneration = ++playbackGeneration;
  const current = () => ownGeneration === playbackGeneration && get(serverConfig) === config;
  playbackBusy.set(true); playbackError.set(null);
  try {
    const prepared = await (canReuse ? cached!.promise : preparePlayback(config, item, selection, 'browser',
      get(repeatMode) === 'one' ? 0 : undefined));
    if (!current() || !get(activePlayer).isOpen || get(activePlayer).isCasting
      || get(activePlayer).playlist !== state.playlist) return;
    // Do not close chrome or clear media nodes: the standby element already owns
    // this exact source. Keep the old session reporting until the new source is ready.
    reporter?.stop(); reporter = createReporter(config, item, prepared);
    browserPrefetch = null; nextBrowserPlayback.set(null); lyricsData.set(null);
    activePlayer.update(s => ({ ...s, item, title: item.Name, streamUrl: prepared.url, prepared,
      isExpanded: s.isExpanded || item.Type !== 'Audio', currentIndex: index, season: item.ParentIndexNumber, episode: item.IndexNumber,
      positionMs: prepared.startPositionMs, durationMs: undefined }));
    if (item.Type === 'Audio' && !config.isDemo) {
      void jfApi.getItemLyrics(config.url, config.token, item.Id).then(res => {
        if (current() && get(activePlayer).prepared === prepared) lyricsData.set(res);
      }).catch(() => {});
    }
  } catch (err) {
    if (current()) playbackError.set(err instanceof Error ? err.message : 'The next item could not start. Try again.');
  } finally { if (current()) playbackBusy.set(false); }
}
let nativeQueueStart = 0;
