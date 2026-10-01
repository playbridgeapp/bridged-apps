<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { ArrowLeft, ArrowRight, Bookmark, Cast, Check, ChevronDown, Clapperboard, Film, History, Home, Info, Library, LoaderCircle, Play, Plus, RefreshCw, Search, Settings2, Star, Trash2, Tv, UserRound, X } from 'lucide-svelte';
  import { catalogs, fetchCatalog, fetchCatalogPage, fetchMeta, fetchStreams, installAddon, playableStream, requiredCatalogExtras, savedAddonUrls, saveAddonUrls, supports } from './lib/addons';
  import AddonManagementCard from './lib/AddonManagementCard.svelte';
  import MediaTile from './lib/MediaTile.svelte';
  import HomeContent from './lib/HomeContent.svelte';
  import CatalogRail from './lib/CatalogRail.svelte';
  import TitleSkeleton from './lib/TitleSkeleton.svelte';
  import TmdbSettingsPanel from './lib/TmdbSettings.svelte';
  import TmdbDetails from './lib/TmdbDetails.svelte';
  import TrailerPlayer from './lib/TrailerPlayer.svelte';
  import PluginSettingsDialog from './lib/PluginSettingsDialog.svelte';
  import { applyPluginPreferences, saveLocalScraperSettings, type ScraperPreference } from './lib/plugin-preferences';
  import { savedTmdbSettings, saveTmdbSettings } from './lib/tmdb-settings';
  import type { TmdbSettings } from './lib/tmdb-settings';
  import { fetchTmdbMetadata, fetchTmdbSeason, applyTmdbMetadata, applyTmdbSeason } from './lib/tmdb';
  import type { TmdbMetadata } from './lib/tmdb';
  import StreamSelectionSettings from './lib/StreamSelectionSettings.svelte';
  import { savedStreamSelection, saveStreamSelection, selectPreferredStream, selectReadyPreferredStream, selectNextStream, selectionContext } from './lib/stream-selection';
  import type { StreamSelectionContext, StreamSelectionPreferences } from './lib/stream-selection';
  import { cachedDetailPreview, saveDetailPreview } from './lib/detail-cache';
  import { addonSettings, clearAddonSettings, configuredAddon, saveAddonSettings, unavailableAddon } from './lib/addon-settings';
  import { cachedCatalog, clearCatalogCache, saveCatalogCache, savedCatalogRefresh, saveCatalogRefresh } from './lib/catalog-cache';
  import { readPersistentSession, writePersistentSession } from './lib/persistent-session';
  import { cachedAddons, cachedNuvioLibrary, cachedNuvioPlugins, cachedNuvioProgress, cachedStremioLibrary, clearStartupCache, saveAddons, saveNuvioLibrary, saveNuvioPlugins, saveNuvioProgress, saveStremioLibrary } from './lib/startup-cache';
  import { appendPlaybackDiagnostic, clearPlaybackDiagnostics, readPlaybackDiagnostics, safeDiagnosticText } from './lib/playback-diagnostics';
  import type { AddonFeature, AddonSource } from './lib/addon-settings';
  import { bridgeAvailable, castMovie, directCast, lazyCastSeries, stopLinkedCast } from './lib/cast';
  import { defaultSeason, resumeEpisode, resumePositionMs } from './lib/resume';
  import { browserCompatible, installPlugin, platformCompatible, savedPluginUrls, savedTmdbKey, savePluginUrls, saveTmdbKey, toggleScraper } from './lib/plugins';
  import { addAccountAddon, fetchAccountAddons, fetchAccountLibrary, login, loginWithKey, moveAccountAddon, refreshUser, removeAccountAddon, savedSession, saveSession, saveWatchProgress, setLibraryMembership } from './lib/stremio';
  import { NUVIO_CLOUD_PUBLISHABLE_KEY, NUVIO_CLOUD_URL, changeNuvioSource, createNuvioPrimaryProfile, decorateNuvioLibrary, deleteNuvioLibraryItem, discoverNuvio, fetchNuvioLibrary, fetchNuvioProfiles, fetchNuvioProgress, fetchNuvioSources, freshNuvioSession, loginNuvio, moveNuvioAddon, pushNuvioLibraryItem, pushNuvioProgress, savedNuvioSession, saveNuvioSession, setNuvioAddonEnabled, verifyNuvioPin } from './lib/nuvio';
  import type { NuvioLibraryItem, NuvioProfile, NuvioProgress, NuvioSession } from './lib/nuvio';
  import { fetchNuvioPluginPreferences, changeNuvioScraperPreference } from './lib/nuvio';
  import type { AddonCatalog, InstalledAddon, MediaType, Meta, MetaPreview, MetaTrailer, PluginRepository, Stream, Video } from './lib/types';
  import type { StremioLibraryItem, StremioSession } from './lib/stremio';
  import { HashRouter, parseRoute, routeHash } from './lib/router';
  import type { AppRoute, MediaRoute, Tab } from './lib/router';
  import moviWasmUrl from 'movi-player/movi.wasm?url';

  type CatalogRow = { key: string; title: string; addon: InstalledAddon; catalog: AddonCatalog; items: MetaPreview[]; loading?: boolean; error?: string; nextSkip?: number | null; loadingMore?: boolean; duplicatePages?: number; pageError?: string };
  type StreamSource = { key: string; name: string; addon?: InstalledAddon; plugin?: PluginRepository };
  type DiscoverDropdown = 'type' | 'catalog' | 'genre';
  const NUVIO_PROFILE_KEY = 'bridged-streams.nuvio-profile.v1';
  const DISCOVER_CATALOG_KEY = 'bridged-streams.discover-catalog.v1';
  const SEARCH_HISTORY_KEY = 'bridged-streams.search-history.v1';
  const NATIVE_PLAYER_FALLBACK_KEY = 'bridged-streams.native-player-fallback.v1';
  const SEARCH_HISTORY_DELAY_MS = 2500;
  function savedNativePlayerFallback(): boolean {
    try { return localStorage.getItem(NATIVE_PLAYER_FALLBACK_KEY) !== 'false'; } catch { return true; }
  }
  function savedSearchHistory(): string[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim())
        .map((item) => item.trim().slice(0, 100)).slice(0, 8) : [];
    } catch { return []; }
  }
  const motionDuration = (milliseconds: number) => typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : milliseconds;
  function savedDiscoverCatalogKey(): string {
    try { return localStorage.getItem(DISCOVER_CATALOG_KEY) || ''; } catch { return ''; }
  }
  const initialStremioSession = savedSession();
  const initialNuvioSession = savedNuvioSession();
  const initialLocalUrls = savedAddonUrls();
  const initialLocalAddons = (cachedAddons('local-addons', 'browser') || [])
    .filter((addon) => initialLocalUrls.includes(addon.manifestUrl)).map((addon) => configuredAddon(addon, 'local'));
  const initialAccountAddons = initialStremioSession
    ? (cachedAddons('stremio-addons', initialStremioSession.user._id) || [])
      .map((addon) => configuredAddon(addon, 'stremio', undefined, initialStremioSession.user._id)) : [];
  const initialAccountLibrary = initialStremioSession ? cachedStremioLibrary(initialStremioSession.user._id) || [] : [];

  let localAddons: InstalledAddon[] = initialLocalAddons;
  let accountAddons: InstalledAddon[] = initialAccountAddons;
  let nuvioAddons: InstalledAddon[] = [];
  let addons: InstalledAddon[] = [];
  let accountLibrary: StremioLibraryItem[] = initialAccountLibrary;
  let nuvioLibrary: NuvioLibraryItem[] = [];
  let nuvioProgress: NuvioProgress[] = [];
  let nuvioProgressMetadata = new Map<string, MetaPreview>();
  let nuvioMetadataController: AbortController | null = null;
  let lastNuvioMetadataKey = '';
  let resolvedNuvioMetadataScope = '';
  let nuvioSession: NuvioSession | null = initialNuvioSession;
  let nuvioProfiles: NuvioProfile[] = [];
  let nuvioProfileIndex = 1;
  let nuvioUnlockedProfile: number | null = null;
  let nuvioBackend = NUVIO_CLOUD_URL;
  let nuvioKey = NUVIO_CLOUD_PUBLISHABLE_KEY;
  let nuvioEmail = '';
  let nuvioPassword = '';
  let nuvioPin = '';
  let nuvioBusy = false;
  let nuvioProfilesLoading = !!initialNuvioSession;
  let nuvioProfilesLoadFailed = false;
  let nuvioSyncing = false;
  let nuvioError = '';
  let nuvioMessage = '';
  let nuvioGeneration = 0;
  let nuvioSyncRequest = 0;
  let nuvioLibraryBusy = false;
  const nuvioProgressLastWrite = new Map<string, number>();
  const nuvioProgressLastPosition = new Map<string, number>();
  const nuvioProgressInFlight = new Set<string>();
  const nuvioProgressPending = new Map<string, { meta: Meta; progress: WatchProgress }>();
  let account: StremioSession | null = initialStremioSession;
  let startupLoading = !!(initialStremioSession || initialNuvioSession || initialLocalUrls.length)
    && !initialLocalAddons.length && !initialAccountAddons.length;
  let stremioRestoring = !!initialStremioSession;
  let nuvioRestoring = !!initialNuvioSession;
  let accountPanel = false;
  let integrationsPanel = false;
  let loginMode: 'password' | 'key' = 'password';
  let email = '';
  let password = '';
  let authKeyInput = '';
  let accountBusy = false;
  let accountSyncing = false;
  let accountError = '';
  let accountMessage = '';
  let accountGeneration = 0;
  let addonDestination: 'local' | 'stremio' | 'nuvio' = 'local';
  let syncNewPlugin = false;
  let libraryBusy = false;
  const progressLastWrite = new Map<string, number>();
  const progressLastPosition = new Map<string, number>();
  const progressInFlight = new Set<string>();
  const progressPending = new Map<string, { meta: Meta; progress: WatchProgress }>();
  type WatchProgress = { videoId: string; positionMs: number; durationMs: number; state: string };
  let plugins: PluginRepository[] = [];
  let localPlugins: PluginRepository[] = [];
  let nuvioPlugins: PluginRepository[] = [];
  let pluginInput = '';
  let pluginError = '';
  let addingPlugin = false;
  let pluginSaving = '';
  let pluginMutation = 0;
  let pluginSettingsTarget: { repo: PluginRepository; scraperId: string; synced: boolean } | null = null;
  let tmdbKey = '';
  let tmdbSettings = savedTmdbSettings();
  let tmdbMetadata: TmdbMetadata | null = null;
  let enrichmentBusy = false;
  let activeTrailer: MetaTrailer | null = null;
  let enrichmentError = '';
  let enrichmentGeneration = 0;
  let enrichmentSeasonRequest = 0;
  let lastEnrichmentSeasonKey = '';
  let rows: CatalogRow[] = [];
  let catalogPage: CatalogRow | null = null;
  let catalogPageItems: MetaPreview[] = [];
  let catalogPageNextSkip: number | null = null;
  let catalogPageLoading = false;
  let catalogPageError = '';
  let catalogPageDuplicatePages = 0;
  let catalogPageRequest = 0;
  let tab: Tab = 'home';
  let currentRoute: AppRoute = parseRoute(window.location.hash);
  let router: HashRouter | null = null;
  let restoreReady: Promise<unknown> = Promise.resolve();
  let restorationComplete = false;
  let routeRequest = 0;
  const detailMemory = new Map<string, Meta>();
  const previewMemory = new Map<string, MetaPreview>();
  type PlaybackChoice = { stream: Stream; selection: StreamSelectionContext };
  const playerMemory = new Map<string, PlaybackChoice>();
  let streamSelection = savedStreamSelection();
  let pendingAutoAction: { type: MediaType; id: string; videoId?: string; action: 'play' | 'cast' } | null = null;
  let pendingEpisodeAction: 'play' | 'cast' = 'play';
  let streamActionRequest = 0;
  const routePositions = new Map<string, { window: number; panel: number; episodes: number }>();
  let navigationRequest = 0;
  let dockElement: HTMLElement | null = null;
  let dockIndicatorX = 0;
  let dockIndicatorWidth = 0;
  let dockPosition = 0;
  let dockReady = false;
  let dockCompact = false;
  let dockRestoringScroll = false;
  let dockInteracting = false;
  let dockPointerStartX = 0;
  let dockPointerStartY = 0;
  let dockPointerMoved = false;
  let dockStretch = 1;
  let suppressDockClick = false;
  let heroPointerStartX = 0;
  let heroPointerStartY = 0;
  let suppressHeroClick = false;
  let featureLastInteraction = 0;
  let discoverType = '';
  let discoverCatalogKey = savedDiscoverCatalogKey();
  let discoverGenre = '';
  let discoverItems: MetaPreview[] = [];
  let discoverLoading = false;
  let discoverError = '';
  let discoverNextSkip: number | null = null;
  let discoverDuplicatePages = 0;
  let discoverRequest = 0;
  let lastDiscoverRequestKey = '';
  let openDiscoverDropdown: DiscoverDropdown | null = null;
  let discoverDropdownTrigger: HTMLButtonElement | null = null;
  let search = '';
  let submittedSearch = '';
  let searchHistory = savedSearchHistory();
  let searchHistoryOpen = false;
  let searchResults: MetaPreview[] = [];
  let searching = false;
  let searchHistoryTimer: number | undefined;
  let loadingCatalogs = false;
  let managing = false;
  let addonInput = '';
  let adding = false;
  let addonError = '';
  let addonWorking = '';
  let addonPendingRemoval: { source: AddonSource; url: string; name: string } | null = null;
  let autoRefreshCatalogs = true;
  let catalogRefreshInterval: 15 | 30 | 60 = 30;
  let lastCatalogRefresh = 0;
  let selected: Meta | null = null;
  let streamScreen = false;
  let streamBackToDetail = false;
  let loadingDetail = false;
  let detailError = '';
  let season = 1;
  let seasonPickerOpen = false;
  let seasonWheel: HTMLDivElement | null = null;
  let seasonWheelTimer: number | undefined;
  let episode: Video | null = null;
  let episodeListElement: HTMLDivElement | null = null;
  let streams: Stream[] = [];
  let activeStreamSources: StreamSource[] = [];
  let selectedStreamSource = '';
  let sourceStreams: Record<string, Stream[]> = {};
  let sourceLoading: Record<string, boolean> = {};
  let sourceWarnings: Record<string, string> = {};
  let loadingStreams = false;
  let restoringStreamSources = false;
  let sourceError = '';
  let status = '';
  let statusTimer: number | undefined;
  function showStatus(value: string) {
    window.clearTimeout(statusTimer);
    status = value;
    statusTimer = value ? window.setTimeout(() => {
      status = '';
      statusTimer = undefined;
    }, 5000) : undefined;
  }
  let bridge = false;
  let playing: { meta: Meta; stream: Stream; selection: StreamSelectionContext; video: Video | null; resumePositionMs: number; resumeApplied: boolean } | null = null;
  let playerReady = false;
  let playerLoading = false;
  let playerError = '';
  let nativePlayerFallback = savedNativePlayerFallback();
  let playerElement: HTMLElement | null = null;
  let playbackDiagnostics = readPlaybackDiagnostics();
  let playbackAttempt = Math.max(0, ...playbackDiagnostics.map((entry) => entry.attempt));
  let diagnosticsChecking = false;
  let diagnosticsStatus = '';

  function saveNativePlayerFallback() {
    try { localStorage.setItem(NATIVE_PLAYER_FALLBACK_KEY, String(nativePlayerFallback)); }
    catch { /* The setting still works for this session when storage is unavailable. */ }
  }

  function logPlayback(event: string, detail = '') {
    playbackDiagnostics = appendPlaybackDiagnostic(playbackDiagnostics, playbackAttempt, event, detail);
  }

  function logPlayerAssets() {
    for (const item of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      try {
        const url = new URL(item.name);
        if (url.origin !== location.origin) continue;
        const name = url.pathname.split('/').pop() || '';
        if (!/element[._-]slim|^movi[-.].*\.wasm$/i.test(name)) continue;
        const responseStatus = (item as PerformanceResourceTiming & { responseStatus?: number }).responseStatus;
        logPlayback('asset timing', `${name}: HTTP ${responseStatus || 'unknown'}; ${Math.round(item.duration)}ms, transferred ${item.transferSize} bytes, decoded ${item.decodedBodySize} bytes`);
      } catch { /* Ignore malformed browser timing entries. */ }
    }
  }

  function playbackReport(entries: typeof playbackDiagnostics): string {
    return JSON.stringify({
      app: 'Bridged Streams',
      player: 'movi-player 0.4.0 slim',
      browser: safeDiagnosticText(navigator.userAgent),
      online: navigator.onLine,
      secureContext: isSecureContext,
      webAssembly: typeof WebAssembly !== 'undefined',
      webCodecs: typeof VideoDecoder !== 'undefined',
      nativeFallback: nativePlayerFallback,
      wasmAsset: new URL(moviWasmUrl, location.href).pathname.split('/').pop(),
      entries
    }, null, 2);
  }

  async function copyPlaybackReport() {
    const report = playbackReport(playbackDiagnostics);
    try {
      await navigator.clipboard.writeText(report);
      diagnosticsStatus = 'Playback report copied.';
    } catch {
      const field = document.createElement('textarea');
      field.value = report;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      let copied = false;
      try { copied = document.execCommand('copy'); }
      catch { /* The report remains selectable below. */ }
      field.remove();
      diagnosticsStatus = copied ? 'Playback report copied.' : 'Select the report text below to copy it.';
    }
  }

  function removePlaybackReport() {
    clearPlaybackDiagnostics();
    playbackDiagnostics = [];
    diagnosticsStatus = 'Playback history cleared.';
  }

  async function runPlaybackChecks() {
    if (diagnosticsChecking) return;
    diagnosticsChecking = true;
    diagnosticsStatus = 'Checking the player engine…';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(moviWasmUrl, { cache: 'no-store', signal: controller.signal });
      logPlayback('WASM fetch', `HTTP ${response.status}; ${response.headers.get('content-type') || 'unknown type'}`);
      if (!response.ok) throw new Error(`WASM asset returned HTTP ${response.status}`);
      const binary = await response.arrayBuffer();
      logPlayback('WASM bytes', `${binary.byteLength}; valid=${WebAssembly.validate(binary)}`);
      const module = await WebAssembly.compile(binary);
      logPlayback('WASM compile', `ok; ${WebAssembly.Module.exports(module).length} exports`);
      diagnosticsStatus = 'Player engine check passed. Copy the report if playback still fails.';
    } catch (error) {
      logPlayback('WASM check failed', safeDiagnosticText(error));
      diagnosticsStatus = 'Player engine check failed. Copy the report for debugging.';
    } finally {
      clearTimeout(timeout);
      diagnosticsChecking = false;
    }
  }
  let featureIndex = 0;
  let activeAddonFilter = '';
  let detailExpanded = false;
  let pageScrolled = false;
  let catalogRequest = 0;
  let detailRequest = 0;
  let streamRequest = 0;
  let searchRequest = 0;

  $: addons = uniqueEnabledAddons([...accountAddons, ...nuvioAddons, ...localAddons]);
  $: browsableAddons = addons.filter((addon) => catalogs([addon])
    .some(({ catalog }) => requiredCatalogExtras(catalog) !== null));
  $: effectiveAddonFilter = browsableAddons.some((addon) => addon.manifestUrl === activeAddonFilter)
    ? activeAddonFilter : '';
  $: plugins = [...new Map([...localPlugins, ...nuvioPlugins].map((repo) => [repo.manifestUrl, repo])).values()];
  $: selectionProviders = [...new Map([
    ...addons.filter((addon) => !addon.disabledFeatures?.includes('stream') && addon.manifest.resources.some((resource) =>
      (typeof resource === 'string' ? resource : resource.name) === 'stream'))
      .map((addon) => ({ id: addon.manifestUrl, name: addon.manifest.name })),
    ...plugins.flatMap((repo) => repo.scrapers.filter(browserCompatible)
      .map((scraper) => ({ id: `${repo.manifestUrl}:${scraper.id}`, name: `${scraper.name} · ${repo.name}` })))
  ].map((provider) => [provider.id, provider])).values()];
  $: visibleRows = rows.filter((row) => !effectiveAddonFilter || row.addon.manifestUrl === effectiveAddonFilter);
  $: discoverSources = rows.filter((row) => !(row.catalog.extra || []).some((extra) => extra.isRequired && !['genre', 'skip'].includes(extra.name)));
  $: discoverTypes = [...new Set(discoverSources.map((row) => row.catalog.type))];
  $: effectiveDiscoverType = discoverTypes.includes(discoverType) ? discoverType
    : discoverSources.find((row) => row.key === discoverCatalogKey)?.catalog.type || discoverTypes[0] || '';
  $: discoverCatalogOptions = discoverSources.filter((row) => row.catalog.type === effectiveDiscoverType);
  $: selectedDiscoverCatalog = discoverCatalogOptions.find((row) => row.key === discoverCatalogKey) || discoverCatalogOptions[0];
  $: discoverGenreExtra = selectedDiscoverCatalog?.catalog.extra?.find((extra) => extra.name === 'genre');
  $: discoverGenreOptions = discoverGenreExtra?.options || [];
  $: effectiveDiscoverGenre = discoverGenreOptions.includes(discoverGenre) ? discoverGenre
    : discoverGenreExtra?.isRequired ? discoverGenreOptions[0] || '' : '';
  $: discoverDropdownOptions = openDiscoverDropdown === 'type'
    ? discoverTypes.map((type) => ({ key: type, label: discoverTypeLabel(type) }))
    : openDiscoverDropdown === 'catalog'
      ? discoverCatalogOptions.map((row) => ({ key: row.key, label: discoverCatalogLabel(row) }))
      : openDiscoverDropdown === 'genre'
        ? [...(discoverGenreExtra?.isRequired ? [] : [{ key: '', label: 'All genres' }]), ...discoverGenreOptions.map((genre) => ({ key: genre, label: genre }))]
        : [];
  $: discoverDropdownValue = openDiscoverDropdown === 'type' ? effectiveDiscoverType
    : openDiscoverDropdown === 'catalog' ? selectedDiscoverCatalog?.key || '' : effectiveDiscoverGenre;
  $: activeDiscoverRequestKey = selectedDiscoverCatalog
    ? `${selectedDiscoverCatalog.key}|${effectiveDiscoverGenre}|${catalogRequest}` : '';
  $: if (tab === 'search' && !submittedSearch && activeDiscoverRequestKey && activeDiscoverRequestKey !== lastDiscoverRequestKey) {
    lastDiscoverRequestKey = activeDiscoverRequestKey;
    void loadDiscoverFeed(true);
  }
  $: featureCandidates = [...new Map(rows.flatMap((row) => row.items)
    .filter((item) => (item.background || item.poster) && (item.type === 'movie' || item.type === 'series'))
    .map((item) => [`${item.type}:${item.id}`, item])).values()].slice(0, 5);
  $: if (featureIndex >= featureCandidates.length && featureIndex !== 0) featureIndex = 0;
  $: featured = featureCandidates[featureIndex] || featureCandidates[0];
  $: relatedTitles = selected ? [...new Map(rows.flatMap((row) => row.items)
    .filter((item) => item.type === selected?.type && item.id !== selected?.id)
    .map((item) => [`${item.type}:${item.id}`, item])).values()]
    .sort((a, b) => (b.genres || []).filter((genre) => selected?.genres?.includes(genre)).length
      - (a.genres || []).filter((genre) => selected?.genres?.includes(genre)).length).slice(0, 16) : [];
  $: savedLibrary = [...new Map([...nuvioLibrary, ...accountLibrary.filter((item) => !item.removed && !item.temp)].map((item) => [`${item.type}:${item.id}`, item])).values()];
  $: nuvioProgressItems = progressPreviews(nuvioProgress, rows, nuvioLibrary, nuvioProgressMetadata);
  $: continueWatching = [...new Map([...nuvioProgressItems, ...nuvioLibrary, ...accountLibrary.filter((item) => !item.removed || item.temp)]
    .filter((item) => item.progress > 0 && item.progress < 95).map((item) => [`${item.type}:${item.id}`, item])).values()]
    .sort((a, b) => (b.lastWatched || '').localeCompare(a.lastWatched || ''));
  $: selectedInLibrary = selected ? accountLibrary.some((item) => item.id === selected?.id && !item.removed && !item.temp) : false;
  $: detailIdentityReady = !!selected && selected.name !== selected.id;
  // Catalog artwork and addon artwork can both be replaced during detail loading.
  // Publish the chosen backdrop once, while text and playback stay independent.
  $: detailBackdrop = loadingDetail || (enrichmentBusy && tmdbSettings.artwork)
    ? '' : selected?.background || selected?.poster || '';
  $: selectedInNuvioLibrary = selected ? nuvioLibrary.some((item) => item.id === selected?.id && item.type === selected?.type) : false;
  $: activeNuvioProfile = nuvioProfiles.find((profile) => profile.profile_index === nuvioProfileIndex);
  $: nuvioProfileLocked = activeNuvioProfile?.pin_enabled === true && nuvioUnlockedProfile !== nuvioProfileIndex;
  $: nuvioProfileReady = !!activeNuvioProfile && !nuvioProfileLocked;
  $: nuvioMetadataScope = nuvioSession && nuvioProfileReady ? nuvioCacheScope(nuvioSession, nuvioProfileIndex) : '';
  $: nuvioMetadataProviders = addons.filter((addon) => supports(addon, 'meta', 'movie') || supports(addon, 'meta', 'series'));
  $: nuvioMetadataTargets = latestNuvioProgress(nuvioProgress)
    .filter((entry) => entry.content_type === 'movie' || entry.content_type === 'series')
    .sort((a, b) => b.last_watched - a.last_watched).slice(0, 16)
    .filter((entry) => !nuvioLibrary.some((item) => item.type === entry.content_type && item.id === entry.content_id)
      && !rows.some((row) => row.items.some((item) => item.type === entry.content_type && item.id === entry.content_id)));
  $: nuvioMetadataKey = JSON.stringify([nuvioMetadataScope, nuvioGeneration, nuvioSyncRequest,
    nuvioMetadataProviders.map((addon) => [addon.manifestUrl, addon.manifest.version, addon.manifest.resources, addon.manifest.types, addon.manifest.idPrefixes]),
    nuvioMetadataTargets.map((entry) => [entry.content_type, entry.content_id])]);
  $: if (nuvioMetadataKey !== lastNuvioMetadataKey) {
    lastNuvioMetadataKey = nuvioMetadataKey;
    void resolveNuvioProgressMetadata(nuvioMetadataScope, nuvioMetadataTargets, nuvioMetadataProviders);
  }
  $: seasons = selected?.videos
    ? [...new Set(selected.videos.map((video) => video.season).filter((value): value is number => value != null))].sort((a, b) => a - b)
    : [];
  $: seasonSummaries = seasons.map((value) => {
    const videos = (selected?.videos || []).filter((video) => video.season === value);
    return { value, label: value === 0 ? 'Specials' : `Season ${value}`, count: videos.length,
      image: videos.find((video) => video.seasonPoster)?.seasonPoster || videos.find((video) => video.thumbnail)?.thumbnail || selected?.poster };
  });
  $: episodes = (selected?.videos || []).filter((video) => video.season === season)
    .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
  $: playable = streams.filter(playableStream);
  $: visiblePlayable = playable.filter((stream) => !selectedStreamSource ||
    sourceStreams[selectedStreamSource]?.includes(stream));
  $: visibleSourcesLoading = selectedStreamSource ? !!sourceLoading[selectedStreamSource] : loadingStreams;
  $: detailResumeMs = selected ? resumePositionMs(selected, episode, accountLibrary, nuvioProgress) : 0;
  $: unavailable = streams.length - playable.length;
  $: browserUncertain = playable.filter((stream) => stream.behaviorHints?.notWebReady).length;
  $: if (tab) void tick().then(updateDockIndicator);
  $: enrichmentSeasonKey = selected?.type === 'series' && tmdbMetadata && tmdbSettings.enabled && tmdbSettings.episodes
    ? `${enrichmentGeneration}:${tmdbMetadata.id}:${season}:${tmdbSettings.language}` : '';
  $: if (enrichmentSeasonKey && enrichmentSeasonKey !== lastEnrichmentSeasonKey) {
    lastEnrichmentSeasonKey = enrichmentSeasonKey;
    void enrichCurrentSeason();
  }

  function updateDockIndicator() {
    const buttons = [...(dockElement?.querySelectorAll<HTMLButtonElement>('button') || [])];
    const selectedIndex = buttons.findIndex((button) => button.classList.contains('active'));
    const selectedButton = buttons[selectedIndex];
    if (!selectedButton) return;
    if (!window.matchMedia('(max-width: 800px)').matches) {
      dockIndicatorX = selectedButton.offsetLeft;
      dockIndicatorWidth = selectedButton.offsetWidth;
    }
    if (!dockInteracting) dockPosition = selectedIndex;
    dockReady = true;
  }

  function selectFeature(index: number) {
    featureIndex = (index + featureCandidates.length) % featureCandidates.length;
    featureLastInteraction = Date.now();
  }

  function onHeroPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse') return;
    heroPointerStartX = event.clientX;
    heroPointerStartY = event.clientY;
  }

  function onHeroPointerUp(event: PointerEvent) {
    if (event.pointerType === 'mouse' || featureCandidates.length < 2) return;
    const dx = event.clientX - heroPointerStartX;
    const dy = event.clientY - heroPointerStartY;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    selectFeature(featureIndex + (dx < 0 ? 1 : -1));
    suppressHeroClick = true;
    window.setTimeout(() => { suppressHeroClick = false; }, 400);
  }

  function heroGestures(node: HTMLElement) {
    const onClickCapture = (event: MouseEvent) => {
      if (!suppressHeroClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressHeroClick = false;
    };
    node.addEventListener('pointerdown', onHeroPointerDown);
    node.addEventListener('pointerup', onHeroPointerUp);
    node.addEventListener('click', onClickCapture, true);
    return {
      destroy() {
        node.removeEventListener('pointerdown', onHeroPointerDown);
        node.removeEventListener('pointerup', onHeroPointerUp);
        node.removeEventListener('click', onClickCapture, true);
      }
    };
  }

  function onDockPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' || !window.matchMedia('(max-width: 800px)').matches) return;
    dockPointerStartX = event.clientX;
    dockPointerStartY = event.clientY;
    dockPointerMoved = false;
    dockStretch = 1.03;
    dockInteracting = true;
  }

  function moveDockIndicatorToPointer(clientX: number) {
    if (!dockElement) return;
    const bounds = dockElement.getBoundingClientRect();
    const pointerX = (clientX - bounds.left) * dockElement.offsetWidth / bounds.width;
    const buttons = dockElement.querySelectorAll('button');
    if (!buttons.length) return;
    const padding = Number.parseFloat(getComputedStyle(dockElement).paddingLeft) || 0;
    const slotWidth = (dockElement.offsetWidth - padding * 2) / buttons.length;
    if (slotWidth > 0) dockPosition = Math.max(0, Math.min(buttons.length - 1,
      (pointerX - padding - slotWidth / 2) / slotWidth));
  }

  function onDockPointerMove(event: PointerEvent) {
    if (!dockInteracting) return;
    const dx = event.clientX - dockPointerStartX;
    const dy = event.clientY - dockPointerStartY;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 16) { dockInteracting = false; dockStretch = 1; updateDockIndicator(); return; }
    if (Math.abs(dx) < 8 && !dockPointerMoved) return;
    dockPointerMoved = true;
    dockStretch = 1.03 + Math.min(.09, Math.abs(dx) / 600);
    moveDockIndicatorToPointer(event.clientX);
  }

  function onDockPointerUp(event: PointerEvent) {
    if (!dockInteracting) return;
    dockInteracting = false;
    dockStretch = 1;
    if (!dockPointerMoved) { updateDockIndicator(); return; }
    const buttons = [...(dockElement?.querySelectorAll<HTMLButtonElement>('button') || [])];
    const targetIndex = buttons.findIndex((button) => {
      const bounds = button.getBoundingClientRect();
      return event.clientX >= bounds.left && event.clientX <= bounds.right;
    });
    if (targetIndex >= 0) {
      suppressDockClick = true;
      navigate((['home', 'search', 'library', 'settings'] as Tab[])[targetIndex]);
      window.setTimeout(() => { suppressDockClick = false; }, 0);
    } else updateDockIndicator();
  }

  onDestroy(() => nuvioMetadataController?.abort());

  onMount(() => {
    router = new HashRouter((route) => {
      const returningToTab = currentRoute.kind !== 'tab' && route.kind === 'tab' && route.tab === tab;
      rememberRoutePosition();
      currentRoute = route;
      void applyRoute(route, returningToTab);
    });
    bridge = bridgeAvailable();
    updateDockIndicator();
    const dockObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateDockIndicator);
    if (dockElement) {
      dockObserver?.observe(dockElement);
      dockElement.querySelectorAll('button').forEach((button) => dockObserver?.observe(button));
    }
    window.addEventListener('resize', updateDockIndicator);
    let lastScrollY = window.scrollY;
    let dockScrollDelta = 0;
    let lastScrollGesture = 0;
    const markScrollGesture = () => { lastScrollGesture = Date.now(); };
    const updateScroll = () => {
      const nextY = window.scrollY;
      const delta = nextY - lastScrollY;
      pageScrolled = nextY > 24;
      if (dockRestoringScroll) { lastScrollY = nextY; dockScrollDelta = 0; return; }
      if (nextY < 48) { dockCompact = false; dockScrollDelta = 0; }
      else if (Date.now() - lastScrollGesture < 300 && Math.abs(delta) > 1) {
        dockScrollDelta = Math.sign(delta) === Math.sign(dockScrollDelta) ? dockScrollDelta + delta : delta;
        if (dockScrollDelta > 60) { dockCompact = true; dockScrollDelta = 0; }
        else if (dockScrollDelta < -60) { dockCompact = false; dockScrollDelta = 0; }
      } else dockScrollDelta = 0;
      lastScrollY = nextY;
    };
    const closeSeasonOnEscape = (event: KeyboardEvent) => {
      if (openDiscoverDropdown && event.key === 'Tab') {
        const controls = [...document.querySelectorAll<HTMLButtonElement>('.discover-sheet button')];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
      }
      if (event.key !== 'Escape') return;
      if (activeTrailer) { event.preventDefault(); activeTrailer = null; }
      else if (openDiscoverDropdown) closeDiscoverMenu();
      else if (seasonPickerOpen) seasonPickerOpen = false;
      else if (searchHistoryOpen) searchHistoryOpen = false;
      else if (playing) closePlayer();
      else if (pluginSettingsTarget) pluginSettingsTarget = null;
      else if (accountPanel || managing || integrationsPanel) closeSettingsPanel();
      else if (selected && streamScreen) closeStreamScreen();
      else if (selected) closeDetail();
      else if (catalogPage) closeCatalogPage();
    };
    const closeMenusOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (seasonPickerOpen && !target.closest('.season-picker, .season-mobile-sheet')) seasonPickerOpen = false;
      if (searchHistoryOpen && !target.closest('.search-entry')) searchHistoryOpen = false;
    };
    updateScroll();
    window.addEventListener('scroll', updateScroll, { passive: true });
    window.addEventListener('touchmove', markScrollGesture, { passive: true });
    window.addEventListener('wheel', markScrollGesture, { passive: true });
    window.addEventListener('keydown', closeSeasonOnEscape);
    document.addEventListener('pointerdown', closeMenusOnOutsidePointer);
    tmdbKey = savedTmdbKey();
    const refreshSettings = savedCatalogRefresh();
    autoRefreshCatalogs = refreshSettings.auto;
    catalogRefreshInterval = refreshSettings.intervalMinutes;
    const detector = window.setInterval(() => { bridge = bridgeAvailable(); }, 1000);
    if (addons.length) void loadCatalogs();
    restoreReady = Promise.allSettled([restoreAddons(), restoreAccount(), restoreNuvio(), restorePlugins()])
      .then(() => { startupLoading = false; restorationComplete = true; });
    void applyRoute(currentRoute);
    const syncTimer = window.setInterval(() => { if (account && !accountSyncing) void syncAccount(); }, 10 * 60 * 1000);
    const nuvioTimer = window.setInterval(() => { if (nuvioSession && !nuvioSyncing && !pluginSaving && nuvioProfileReady) void syncNuvio(); }, 10 * 60 * 1000);
    const catalogTimer = window.setInterval(() => {
      if (autoRefreshCatalogs && addons.length && !loadingCatalogs && Date.now() - lastCatalogRefresh >= catalogRefreshInterval * 60_000) void loadCatalogs();
    }, 60_000);
    const featureTimer = window.setInterval(() => {
      if (tab === 'home' && !selected && !managing && !accountPanel && !document.hidden && featureCandidates.length > 1
        && Date.now() - featureLastInteraction > 8000
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        featureIndex = (featureIndex + 1) % featureCandidates.length;
      }
    }, 8000);
    return () => { window.clearTimeout(statusTimer); router?.destroy(); dockObserver?.disconnect(); window.removeEventListener('resize', updateDockIndicator); window.removeEventListener('scroll', updateScroll); window.removeEventListener('touchmove', markScrollGesture); window.removeEventListener('wheel', markScrollGesture); window.removeEventListener('keydown', closeSeasonOnEscape); document.removeEventListener('pointerdown', closeMenusOnOutsidePointer); window.clearTimeout(seasonWheelTimer); window.clearTimeout(searchHistoryTimer); window.clearInterval(detector); window.clearInterval(syncTimer); window.clearInterval(nuvioTimer); window.clearInterval(catalogTimer); window.clearInterval(featureTimer); };
  });

  async function restoreAddons() {
    const urls = initialLocalUrls;
    const previous = catalogConfigurationSignature(localAddons);
    const restored = await Promise.allSettled(urls.map(installAddon));
    localAddons = restored.map((result, index) => configuredAddon(result.status === 'fulfilled' ? result.value
      : { ...(initialLocalAddons.find((addon) => addon.manifestUrl === urls[index]) || unavailableAddon(urls[index], undefined, result.reason)),
        loadError: message(result.reason) }, 'local'));
    saveAddons('local-addons', 'browser', localAddons);
    if (previous !== catalogConfigurationSignature(localAddons)) void loadCatalogs();
    if (restored.some((result) => result.status === 'rejected')) addonError = 'Some saved addons could not be reached. You can retry them in Addons.';
  }

  async function restoreAccount() {
    const stored = initialStremioSession;
    if (!stored) return;
    const generation = ++accountGeneration;
    accountSyncing = true;
    try {
      const refreshed = await refreshUser(stored);
      if (generation !== accountGeneration) return;
      account = refreshed;
      if (addonDestination === 'local') addonDestination = 'stremio';
      saveSession(refreshed);
      await syncAccount();
    } catch (error) {
      if (generation === accountGeneration) {
        accountError = `${message(error)} Your saved sign-in was kept. Try syncing again when the service is available.`;
      }
    } finally {
      stremioRestoring = false;
      if (generation === accountGeneration) accountSyncing = false;
    }
  }

  async function connectAccount() {
    accountBusy = true;
    accountError = '';
    const generation = ++accountGeneration;
    try {
      const signedIn = loginMode === 'password' ? await login(email, password) : await loginWithKey(authKeyInput);
      if (generation !== accountGeneration) return;
      account = signedIn;
      if (addonDestination === 'local') addonDestination = 'stremio';
      saveSession(signedIn);
      password = '';
      authKeyInput = '';
      await syncAccount();
    } catch (error) {
      if (generation === accountGeneration) accountError = message(error);
    } finally {
      if (generation === accountGeneration) accountBusy = false;
    }
  }

  async function syncAccount() {
    const current = account;
    if (!current) return;
    const generation = accountGeneration;
    accountSyncing = true;
    accountError = '';
    const [addonsResult, libraryResult] = await Promise.allSettled([
      fetchAccountAddons(current.authKey),
      fetchAccountLibrary(current.authKey)
    ]);
    if (generation !== accountGeneration || account?.authKey !== current.authKey) return;
    if (addonsResult.status === 'fulfilled') {
      const previous = catalogConfigurationSignature(accountAddons);
      accountAddons = addonsResult.value.map((addon) => configuredAddon(addon, 'stremio', undefined, current.user._id));
      saveAddons('stremio-addons', current.user._id, accountAddons);
      if (previous !== catalogConfigurationSignature(accountAddons)) void loadCatalogs();
    }
    if (libraryResult.status === 'fulfilled') {
      accountLibrary = libraryResult.value;
      saveStremioLibrary(current.user._id, accountLibrary);
    }
    accountError = [addonsResult, libraryResult].filter((result) => result.status === 'rejected')
      .map((result) => result.status === 'rejected' ? message(result.reason) : '').join(' ');
    accountMessage = accountError ? '' : `Synced ${accountAddons.length} addons and ${accountLibrary.filter((item) => !item.removed && !item.temp).length} library titles.`;
    accountSyncing = false;
  }

  function disconnectAccount() {
    accountGeneration += 1;
    addonWorking = '';
    account = null;
    if (addonDestination === 'stremio') addonDestination = nuvioSession ? 'nuvio' : 'local';
    accountAddons = [];
    accountLibrary = [];
    progressLastWrite.clear();
    progressLastPosition.clear();
    progressInFlight.clear();
    progressPending.clear();
    accountSyncing = false;
    accountMessage = '';
    saveSession(null);
    clearStartupCache(['stremio-addons', 'stremio-library']);
    void loadCatalogs();
  }

  async function discoverNuvioBackend() {
    nuvioBusy = true;
    nuvioError = '';
    try {
      const configuration = await discoverNuvio(nuvioBackend);
      nuvioBackend = configuration.backendUrl;
      nuvioKey = configuration.publishableKey;
      nuvioMessage = 'Public backend settings loaded.';
    } catch (error) { nuvioError = message(error); }
    finally { nuvioBusy = false; }
  }

  async function restoreNuvio() {
    const stored = initialNuvioSession;
    if (!stored) return;
    const generation = ++nuvioGeneration;
    try {
      const current = await freshNuvioSession(stored);
      if (generation !== nuvioGeneration) return;
      nuvioSession = current;
      nuvioBackend = current.backendUrl;
      nuvioKey = current.publishableKey;
      await loadNuvioProfiles(current, generation);
    } catch (error) {
      if (generation === nuvioGeneration) {
        nuvioProfilesLoading = false;
        nuvioProfilesLoadFailed = true;
        nuvioError = `${message(error)} Your saved sign-in was kept. Retry profiles when the service is available.`;
      }
    } finally {
      nuvioRestoring = false;
    }
  }

  async function connectNuvio() {
    nuvioBusy = true;
    nuvioError = '';
    const generation = ++nuvioGeneration;
    try {
      const signedIn = await loginNuvio(nuvioBackend, nuvioKey, nuvioEmail, nuvioPassword);
      if (generation !== nuvioGeneration) return;
      nuvioSession = signedIn;
      saveNuvioSession(signedIn);
      nuvioPassword = '';
      await loadNuvioProfiles(signedIn, generation);
    } catch (error) { if (generation === nuvioGeneration) nuvioError = message(error); }
    finally { if (generation === nuvioGeneration) nuvioBusy = false; }
  }

  async function loadNuvioProfiles(current: NuvioSession, generation: number, create = false) {
    nuvioProfilesLoading = true;
    nuvioProfilesLoadFailed = false;
    nuvioError = '';
    nuvioMessage = '';
    try {
      const profiles = create ? await createNuvioPrimaryProfile(current) : await fetchNuvioProfiles(current);
      if (generation !== nuvioGeneration || nuvioSession !== current) return;
      nuvioProfiles = profiles;
      if (!profiles.length) {
        if (addonDestination === 'nuvio') addonDestination = account ? 'stremio' : 'local';
        nuvioMessage = 'This Nuvio account has no profiles yet. Create one here or in Nuvio Mobile.';
        return;
      }
      nuvioProfileIndex = savedNuvioProfile(current.user.id, profiles);
      if (profiles.find((profile) => profile.profile_index === nuvioProfileIndex)?.pin_enabled) {
        if (addonDestination === 'nuvio') addonDestination = account ? 'stremio' : 'local';
      } else {
        hydrateNuvioCache(current, nuvioProfileIndex);
        if (!account && addonDestination === 'local') addonDestination = 'nuvio';
        void loadCatalogs();
        await syncNuvio();
      }
    } catch (error) {
      if (generation === nuvioGeneration && nuvioSession === current) {
        nuvioProfilesLoadFailed = true;
        nuvioError = `Could not load Nuvio profiles: ${message(error)}`;
      }
    } finally {
      if (generation === nuvioGeneration) nuvioProfilesLoading = false;
    }
  }

  async function retryNuvioProfiles(create = false) {
    const current = nuvioSession;
    if (current) await loadNuvioProfiles(current, nuvioGeneration, create);
  }

  async function chooseNuvioProfile(index: number) {
    if (!nuvioProfiles.some((profile) => profile.profile_index === index)) return;
    nuvioGeneration += 1;
    pluginMutation++;
    pluginSaving = '';
    pluginSettingsTarget = null;
    nuvioSyncRequest += 1;
    addonWorking = '';
    nuvioProfileIndex = index;
    if (nuvioSession) writePersistentSession(NUVIO_PROFILE_KEY, { userId: nuvioSession.user.id, index });
    if (nuvioProfiles.find((profile) => profile.profile_index === index)?.pin_enabled) {
      if (addonDestination === 'nuvio') addonDestination = account ? 'stremio' : 'local';
      syncNewPlugin = false;
    }
    nuvioUnlockedProfile = null;
    nuvioPin = '';
    nuvioAddons = [];
    nuvioPlugins = [];
    nuvioLibrary = [];
    nuvioProgress = [];
    nuvioProgressLastWrite.clear();
    nuvioProgressLastPosition.clear();
    nuvioProgressInFlight.clear();
    nuvioProgressPending.clear();
    nuvioBusy = false;
    nuvioSyncing = false;
    nuvioMessage = '';
    nuvioError = '';
    if (!nuvioProfiles.find((profile) => profile.profile_index === index)?.pin_enabled && nuvioSession) hydrateNuvioCache(nuvioSession, index);
    await loadCatalogs();
    if (!nuvioProfiles.find((profile) => profile.profile_index === index)?.pin_enabled) await syncNuvio();
  }

  async function unlockNuvioProfile() {
    if (!nuvioSession) return;
    const current = nuvioSession;
    const index = nuvioProfileIndex;
    const generation = nuvioGeneration;
    nuvioBusy = true;
    nuvioError = '';
    try {
      await verifyNuvioPin(current, index, nuvioPin);
      if (generation !== nuvioGeneration || index !== nuvioProfileIndex) return;
      nuvioUnlockedProfile = index;
      nuvioPin = '';
      hydrateNuvioCache(current, index);
      void loadCatalogs();
      await syncNuvio();
    } catch (error) { if (generation === nuvioGeneration) nuvioError = message(error); }
    finally { if (generation === nuvioGeneration) nuvioBusy = false; }
  }

  async function syncNuvio() {
    if (pluginSaving) return;
    const current = nuvioSession;
    const selectedProfile = nuvioProfiles.find((item) => item.profile_index === nuvioProfileIndex);
    if (!current || !selectedProfile || (selectedProfile.pin_enabled && nuvioUnlockedProfile !== nuvioProfileIndex)) return;
    const generation = nuvioGeneration;
    const request = ++nuvioSyncRequest;
    const index = nuvioProfileIndex;
    const profile = selectedProfile;
    nuvioSyncing = true;
    nuvioError = '';
    const [addonsResult, pluginsResult, libraryResult, progressResult, pluginPreferencesResult] = await Promise.allSettled([
      fetchNuvioSources(current, 'addons', profile?.uses_primary_addons ? 1 : index),
      fetchNuvioSources(current, 'plugins', profile?.uses_primary_plugins ? 1 : index),
      fetchNuvioLibrary(current, index), fetchNuvioProgress(current, index),
      fetchNuvioPluginPreferences(current, profile.uses_primary_plugins ? 1 : index)
    ]);
    if (generation !== nuvioGeneration || index !== nuvioProfileIndex || request !== nuvioSyncRequest) return;
    const failures: string[] = [];
    if (addonsResult.status === 'fulfilled') {
      const previous = catalogConfigurationSignature(nuvioAddons);
      const resolved = await Promise.allSettled(addonsResult.value.map((row) => installAddon(row.url)));
      if (generation !== nuvioGeneration || index !== nuvioProfileIndex || request !== nuvioSyncRequest) return;
      nuvioAddons = resolved.map((result, rowIndex) => configuredAddon(result.status === 'fulfilled'
        ? result.value : unavailableAddon(addonsResult.value[rowIndex].url, addonsResult.value[rowIndex].name, result.reason),
        'nuvio', addonsResult.value[rowIndex].enabled !== false, `${current.backendUrl}:${current.user.id}:${index}`))
        .filter((addon, addonIndex, all) => all.findIndex((item) => item.manifestUrl === addon.manifestUrl) === addonIndex);
      if (resolved.some((result) => result.status === 'rejected')) failures.push('Some Nuvio addon manifests could not be loaded in this browser.');
      if (previous !== catalogConfigurationSignature(nuvioAddons)) void loadCatalogs();
      if (generation !== nuvioGeneration || index !== nuvioProfileIndex || request !== nuvioSyncRequest) return;
    } else failures.push(`Addons: ${message(addonsResult.reason)}`);
    if (pluginsResult.status === 'fulfilled') {
      const previousPreferences = nuvioPlugins.map((repo) => ({ url: repo.manifestUrl,
        scrapers: repo.scrapers.map((scraper) => ({ id: scraper.id, enabled: scraper.enabled, settings: scraper.settings })) }));
      const resolved = await Promise.allSettled(pluginsResult.value.filter((row) => row.enabled !== false).map((row) => installPlugin(row.url, false)));
      if (generation !== nuvioGeneration || index !== nuvioProfileIndex || request !== nuvioSyncRequest) return;
      nuvioPlugins = applyPluginPreferences(resolved.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
        pluginPreferencesResult.status === 'fulfilled' ? pluginPreferencesResult.value : previousPreferences);
      if (resolved.some((result) => result.status === 'rejected')) failures.push('Some Nuvio plugin repositories could not be loaded in this browser.');
    } else failures.push(`Plugins: ${message(pluginsResult.reason)}`);
    if (pluginPreferencesResult.status === 'rejected') failures.push(`Plugin settings: ${message(pluginPreferencesResult.reason)}`);
    if (progressResult.status === 'fulfilled') nuvioProgress = progressResult.value;
    else failures.push(`Progress: ${message(progressResult.reason)}`);
    if (libraryResult.status === 'fulfilled') nuvioLibrary = decorateNuvioLibrary(libraryResult.value, nuvioProgress);
    else failures.push(`Library: ${message(libraryResult.reason)}`);
    saveNuvioCache(current, index);
    nuvioError = failures.join(' ');
    nuvioMessage = failures.length ? '' : `Synced ${nuvioAddons.length} addons, ${nuvioPlugins.length} plugin repositories, and ${nuvioLibrary.length} library titles.`;
    nuvioSyncing = false;
  }

  function disconnectNuvio() {
    nuvioGeneration += 1;
    pluginMutation++;
    pluginSaving = '';
    pluginSettingsTarget = null;
    nuvioSyncRequest += 1;
    addonWorking = '';
    nuvioSession = null;
    if (addonDestination === 'nuvio') addonDestination = account ? 'stremio' : 'local';
    nuvioProfiles = [];
    nuvioProfilesLoading = false;
    nuvioProfilesLoadFailed = false;
    nuvioUnlockedProfile = null;
    nuvioAddons = [];
    nuvioPlugins = [];
    nuvioLibrary = [];
    nuvioProgress = [];
    nuvioProgressLastWrite.clear();
    nuvioProgressLastPosition.clear();
    nuvioProgressInFlight.clear();
    nuvioProgressPending.clear();
    nuvioBusy = false;
    nuvioSyncing = false;
    nuvioMessage = '';
    saveNuvioSession(null);
    writePersistentSession(NUVIO_PROFILE_KEY, null);
    clearStartupCache(['nuvio-addons', 'nuvio-plugins', 'nuvio-library', 'nuvio-progress']);
    void loadCatalogs();
  }

  function nuvioCacheScope(session: NuvioSession, index: number): string {
    return `${session.backendUrl}:${session.user.id}:${index}`;
  }

  function hydrateNuvioCache(session: NuvioSession, index: number) {
    const scope = nuvioCacheScope(session, index);
    nuvioAddons = (cachedAddons('nuvio-addons', scope) || [])
      .map((addon) => configuredAddon(addon, 'nuvio', addon.enabled, scope));
    nuvioPlugins = cachedNuvioPlugins(scope) || [];
    nuvioProgress = cachedNuvioProgress(scope) || [];
    nuvioLibrary = cachedNuvioLibrary(scope) || [];
  }

  function saveNuvioCache(session: NuvioSession, index: number) {
    const scope = nuvioCacheScope(session, index);
    saveAddons('nuvio-addons', scope, nuvioAddons);
    saveNuvioPlugins(scope, nuvioPlugins);
    saveNuvioProgress(scope, nuvioProgress);
    saveNuvioLibrary(scope, nuvioLibrary);
  }

  function savedNuvioProfile(userId: string, profiles: NuvioProfile[]): number {
    const saved = readPersistentSession(NUVIO_PROFILE_KEY, (value): value is { userId: string; index: number } => {
      if (!value || typeof value !== 'object') return false;
      const profile = value as { userId?: unknown; index?: unknown };
      return typeof profile.userId === 'string' && typeof profile.index === 'number';
    });
    if (saved?.userId === userId && profiles.some((profile) => profile.profile_index === saved.index)) return saved.index;
    return profiles[0]?.profile_index ?? 1;
  }

  async function restorePlugins() {
    const restored = await Promise.allSettled(savedPluginUrls().map((url) => installPlugin(url)));
    localPlugins = restored.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (restored.some((result) => result.status === 'rejected')) pluginError = 'Some saved plugin repositories could not be reached.';
  }

  async function loadCatalogs() {
    const request = ++catalogRequest;
    loadingCatalogs = true;
    lastCatalogRefresh = Date.now();
    const previousRows = new Map(rows.map((row) => [row.key, row.items]));
    const currentAddons = uniqueEnabledAddons([...accountAddons, ...nuvioAddons, ...localAddons]);
    const definitions = catalogs(currentAddons).flatMap(({ addon, catalog }) => {
      const extras = requiredCatalogExtras(catalog);
      return extras ? [{ addon, catalog, extras }] : [];
    });
    rows = definitions.map(({ addon, catalog }) => ({
      key: `${addon.manifestUrl}:${catalog.type}:${catalog.id}`,
      title: catalog.name, addon, catalog, items: previousRows.get(`${addon.manifestUrl}:${catalog.type}:${catalog.id}`)
        || cachedCatalog(`${addon.manifestUrl}:${catalog.type}:${catalog.id}`), loading: true
    }));
    if (currentAddons.length) startupLoading = false;
    await Promise.all(definitions.map(async ({ addon, catalog, extras }) => {
      const key = `${addon.manifestUrl}:${catalog.type}:${catalog.id}`;
      try {
        const page = await fetchCatalogPage(addon, catalog, extras);
        if (request === catalogRequest) {
          const items = uniqueCatalogItems(page.items);
          rows = rows.map((row) => row.key === key ? { ...row, items, loading: false,
            nextSkip: catalogNextSkip(catalog, page.rawItemCount, 0, 0), duplicatePages: 0 } : row);
          saveCatalogCache(key, items);
        }
      } catch (error) {
        if (request === catalogRequest) rows = rows.map((row) => row.key === key ? { ...row, loading: false, error: message(error) } : row);
      }
    }));
    if (request === catalogRequest) loadingCatalogs = false;
  }

  function uniqueCatalogItems(items: MetaPreview[]): MetaPreview[] {
    return [...new Map(items.map((item) => [`${item.type}:${item.id}`, item])).values()];
  }

  function catalogNextSkip(catalog: AddonCatalog, rawCount: number, skip: number, duplicatePages: number): number | null {
    const supportsSkip = (catalog.extra || []).some((extra) => extra.name === 'skip') || rawCount >= 100;
    return supportsSkip && rawCount > 0 && duplicatePages < 3 ? skip + rawCount : null;
  }

  async function loadMoreCatalogRow(key: string) {
    const row = rows.find((item) => item.key === key);
    if (!row || row.loading || row.loadingMore || row.nextSkip == null) return;
    const request = catalogRequest;
    const skip = row.nextSkip;
    const extras = requiredCatalogExtras(row.catalog);
    if (!extras) return;
    extras.skip = String(skip);
    rows = rows.map((item) => item.key === key ? { ...item, loadingMore: true, pageError: '' } : item);
    try {
      const page = await fetchCatalogPage(row.addon, row.catalog, extras);
      if (request !== catalogRequest) return;
      const current = rows.find((item) => item.key === key);
      if (!current || current.nextSkip !== skip) return;
      const items = uniqueCatalogItems([...current.items, ...page.items]);
      const duplicatePages = items.length === current.items.length ? (current.duplicatePages || 0) + 1 : 0;
      rows = rows.map((item) => item.key === key ? { ...item, items, loadingMore: false, duplicatePages,
        nextSkip: catalogNextSkip(item.catalog, page.rawItemCount, skip, duplicatePages) } : item);
      saveCatalogCache(key, items);
    } catch (error) {
      if (request === catalogRequest) rows = rows.map((item) => item.key === key
        ? { ...item, loadingMore: false, pageError: message(error) } : item);
    }
  }

  function openCatalogPage(row: CatalogRow, recordHistory = true) {
    if (recordHistory) {
      router?.push({ kind: 'catalog', addonId: row.addon.manifest.id, type: row.catalog.type, id: row.catalog.id });
      return;
    }
    catalogPage = row;
    catalogPageItems = row.items;
    catalogPageNextSkip = row.nextSkip ?? null;
    catalogPageDuplicatePages = row.duplicatePages || 0;
    catalogPageError = row.error || '';
    catalogPageLoading = false;
    ++catalogPageRequest;
    if (row.loading || row.error || !row.items.length) void loadCatalogPage(true);
  }

  function closeCatalogPage() {
    router?.back({ kind: 'tab', tab: 'home' });
  }

  function resetCatalogPage() {
    ++catalogPageRequest;
    catalogPage = null;
    catalogPageItems = [];
    catalogPageNextSkip = null;
    catalogPageError = '';
    catalogPageLoading = false;
  }

  async function loadCatalogPage(reset = false) {
    const row = catalogPage;
    if (!row || (catalogPageLoading && !reset) || (!reset && catalogPageNextSkip == null)) return;
    const request = reset ? ++catalogPageRequest : catalogPageRequest;
    const skip = reset ? 0 : catalogPageNextSkip!;
    const extras = requiredCatalogExtras(row.catalog);
    if (!extras) return;
    if (skip > 0) extras.skip = String(skip);
    catalogPageLoading = true;
    catalogPageError = '';
    try {
      const page = await fetchCatalogPage(row.addon, row.catalog, extras);
      if (request !== catalogPageRequest || catalogPage?.key !== row.key) return;
      const items = uniqueCatalogItems(reset ? page.items : [...catalogPageItems, ...page.items]);
      catalogPageDuplicatePages = reset || items.length > catalogPageItems.length ? 0 : catalogPageDuplicatePages + 1;
      catalogPageItems = items;
      catalogPageNextSkip = catalogNextSkip(row.catalog, page.rawItemCount, skip, catalogPageDuplicatePages);
    } catch (error) {
      if (request === catalogPageRequest) catalogPageError = message(error);
    } finally {
      if (request === catalogPageRequest) catalogPageLoading = false;
    }
  }

  function observeCatalogPageEnd(node: HTMLElement) {
    const panel = node.closest('.catalog-page-panel');
    if (!panel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !selected) void loadCatalogPage();
    }, { root: panel, rootMargin: '500px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function message(error: unknown): string {
    return error instanceof Error ? error.message : 'Something went wrong.';
  }

  function displayReleaseInfo(value?: string): string {
    const label = typeof value === 'string' ? value.trim() : '';
    return label.replace(/^(\d{4})\s*[-–—−]\s*$/, '$1');
  }

  function uniqueEnabledAddons(items: InstalledAddon[]): InstalledAddon[] {
    const seen = new Set<string>();
    return items.filter((addon) => {
      if (addon.enabled === false || seen.has(addon.manifestUrl)) return false;
      seen.add(addon.manifestUrl);
      return true;
    });
  }

  function catalogConfigurationSignature(items: InstalledAddon[]): string {
    return JSON.stringify(items.map((addon) => [addon.manifestUrl, addon.enabled, addon.disabledFeatures,
      addon.manifest.version, addon.manifest.catalogs]));
  }

  function updateCatalogRefresh() {
    saveCatalogRefresh(autoRefreshCatalogs, catalogRefreshInterval);
  }

  function removeCatalogCache() {
    clearCatalogCache();
    showStatus('Cached catalog rows cleared.');
  }

  function latestNuvioProgress(progress: NuvioProgress[]): NuvioProgress[] {
    const latest = new Map<string, NuvioProgress>();
    progress.forEach((entry) => {
      if (entry.duration <= 0 || entry.position <= 0 || entry.position >= entry.duration * .95) return;
      const key = `${entry.content_type}:${entry.content_id}`;
      if ((latest.get(key)?.last_watched || 0) < entry.last_watched) latest.set(key, entry);
    });
    return [...latest.values()];
  }

  function progressPreviews(progress: NuvioProgress[], catalogRows: CatalogRow[], library: NuvioLibraryItem[], metadata: Map<string, MetaPreview>) {
    const catalogItems = new Map<string, MetaPreview>(catalogRows.flatMap((row) => row.items).map((item) => [`${item.type}:${item.id}`, item]));
    return latestNuvioProgress(progress).flatMap((entry) => {
      const key = `${entry.content_type}:${entry.content_id}`;
      if (library.some((item) => `${item.type}:${item.id}` === key)) return [];
      const item = catalogItems.get(key) || metadata.get(key);
      return item ? [{ ...item, progress: Math.min(100, Math.round(entry.position / entry.duration * 100)),
        lastVideoId: entry.video_id, lastWatched: new Date(entry.last_watched).toISOString() }] : [];
    });
  }

  async function resolveNuvioProgressMetadata(scope: string, entries: NuvioProgress[], providers: InstalledAddon[]) {
    nuvioMetadataController?.abort();
    const controller = new AbortController();
    nuvioMetadataController = controller;
    if (scope !== resolvedNuvioMetadataScope) {
      resolvedNuvioMetadataScope = scope;
      nuvioProgressMetadata = new Map();
    }
    if (!scope) return;
    const pending = entries.filter((entry) => !nuvioProgressMetadata.has(`${entry.content_type}:${entry.content_id}`));
    // Resolve only the visible row's recent titles, with at most two requests in flight.
    async function worker() {
      while (pending.length && !controller.signal.aborted) {
        const entry = pending.shift()!;
        const key = `${entry.content_type}:${entry.content_id}`;
        const type = entry.content_type as 'movie' | 'series';
        const cached = previewMemory.get(key) || cachedDetailPreview(type, entry.content_id);
        if (cached && cached.name && cached.name !== entry.content_id) {
          nuvioProgressMetadata = new Map(nuvioProgressMetadata).set(key, cached);
          continue;
        }
        if (!providers.some((addon) => supports(addon, 'meta', type, entry.content_id))) continue;
        const lookup = new AbortController();
        const abort = () => lookup.abort();
        controller.signal.addEventListener('abort', abort, { once: true });
        const timeout = window.setTimeout(abort, 15_000);
        try {
          const meta = await fetchMeta(providers, { id: entry.content_id, type, name: entry.content_id }, lookup.signal);
          if (controller.signal.aborted || lookup.signal.aborted) return;
          if (!meta.name || meta.name === entry.content_id || meta.id !== entry.content_id || meta.type !== type) continue;
          nuvioProgressMetadata = new Map(nuvioProgressMetadata).set(key, meta);
          previewMemory.set(key, meta);
          detailMemory.set(key, meta);
          saveDetailPreview(meta);
        } catch {
          // A later sync or metadata-provider change can retry unavailable titles.
        } finally {
          window.clearTimeout(timeout);
          controller.signal.removeEventListener('abort', abort);
        }
      }
    }
    await Promise.all([worker(), worker()]);
  }

  async function addAddon() {
    addonError = '';
    adding = true;
    try {
      const addon = await installAddon(addonInput);
      const destinationAddons = addonDestination === 'stremio' ? accountAddons : addonDestination === 'nuvio' ? nuvioAddons : localAddons;
      if (destinationAddons.some((existing) => existing.manifestUrl === addon.manifestUrl)) throw new Error('This addon is already installed in the selected destination.');
      if (addonDestination === 'stremio' && account) {
        await addAccountAddon(account.authKey, addon);
        await syncAccount();
      } else if (addonDestination === 'nuvio' && nuvioSession) {
        if (!nuvioProfileReady) throw new Error('Choose and unlock a Nuvio profile before adding an addon.');
        if (activeNuvioProfile?.uses_primary_addons && nuvioProfileIndex !== 1) throw new Error('This profile uses primary-profile addons. Select the primary profile to change them.');
        await changeNuvioSource(nuvioSession, 'addons', nuvioProfileIndex, { url: addon.manifestUrl, name: addon.manifest.name }, 'add');
        await syncNuvio();
      } else {
        localAddons = [...localAddons, configuredAddon(addon, 'local')];
        saveAddonUrls(localAddons);
        saveAddons('local-addons', 'browser', localAddons);
      }
      addonInput = '';
      if (addonDestination === 'local') await loadCatalogs();
    } catch (error) {
      addonError = message(error);
    } finally {
      adding = false;
    }
  }

  async function removeAddon(url: string) {
    localAddons = localAddons.filter((addon) => addon.manifestUrl !== url);
    saveAddonUrls(localAddons);
    saveAddons('local-addons', 'browser', localAddons);
    clearAddonSettings('local', url);
    await loadCatalogs();
  }

  async function removeSyncedAddon(url: string) {
    if (!account) return;
    const current = account;
    addonError = '';
    try {
      await removeAccountAddon(current.authKey, url);
      clearAddonSettings('stremio', url, current.user._id);
      await syncAccount();
    } catch (error) { addonError = message(error); }
  }

  async function removeNuvioAddon(url: string) {
    if (!nuvioSession || !nuvioProfileReady) return;
    const current = nuvioSession;
    const index = nuvioProfileIndex;
    addonError = '';
    try {
      if (activeNuvioProfile?.uses_primary_addons && nuvioProfileIndex !== 1) throw new Error('Select the primary profile to change shared addons.');
      await changeNuvioSource(current, 'addons', index, { url }, 'remove');
      clearAddonSettings('nuvio', url, `${current.backendUrl}:${current.user.id}:${index}`);
      if (nuvioSession === current && nuvioProfileIndex === index) await syncNuvio();
    } catch (error) { addonError = message(error); }
  }

  function sourceAddons(source: AddonSource): InstalledAddon[] {
    return source === 'local' ? localAddons : source === 'stremio' ? accountAddons : nuvioAddons;
  }

  function addonScope(source: AddonSource): string {
    if (source === 'stremio') return account?.user._id || '';
    if (source === 'nuvio' && nuvioSession) return `${nuvioSession.backendUrl}:${nuvioSession.user.id}:${nuvioProfileIndex}`;
    return '';
  }

  function sourceStillCurrent(source: AddonSource, scope: string): boolean {
    return addonScope(source) === scope;
  }

  function replaceSourceAddon(source: AddonSource, url: string, replacement: InstalledAddon) {
    if (source === 'local') {
      localAddons = localAddons.map((addon) => addon.manifestUrl === url ? replacement : addon);
      saveAddons('local-addons', 'browser', localAddons);
    }
    else if (source === 'stremio') accountAddons = accountAddons.map((addon) => addon.manifestUrl === url ? replacement : addon);
    else nuvioAddons = nuvioAddons.map((addon) => addon.manifestUrl === url ? replacement : addon);
  }

  async function setAddonFeature(source: AddonSource, url: string, feature: AddonFeature, enabled: boolean) {
    const addon = sourceAddons(source).find((item) => item.manifestUrl === url);
    if (!addon) return;
    const scope = addonScope(source);
    const disabled = new Set(addonSettings(source, url, scope).disabledFeatures || []);
    if (enabled) disabled.delete(feature); else disabled.add(feature);
    saveAddonSettings(source, url, { disabledFeatures: [...disabled] }, scope);
    replaceSourceAddon(source, url, { ...addon, disabledFeatures: [...disabled] });
    if (feature === 'catalog') await loadCatalogs();
  }

  async function setAddonEnabled(source: AddonSource, url: string, enabled: boolean) {
    const addon = sourceAddons(source).find((item) => item.manifestUrl === url);
    if (!addon) return;
    const scope = addonScope(source);
    const currentNuvio = nuvioSession;
    const currentProfile = nuvioProfileIndex;
    const generation = nuvioGeneration;
    addonError = '';
    addonWorking = `${source}:${url}`;
    try {
      if (source === 'nuvio') {
        if (!currentNuvio || !nuvioProfileReady) throw new Error('Choose and unlock a Nuvio profile first.');
        if (activeNuvioProfile?.uses_primary_addons && nuvioProfileIndex !== 1) throw new Error('Select the primary profile to change shared addons.');
        await setNuvioAddonEnabled(currentNuvio, currentProfile, url, enabled);
      } else saveAddonSettings(source, url, { enabled }, scope);
      if (!sourceStillCurrent(source, scope) || (source === 'nuvio' && generation !== nuvioGeneration)) return;
      replaceSourceAddon(source, url, { ...addon, enabled });
      await loadCatalogs();
      if (enabled && addon.loadError && sourceStillCurrent(source, scope) && (source !== 'nuvio' || generation === nuvioGeneration)) await refreshAddon(source, url);
    } catch (error) { if (sourceStillCurrent(source, scope) && (source !== 'nuvio' || generation === nuvioGeneration)) addonError = message(error); }
    finally { if (sourceStillCurrent(source, scope) && (source !== 'nuvio' || generation === nuvioGeneration)) addonWorking = ''; }
  }

  async function moveAddon(source: AddonSource, url: string, direction: -1 | 1) {
    const items = sourceAddons(source);
    const scope = addonScope(source);
    const generation = nuvioGeneration;
    const index = items.findIndex((addon) => addon.manifestUrl === url);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= items.length) return;
    addonError = '';
    addonWorking = `${source}:${url}`;
    try {
      if (source === 'local') {
        const reordered = [...items];
        [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
        localAddons = reordered;
        saveAddonUrls(localAddons);
        saveAddons('local-addons', 'browser', localAddons);
        await loadCatalogs();
      } else if (source === 'stremio') {
        const current = account;
        if (!current) throw new Error('Connect Stremio first.');
        await moveAccountAddon(current.authKey, url, direction);
        if (sourceStillCurrent(source, scope)) await syncAccount();
      } else {
        const current = nuvioSession;
        const currentProfile = nuvioProfileIndex;
        if (!current || !nuvioProfileReady) throw new Error('Choose and unlock a Nuvio profile first.');
        if (activeNuvioProfile?.uses_primary_addons && nuvioProfileIndex !== 1) throw new Error('Select the primary profile to change shared addons.');
        await moveNuvioAddon(current, currentProfile, url, direction);
        if (sourceStillCurrent(source, scope) && generation === nuvioGeneration) await syncNuvio();
      }
    } catch (error) { if (sourceStillCurrent(source, scope) && (source !== 'nuvio' || generation === nuvioGeneration)) addonError = message(error); }
    finally { if (sourceStillCurrent(source, scope) && (source !== 'nuvio' || generation === nuvioGeneration)) addonWorking = ''; }
  }

  async function refreshAddon(source: AddonSource, url: string) {
    const addon = sourceAddons(source).find((item) => item.manifestUrl === url);
    if (!addon) return;
    const scope = addonScope(source);
    const generation = nuvioGeneration;
    addonError = '';
    addonWorking = `${source}:${url}`;
    try {
      const refreshed = await installAddon(url);
      if (!sourceStillCurrent(source, scope) || (source === 'nuvio' && generation !== nuvioGeneration) || !sourceAddons(source).some((item) => item.manifestUrl === url)) return;
      replaceSourceAddon(source, url, { ...addon, manifest: refreshed.manifest, loadError: undefined });
      await loadCatalogs();
      showStatus(`Refreshed ${refreshed.manifest.name}.`);
    } catch (error) {
      if (!sourceStillCurrent(source, scope) || (source === 'nuvio' && generation !== nuvioGeneration)) return;
      replaceSourceAddon(source, url, { ...addon, loadError: message(error) });
      addonError = `Could not refresh ${addon.manifest.name}: ${message(error)}`;
    } finally { if (sourceStillCurrent(source, scope) && (source !== 'nuvio' || generation === nuvioGeneration)) addonWorking = ''; }
  }

  async function copyAddonUrl(url: string) {
    try { await navigator.clipboard.writeText(url); showStatus('Addon URL copied.'); }
    catch { addonError = 'Could not copy the URL. Open the manifest and copy its address instead.'; }
  }

  async function confirmRemoveAddon() {
    const pending = addonPendingRemoval;
    addonPendingRemoval = null;
    if (!pending) return;
    if (pending.source === 'local') await removeAddon(pending.url);
    else if (pending.source === 'stremio') await removeSyncedAddon(pending.url);
    else await removeNuvioAddon(pending.url);
  }

  async function toggleLibrary() {
    if (!account || !selected) return;
    const current = account;
    const meta = selected;
    libraryBusy = true;
    detailError = '';
    try {
      const updated = await setLibraryMembership(current.authKey, meta,
        accountLibrary.find((item) => item.id === meta.id), !selectedInLibrary);
      if (account?.authKey === current.authKey) {
        accountLibrary = [...accountLibrary.filter((item) => item.id !== meta.id), updated];
        saveStremioLibrary(current.user._id, accountLibrary);
        showStatus(updated.removed ? 'Removed from Stremio library.' : 'Saved to Stremio library.');
      }
    } catch (error) { detailError = message(error); }
    finally { libraryBusy = false; }
  }

  async function toggleNuvioLibrary() {
    if (!nuvioSession || !selected || !nuvioProfileReady) return;
    const current = nuvioSession;
    const meta = selected;
    const index = nuvioProfileIndex;
    nuvioLibraryBusy = true;
    detailError = '';
    try {
      if (selectedInNuvioLibrary) {
        await deleteNuvioLibraryItem(current, index, meta);
        if (nuvioSession !== current || nuvioProfileIndex !== index) return;
        nuvioLibrary = nuvioLibrary.filter((item) => item.id !== meta.id || item.type !== meta.type);
        saveNuvioCache(current, index);
        showStatus('Removed from Nuvio library.');
      } else {
        await pushNuvioLibraryItem(current, index, meta);
        if (nuvioSession !== current || nuvioProfileIndex !== index) return;
        nuvioLibrary = [...nuvioLibrary, ...decorateNuvioLibrary([{ ...meta, addedAt: Date.now(), progress: 0 }], nuvioProgress)];
        saveNuvioCache(current, index);
        showStatus('Saved to Nuvio library.');
      }
    } catch (error) { detailError = message(error); }
    finally { nuvioLibraryBusy = false; }
  }

  function finalProgress(state: string): boolean {
    return ['paused', 'stopped', 'ended', 'complete', 'completed'].includes(state.toLowerCase());
  }

  function reportWatchProgress(meta: Meta, progress: WatchProgress) {
    if ((meta.type !== 'movie' && meta.type !== 'series') || !Number.isFinite(progress.positionMs)
      || !Number.isFinite(progress.durationMs) || progress.positionMs <= 0 || progress.durationMs <= 0) return;
    reportNuvioProgress(meta, progress);
    reportStremioProgress(meta, progress);
  }

  function reportStremioProgress(meta: Meta, progress: WatchProgress) {
    const current = account;
    if (!current) return;
    const key = `${meta.id}:${progress.videoId}`;
    const now = Date.now();
    if (progressInFlight.has(meta.id)) {
      progressPending.set(meta.id, { meta, progress });
      return;
    }
    if (now - (progressLastWrite.get(key) || 0) < 30_000 &&
      (!finalProgress(progress.state) || progressLastPosition.get(key) === Math.floor(progress.positionMs))) return;
    const generation = accountGeneration;
    progressInFlight.add(meta.id);
    progressLastWrite.set(key, now);
    progressLastPosition.set(key, Math.floor(progress.positionMs));
    void saveWatchProgress(current.authKey, meta, accountLibrary.find((item) => item.id === meta.id),
      progress.videoId, progress.positionMs, progress.durationMs)
      .then((updated) => {
        if (generation === accountGeneration && account?.authKey === current.authKey) {
          accountLibrary = [...accountLibrary.filter((item) => item.id !== meta.id), updated];
          saveStremioLibrary(current.user._id, accountLibrary);
        }
      })
      .catch((error) => {
        progressLastWrite.delete(key);
        progressLastPosition.delete(key);
        if (generation === accountGeneration) accountError = `Watch progress sync failed: ${message(error)}`;
      })
      .finally(() => {
        if (generation !== accountGeneration || account?.authKey !== current.authKey) return;
        progressInFlight.delete(meta.id);
        const pending = progressPending.get(meta.id);
        if (pending) {
          progressPending.delete(meta.id);
          reportStremioProgress(pending.meta, pending.progress);
        }
      });
  }

  function reportNuvioProgress(meta: Meta, progress: WatchProgress) {
    const current = nuvioSession;
    if (!current || !nuvioProfileReady || (meta.type !== 'movie' && meta.type !== 'series')) return;
    const key = `${meta.id}:${progress.videoId}`;
    const now = Date.now();
    if (nuvioProgressInFlight.has(key)) {
      nuvioProgressPending.set(key, { meta, progress });
      return;
    }
    if (now - (nuvioProgressLastWrite.get(key) || 0) < 30_000 &&
      (!finalProgress(progress.state) || nuvioProgressLastPosition.get(key) === Math.floor(progress.positionMs))) return;
    const generation = nuvioGeneration;
    const index = nuvioProfileIndex;
    const video = meta.videos?.find((item) => item.id === progress.videoId)
      || (episode?.id === progress.videoId ? episode : null);
    nuvioProgressInFlight.add(key);
    nuvioProgressLastWrite.set(key, now);
    nuvioProgressLastPosition.set(key, Math.floor(progress.positionMs));
    void pushNuvioProgress(current, index, meta, video, progress.positionMs, progress.durationMs)
      .then(() => {
        if (generation !== nuvioGeneration || index !== nuvioProfileIndex) return;
        const entry: NuvioProgress = { progress_key: video?.season != null && video.episode != null ? `${meta.id}_s${video.season}e${video.episode}` : meta.id,
          content_id: meta.id, content_type: meta.type, video_id: progress.videoId, season: video?.season, episode: video?.episode,
          position: progress.positionMs, duration: progress.durationMs, last_watched: now };
        nuvioProgress = [...nuvioProgress.filter((item) => item.progress_key !== entry.progress_key), entry];
        nuvioLibrary = decorateNuvioLibrary(nuvioLibrary, nuvioProgress);
        saveNuvioCache(current, index);
      })
      .catch((error) => {
        nuvioProgressLastWrite.delete(key);
        nuvioProgressLastPosition.delete(key);
        if (generation === nuvioGeneration) nuvioError = `Watch progress sync failed: ${message(error)}`;
      })
      .finally(() => {
        if (generation !== nuvioGeneration || index !== nuvioProfileIndex || nuvioSession?.user.id !== current.user.id) return;
        nuvioProgressInFlight.delete(key);
        const pending = nuvioProgressPending.get(key);
        if (pending) {
          nuvioProgressPending.delete(key);
          reportNuvioProgress(pending.meta, pending.progress);
        }
      });
  }

  async function addPlugin() {
    addingPlugin = true;
    pluginError = '';
    try {
      const repo = await installPlugin(pluginInput);
      const destinationPlugins = nuvioSession && syncNewPlugin ? nuvioPlugins : localPlugins;
      if (destinationPlugins.some((existing) => existing.manifestUrl === repo.manifestUrl)) throw new Error('This plugin repository is already installed in the selected destination.');
      if (nuvioSession && syncNewPlugin) {
        if (!nuvioProfileReady) throw new Error('Choose and unlock a Nuvio profile before adding a plugin.');
        if (activeNuvioProfile?.uses_primary_plugins && nuvioProfileIndex !== 1) throw new Error('Select the primary profile to change shared plugins.');
        await changeNuvioSource(nuvioSession, 'plugins', nuvioProfileIndex, { url: repo.manifestUrl, name: repo.name }, 'add');
        await syncNuvio();
      } else {
        localPlugins = [...localPlugins, repo];
        savePluginUrls(localPlugins);
      }
      pluginInput = '';
    } catch (error) { pluginError = message(error); }
    finally { addingPlugin = false; }
  }

  function removePlugin(url: string) {
    localPlugins = localPlugins.filter((repo) => repo.manifestUrl !== url);
    savePluginUrls(localPlugins);
  }

  async function updatePluginScraper(url: string, scraperId: string, patch: Omit<ScraperPreference, 'id'>) {
    if (pluginSaving) throw new Error('Wait for the current plugin change to finish.');
    const synced = nuvioPlugins.some((repo) => repo.manifestUrl === url);
    if (!synced) {
      if (!localPlugins.some((repo) => repo.manifestUrl === url)) throw new Error('This plugin repository is no longer installed.');
      if (patch.settings) saveLocalScraperSettings(url, scraperId, patch.settings);
      if (patch.enabled !== undefined) localPlugins = toggleScraper(localPlugins, url, scraperId, patch.enabled);
      localPlugins = applyPluginPreferences(localPlugins, [{ url, scrapers: [{ id: scraperId, ...patch }] }]);
      return;
    }
    const current = nuvioSession;
    const index = nuvioProfileIndex;
    const generation = nuvioGeneration;
    if (!current || !nuvioProfileReady) throw new Error('Choose and unlock a Nuvio profile first.');
    if (activeNuvioProfile?.uses_primary_plugins && index !== 1) throw new Error('Select the primary profile to change shared plugins.');
    const mutation = ++pluginMutation;
    pluginSaving = `${url}:${scraperId}`;
    // Invalidate a poll started before this edit; it must not replace the saved value.
    nuvioSyncRequest++;
    nuvioSyncing = false;
    try {
      const preferences = await changeNuvioScraperPreference(current, index, url, scraperId, patch);
      if (generation !== nuvioGeneration || index !== nuvioProfileIndex || mutation !== pluginMutation) return;
      nuvioPlugins = applyPluginPreferences(nuvioPlugins, preferences);
      saveNuvioCache(current, index);
    } finally { if (mutation === pluginMutation) pluginSaving = ''; }
  }

  async function togglePluginScraper(url: string, scraperId: string, enabled: boolean) {
    pluginError = '';
    const generation = nuvioGeneration;
    try { await updatePluginScraper(url, scraperId, { enabled }); }
    catch (error) { if (generation === nuvioGeneration) pluginError = message(error); }
  }

  async function removeNuvioPlugin(url: string) {
    if (!nuvioSession || !nuvioProfileReady) return;
    pluginError = '';
    try {
      if (activeNuvioProfile?.uses_primary_plugins && nuvioProfileIndex !== 1) throw new Error('Select the primary profile to change shared plugins.');
      await changeNuvioSource(nuvioSession, 'plugins', nuvioProfileIndex, { url }, 'remove');
      await syncNuvio();
    } catch (error) { pluginError = message(error); }
  }

  async function runSearch() {
    const query = search.trim();
    submittedSearch = query;
    selectTab('search');
    if (currentRoute.kind === 'tab' && currentRoute.tab === 'search') {
      replaceRoute({ ...currentRoute, query: query || undefined });
    }
    const request = ++searchRequest;
    searchResults = [];
    window.clearTimeout(searchHistoryTimer);
    if (!query) { searching = false; return; }
    searchHistoryTimer = window.setTimeout(() => {
      if (submittedSearch !== query) return;
      searchHistory = [query, ...searchHistory.filter((item) => item.toLocaleLowerCase() !== query.toLocaleLowerCase())].slice(0, 8);
      saveSearchHistory();
    }, SEARCH_HISTORY_DELAY_MS);
    searching = true;
    const targets = catalogs(addons).flatMap(({ addon, catalog }) => {
      if (!(catalog.extra || []).some((extra) => extra.name === 'search')) return [];
      const extras = requiredCatalogExtras(catalog, query);
      return extras ? [{ addon, catalog, extras }] : [];
    });
    const results = await Promise.allSettled(targets.map(({ addon, catalog, extras }) => fetchCatalog(addon, catalog, extras)));
    if (request === searchRequest) {
      const unique = new Map<string, MetaPreview>();
      results.forEach((result) => {
        if (result.status === 'fulfilled') result.value.forEach((item) => unique.set(`${item.type}:${item.id}`, item));
      });
      searchResults = [...unique.values()];
      searching = false;
    }
  }

  function saveSearchHistory() {
    try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searchHistory)); }
    catch { /* Search works when local storage is unavailable. */ }
  }

  function useSearchHistory(query: string) {
    updateSearch(query);
    searchHistoryOpen = false;
    void runSearch();
  }

  function removeSearchHistory(query: string) {
    if (submittedSearch === query) window.clearTimeout(searchHistoryTimer);
    searchHistory = searchHistory.filter((item) => item !== query);
    saveSearchHistory();
  }

  function updateSearch(value: string) {
    search = value;
    searchHistoryOpen = false;
  }

  function clearSearch() {
    updateSearch('');
    void runSearch();
  }

  function discoverTypeLabel(type: string): string {
    return type === 'movie' ? 'Movies' : type === 'series' ? 'TV Shows'
      : type === 'sport' ? 'Sports' : type === 'library' ? 'Library' : type;
  }

  function discoverCatalogLabel(row: CatalogRow): string {
    const sameName = discoverCatalogOptions.filter((option) => option.catalog.name === row.catalog.name);
    return sameName.length > 1 ? `${row.catalog.name} · ${row.addon.manifest.name}` : row.catalog.name;
  }

  function saveDiscoverCatalogKey(key: string) {
    try { localStorage.setItem(DISCOVER_CATALOG_KEY, key); } catch { /* Selection still works without storage. */ }
  }

  function chooseDiscoverType(type: string) {
    discoverType = type;
    discoverGenre = '';
    discoverCatalogKey = discoverSources.find((row) => row.catalog.type === type)?.key || '';
    saveDiscoverCatalogKey(discoverCatalogKey);
  }

  function chooseDiscoverCatalog(key: string) {
    discoverCatalogKey = key;
    discoverGenre = '';
    saveDiscoverCatalogKey(key);
  }

  function openDiscoverMenu(kind: DiscoverDropdown, trigger: HTMLButtonElement) {
    discoverDropdownTrigger = trigger;
    openDiscoverDropdown = kind;
    void tick().then(() => document.querySelector<HTMLButtonElement>('.discover-sheet-option.selected')?.focus());
  }

  function closeDiscoverMenu() {
    openDiscoverDropdown = null;
    void tick().then(() => discoverDropdownTrigger?.focus());
  }

  function chooseDiscoverOption(key: string) {
    if (openDiscoverDropdown === 'type') chooseDiscoverType(key);
    else if (openDiscoverDropdown === 'catalog') chooseDiscoverCatalog(key);
    else if (openDiscoverDropdown === 'genre') discoverGenre = key;
    closeDiscoverMenu();
  }

  async function loadDiscoverFeed(reset: boolean) {
    const row = selectedDiscoverCatalog;
    if (!row || (!reset && (discoverLoading || discoverNextSkip === null))) return;
    const request = reset ? ++discoverRequest : discoverRequest;
    const skip = reset ? 0 : discoverNextSkip!;
    const extras = requiredCatalogExtras(row.catalog) || {};
    if (effectiveDiscoverGenre) extras.genre = effectiveDiscoverGenre;
    if (skip > 0) extras.skip = String(skip);
    if (reset) {
      discoverItems = [];
      discoverNextSkip = null;
      discoverDuplicatePages = 0;
    }
    discoverLoading = true;
    discoverError = '';
    try {
      const page = await fetchCatalogPage(row.addon, row.catalog, extras);
      if (request !== discoverRequest) return;
      const seen = new Set(discoverItems.map((item) => `${item.type}:${item.id}`));
      const incoming = page.items.filter((item) => {
        const key = `${item.type}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      discoverItems = reset ? incoming : [...discoverItems, ...incoming];
      discoverDuplicatePages = incoming.length ? 0 : discoverDuplicatePages + 1;
      const canPage = (row.catalog.extra || []).some((extra) => extra.name === 'skip') || page.rawItemCount >= 100;
      discoverNextSkip = canPage && page.rawItemCount > 0 && discoverDuplicatePages < 3
        ? skip + page.rawItemCount : null;
    } catch (error) {
      if (request !== discoverRequest) return;
      discoverError = message(error);
      if (reset) discoverNextSkip = null;
    } finally {
      if (request === discoverRequest) discoverLoading = false;
    }
  }

  function observeDiscoverEnd(node: HTMLElement) {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && tab === 'search' && !submittedSearch && !discoverError) void loadDiscoverFeed(false);
    }, { rootMargin: '500px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function rememberRoutePosition() {
    // Remember browsing positions for returns from content, alongside content panel positions.
    routePositions.set(routeHash(currentRoute), { window: window.scrollY,
      panel: routePanel()?.scrollTop || 0,
      episodes: episodeListElement?.scrollLeft || 0 });
  }

  function routePanel() {
    const selector = selected ? streamScreen ? '.stream-panel' : '.detail-panel' : '.catalog-page-panel';
    return [...document.querySelectorAll<HTMLElement>(selector)].at(-1);
  }

  function replaceRoute(route: AppRoute) {
    const oldPosition = routePositions.get(routeHash(currentRoute));
    currentRoute = route;
    router?.replace(route);
    if (oldPosition) routePositions.set(routeHash(route), oldPosition);
  }

  function mediaRoute(kind: MediaRoute['kind'], video = episode): MediaRoute {
    return { kind, type: selected!.type, id: selected!.id,
      videoId: video?.id, season: selected?.type === 'series' ? video?.season ?? season : undefined,
      episode: video?.episode };
  }

  function openSettingsPanel(panel: 'accounts' | 'addons' | 'integrations') {
    router?.push({ kind: 'tab', tab: 'settings', panel });
  }

  function closeSettingsPanel() {
    pluginSettingsTarget = null;
    router?.back({ kind: 'tab', tab: 'settings' });
  }

  async function applyRoute(route: AppRoute, returningToTab = false) {
    activeTrailer = null;
    const request = ++routeRequest;
    const actionToken = ++streamActionRequest;
    const automaticAction = pendingAutoAction;
    pendingAutoAction = null;
    const previousMeta = loadingDetail ? undefined : selected;
    // Keep the same source screen alive beneath the player, including unfinished lookups.
    const retainMedia = (route.kind === 'streams' || route.kind === 'player')
      && streamScreen && !loadingDetail && selected?.id === route.id && selected?.type === route.type
      && episode?.id === route.videoId;
    resetPlayer();
    if (!retainMedia) resetDetail();
    if (route.kind === 'tab' || (route.kind === 'catalog' && (catalogPage?.addon.manifest.id !== route.addonId
      || catalogPage?.catalog.type !== route.type || catalogPage?.catalog.id !== route.id))) resetCatalogPage();
    accountPanel = false;
    managing = false;
    pluginSettingsTarget = null;
    integrationsPanel = false;
    openDiscoverDropdown = null;
    searchHistoryOpen = false;
    if (route.kind === 'tab') {
      selectTab(route.tab);
      accountPanel = route.panel === 'accounts';
      managing = route.panel === 'addons';
      integrationsPanel = route.panel === 'integrations';
      if (route.tab === 'search' && submittedSearch !== (route.query || '')) {
        search = route.query || '';
        if (!catalogs(addons).some(({ catalog }) => requiredCatalogExtras(catalog, search.trim())?.search)) await restoreReady;
        if (request !== routeRequest) return;
        await tick();
        void runSearch();
      }
    } else {
      // Use cached sources immediately; remote account refresh is background work.
      if (route.kind !== 'catalog' && !retainMedia) {
        const key = `${route.type}:${route.id}`;
        selected = detailMemory.get(key) || previewMemory.get(key) || cachedDetailPreview(route.type, route.id)
          || initialAccountLibrary.find((item) => item.type === route.type && item.id === route.id)
          || catalogs([...initialAccountAddons, ...initialLocalAddons]).flatMap(({ addon, catalog }) =>
            cachedCatalog(`${addon.manifestUrl}:${catalog.type}:${catalog.id}`))
            .find((item) => item.type === route.type && item.id === route.id)
          || { type: route.type, id: route.id, name: route.id };
        loadingDetail = true;
        streamScreen = route.kind !== 'detail';
      }
      await tick();
      const needsSources = route.kind === 'catalog'
        ? !rows.some((row) => row.addon.manifest.id === route.addonId && row.catalog.type === route.type && row.catalog.id === route.id)
        : !retainMedia && !detailMemory.has(`${route.type}:${route.id}`)
          && !addons.some((addon) => supports(addon, 'meta', route.type, route.id))
          && !(tmdbSettings.enabled && tmdbKey.trim() && /^tmdb:\d+$/.test(route.id));
      if (needsSources) { await restoreReady; await tick(); }
      if (request !== routeRequest) return;
      if (route.kind === 'catalog') {
        const row = rows.find((row) => row.addon.manifest.id === route.addonId
          && row.catalog.type === route.type && row.catalog.id === route.id);
        if (row) {
          // Retain the catalog's loaded pages beneath title details.
          if (catalogPage?.key !== row.key) openCatalogPage(row, false);
        } else {
          // The link cannot install a configured addon on someone else's device.
          addonError = 'This catalog is not available. Install or enable its addon first.';
          replaceRoute({ kind: 'tab', tab: 'settings', panel: 'addons' });
          selectTab('settings');
          managing = true;
        }
      } else {
        const key = `${route.type}:${route.id}`;
        const preview = detailMemory.get(key) || previewMemory.get(key) || cachedDetailPreview(route.type, route.id)
          || rows.flatMap((row) => row.items).find((item) => item.type === route.type && item.id === route.id)
          || savedLibrary.find((item) => item.type === route.type && item.id === route.id)
          || { type: route.type, id: route.id, name: route.id };
        if (!retainMedia) {
          streamBackToDetail = router?.parent()?.kind === 'detail';
          await loadDetail(preview, route, previousMeta?.type === route.type && previousMeta?.id === route.id ? previousMeta : undefined,
            () => {
              if (route.kind === 'streams' && automaticAction && request === routeRequest && actionToken === streamActionRequest
                && automaticAction.type === route.type && automaticAction.id === route.id
                && (!automaticAction.videoId || automaticAction.videoId === episode?.id)
                && streamSelection.enabled && !detailError && (selected?.type !== 'series' || episode)) {
                void startPreferredStream(automaticAction.action, true);
              }
            });
        }
        if (request !== routeRequest) return;
        if (route.kind === 'player') {
          const choice = playerMemory.get(routeHash(route));
          if (choice) await playInBrowser(choice.stream, false, choice.selection);
          else {
            const fallback = mediaRoute('streams');
            const parent = router?.parent();
            // Reuse the existing stream entry so reloading a player does not add a duplicate Back step.
            if (parent && routeHash(parent) === routeHash(fallback)) {
              router?.back(fallback);
              return;
            }
            replaceRoute(fallback); // Shared player links require a fresh stream selection.
          }
        } else if (route.kind === 'streams' && automaticAction && actionToken === streamActionRequest
          && automaticAction.type === route.type && automaticAction.id === route.id
          && (!automaticAction.videoId || automaticAction.videoId === episode?.id)
          && streamSelection.enabled && !detailError && (selected?.type !== 'series' || episode)) {
          await startPreferredStream(automaticAction.action);
        }
      }
    }
    await tick();
    if (request !== routeRequest) return;
    if (route.kind === 'tab') {
      dockCompact = false;
      // Switching tabs starts fresh; closing content restores the tab beneath it.
      if (!returningToTab) {
        window.scrollTo(0, 0);
        return;
      }
    }
    const position = routePositions.get(routeHash(currentRoute));
    if (position) {
      window.scrollTo(0, position.window);
      const panel = routePanel();
      if (panel) panel.scrollTop = position.panel;
      if (episodeListElement) episodeListElement.scrollLeft = position.episodes;
    } else if (selected && !streamScreen) revealSelectedEpisode();
  }

  function openDetail(preview: MetaPreview, fromContinue = false) {
    previewMemory.set(`${preview.type}:${preview.id}`, preview);
    pendingAutoAction = streamSelection.enabled && fromContinue
      ? { type: preview.type, id: preview.id, action: 'play' } : null;
    router?.push({ kind: fromContinue ? 'streams' : 'detail', type: preview.type, id: preview.id });
  }

  async function loadDetail(preview: MetaPreview, route: MediaRoute, cached?: Meta, onStreamsUpdate?: () => void) {
    const fromContinue = route.kind !== 'detail';
    const request = ++detailRequest;
    selected = preview;
    streamScreen = fromContinue;
    detailError = '';
    streams = [];
    activeStreamSources = [];
    selectedStreamSource = '';
    episode = null;
    seasonPickerOpen = false;
    detailExpanded = false;
    loadingDetail = true;
    try {
      const remembered = detailMemory.get(`${preview.type}:${preview.id}`) || cached;
      let meta = remembered || await fetchMeta(addons, preview);
      let initialTmdb: TmdbMetadata | null = null;
      if (!remembered && /^tmdb:\d+$/.test(preview.id) && tmdbSettings.enabled && tmdbKey.trim()) {
        initialTmdb = await fetchTmdbMetadata(preview, tmdbKey, { ...tmdbSettings, collections: false });
        if (request !== detailRequest) return;
        if (initialTmdb) {
          const imdbId = initialTmdb.data.imdb_id || initialTmdb.data.external_ids?.imdb_id;
          const lookup = { ...preview, id: /^tt\d+$/.test(imdbId || '') ? imdbId! : preview.id };
          meta = await fetchMeta(addons, lookup);
          if (meta.name === meta.id) meta = { ...meta, name: initialTmdb.data.title || initialTmdb.data.name || meta.name };
        }
      }
      if (request !== detailRequest) return;
      selected = meta;
      if (!remembered) saveDetailPreview(meta);
      if (meta.name === meta.id) detailError = 'Could not load this title. Check that its metadata addon is enabled and reachable.';
      if (!initialTmdb && !addons.some((addon) => supports(addon, 'meta', meta.type, meta.id)) && !meta.videos?.length) {
        detailError = 'Install or enable an addon that provides metadata for this title.';
      }
      detailMemory.set(`${meta.type}:${meta.id}`, meta);
      if (preview.id !== meta.id) detailMemory.set(`${preview.type}:${preview.id}`, meta);
      season = route.season ?? defaultSeason(meta.videos);
      const recentProgress = nuvioProgress.filter((entry) => entry.content_id === meta.id && entry.content_type === meta.type
        && entry.position > 0 && entry.duration > 0 && entry.position < entry.duration * .95)
        .sort((a, b) => b.last_watched - a.last_watched)[0];
      const fallbackId = recentProgress?.video_id || accountLibrary.find((item) => item.id === meta.id)?.lastVideoId
        || (preview as MetaPreview & { lastVideoId?: string }).lastVideoId;
      const fallbackCoordinates = fallbackId?.match(/:(\d+):(\d+)$/);
      const linkedVideo = (route.videoId ? meta.videos?.find((video) => video.id === route.videoId) : null)
        || meta.videos?.find((video) => route.season !== undefined && route.episode !== undefined
          && video.season === route.season && video.episode === route.episode)
        || (route.videoId ? { id: route.videoId, season: route.season, episode: route.episode } : null);
      const resumeVideo = linkedVideo || (route.season !== undefined && route.kind === 'detail' ? null
        : resumeEpisode(meta, accountLibrary, nuvioLibrary, nuvioProgress))
        || (fromContinue && meta.type === 'series' && fallbackId
          ? { id: fallbackId, season: recentProgress?.season ?? (fallbackCoordinates ? Number(fallbackCoordinates[1]) : undefined),
            episode: recentProgress?.episode ?? (fallbackCoordinates ? Number(fallbackCoordinates[2]) : undefined) } : null);
      if (meta.type === 'series' && resumeVideo) {
        season = resumeVideo.season ?? season;
        episode = resumeVideo;
        await tick();
        if (request !== detailRequest) return;
        if (!fromContinue) revealSelectedEpisode();
      }
      if (request === detailRequest && currentRoute.kind !== 'tab' && currentRoute.kind !== 'catalog') {
        replaceRoute(mediaRoute(route.kind));
      }
      loadingDetail = false;
      void enrichDetail(meta);
      if (fromContinue && (meta.type !== 'series' || resumeVideo)) await loadStreams(meta.type, resumeVideo?.id || meta.id, false, onStreamsUpdate);
    } catch (error) {
      if (request === detailRequest) detailError = message(error);
    } finally {
      if (request === detailRequest) loadingDetail = false;
    }
  }

  function closeDetail() {
    router?.back({ kind: 'tab', tab });
  }

  function updateTmdbSettings(settings: TmdbSettings) {
    tmdbSettings = settings;
    saveTmdbSettings(settings);
  }

  function updateTmdbKey(key: string) {
    tmdbKey = key;
    saveTmdbKey(key);
  }

  async function enrichDetail(meta: Meta) {
    const generation = ++enrichmentGeneration;
    enrichmentError = '';
    tmdbMetadata = null;
    if (!tmdbSettings.enabled || !tmdbKey.trim() || (meta.type !== 'movie' && meta.type !== 'series')) return;
    const settings = { ...tmdbSettings };
    enrichmentBusy = true;
    try {
      const data = await fetchTmdbMetadata(meta, tmdbKey, settings);
      if (generation !== enrichmentGeneration || selected?.id !== meta.id || selected.type !== meta.type) return;
      if (data) {
        tmdbMetadata = data;
        selected = applyTmdbMetadata(meta, data, settings);
        if (episode) episode = selected.videos?.find((video) => video.id === episode?.id) || episode;
        saveDetailPreview(selected);
      }
    } catch (error) {
      if (generation === enrichmentGeneration) enrichmentError = message(error);
    } finally { if (generation === enrichmentGeneration) enrichmentBusy = false; }
  }

  async function enrichCurrentSeason() {
    const meta = selected;
    const data = tmdbMetadata;
    if (!meta || !data || meta.type !== 'series' || !meta.videos?.some((video) => video.season === season)) return;
    const request = ++enrichmentSeasonRequest;
    const generation = enrichmentGeneration;
    const selectedSeason = season;
    const settings = { ...tmdbSettings };
    try {
      const details = await fetchTmdbSeason(data.id, selectedSeason, tmdbKey, settings.language);
      if (request !== enrichmentSeasonRequest || generation !== enrichmentGeneration || selected?.id !== meta.id) return;
      selected = { ...selected, videos: applyTmdbSeason(selected.videos || [], selectedSeason, details, settings) };
      if (episode) episode = selected.videos?.find((video) => video.id === episode?.id) || episode;
    } catch (error) { if (generation === enrichmentGeneration && request === enrichmentSeasonRequest) enrichmentError = message(error); }
  }

  function resetDetail() {
    enrichmentGeneration += 1;
    enrichmentSeasonRequest += 1;
    tmdbMetadata = null;
    enrichmentBusy = false;
    enrichmentError = '';
    lastEnrichmentSeasonKey = '';
    detailRequest += 1;
    streamRequest += 1;
    selected = null;
    streamScreen = false;
    seasonPickerOpen = false;
    episode = null;
    streams = [];
    loadingStreams = false;
    restoringStreamSources = false;
    loadingDetail = false;
    pendingEpisodeAction = 'play';
  }

  function navigate(next: Tab) {
    const target: AppRoute = { kind: 'tab', tab: next, query: next === 'search' ? submittedSearch || undefined : undefined };
    if (routeHash(target) === routeHash(currentRoute)) return;
    router?.push(target);
  }

  function selectTab(next: Tab) {
    openDiscoverDropdown = null;
    if (next === tab) return;
    const request = ++navigationRequest;
    dockRestoringScroll = true;
    tab = next;
    void tick().then(() => {
      if (request !== navigationRequest) return;
      window.scrollTo(0, 0);
      window.requestAnimationFrame(() => {
        if (request !== navigationRequest) return;
        if (window.scrollY < 48) dockCompact = false;
        dockRestoringScroll = false;
      });
    });
  }

  function detailJump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function detailPlay(action: 'play' | 'cast' = 'play') {
    if (!selected || loadingDetail) return;
    if (selected.type === 'series') {
      if (episode && (detailResumeMs > 0 || action === 'cast')) {
        openStreamScreen(episode, action);
        return;
      }
      pendingEpisodeAction = action;
      detailJump('detail-episodes');
      return;
    }
    openStreamScreen(null, action);
  }

  function openStreamScreen(video: Video | null, action: 'play' | 'cast' = pendingEpisodeAction) {
    if (!selected) return;
    pendingAutoAction = streamSelection.enabled ? { type: selected.type, id: selected.id, videoId: video?.id, action } : null;
    // Preserve the selected episode and season in the detail history entry as well.
    replaceRoute(mediaRoute('detail', video));
    router?.push(mediaRoute('streams', video));
  }

  function closeStreamScreen() {
    router?.back(selected ? mediaRoute('detail') : { kind: 'tab', tab });
  }

  function playbackClock(positionMs: number): string {
    const seconds = Math.floor(positionMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const display = `${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    return minutes >= 60 ? `${Math.floor(minutes / 60)}:${display}` : display;
  }

  function streamHeading(stream: Stream, index: number): string {
    const name = stream.name?.trim();
    const title = stream.title?.trim();
    if (title && title !== stream.addonName) return title;
    if (name && name !== stream.addonName) return name;
    return stream.description?.trim().split('\n')[0] || `Stream ${index + 1}`;
  }

  function streamDetails(stream: Stream, heading: string): string {
    return [stream.name, stream.description].map((value) => value?.trim() || '')
      .filter((value) => value && value !== heading && value !== stream.addonName).join(' · ');
  }

  function revealSelectedEpisode() {
    const list = episodeListElement;
    const selectedEpisode = list?.querySelector<HTMLElement>('.episode-row.selected');
    if (!list || !selectedEpisode) return;
    const left = list.scrollLeft + selectedEpisode.getBoundingClientRect().left - list.getBoundingClientRect().left;
    list.scrollLeft = Math.max(0, left - (list.clientWidth - selectedEpisode.clientWidth) / 2);
  }

  async function openSeasonPicker() {
    seasonPickerOpen = !seasonPickerOpen;
    if (!seasonPickerOpen) return;
    await tick();
    if (seasonWheel) seasonWheel.scrollTop = Math.max(0, seasonSummaries.findIndex((item) => item.value === season)) * 56;
  }

  function chooseSeason(value: number, close = true) {
    if (season !== value) {
      season = value;
      episode = null;
      streams = [];
      sourceError = '';
      loadingStreams = false;
      streamRequest += 1;
    }
    if (close) seasonPickerOpen = false;
    if (selected && currentRoute.kind === 'detail') replaceRoute(mediaRoute('detail'));
  }

  function seasonWheelScrolled() {
    window.clearTimeout(seasonWheelTimer);
    seasonWheelTimer = window.setTimeout(() => {
      if (!seasonWheel || !seasonPickerOpen) return;
      const item = seasonSummaries[Math.max(0, Math.min(seasonSummaries.length - 1, Math.round(seasonWheel.scrollTop / 56)))];
      if (item) chooseSeason(item.value, false);
    }, 110);
  }

  function streamSources(type: MediaType, id: string): StreamSource[] {
    const addonSources = addons.filter((addon) => supports(addon, 'stream', type, id))
      .map((addon) => ({ key: `addon:${addon.manifestUrl}`, name: addon.manifest.name, addon }));
    const pluginSources = (type === 'movie' || type === 'series' ? plugins : []).flatMap((repo) => repo.scrapers
      .filter((scraper) => browserCompatible(scraper) && scraper.supportedTypes?.some((value) =>
        value === (type === 'series' ? 'tv' : 'movie') || value === type))
      .map((scraper) => ({ key: `plugin:${repo.manifestUrl}:${scraper.id}`, name: scraper.name,
        plugin: { ...repo, scrapers: [scraper] } })));
    return [...addonSources, ...pluginSources];
  }

  async function refreshStreamSource(source: StreamSource, type: MediaType, id: string, request: number, forceRefresh = false,
    onUpdate?: () => void) {
    sourceLoading = { ...sourceLoading, [source.key]: true };
    let warning = '';
    try {
      const result = await fetchStreams(source.addon ? [source.addon] : [], type, id,
        source.plugin ? [source.plugin] : [], tmdbKey, (value) => { warning = warning ? `${warning} ${value}` : value; }, undefined, forceRefresh);
      if (request !== streamRequest) return;
      sourceStreams = { ...sourceStreams, [source.key]: result };
      sourceWarnings = { ...sourceWarnings, [source.key]: warning };
      streams = activeStreamSources.flatMap((item) => sourceStreams[item.key] || []);
    } catch (error) {
      if (request === streamRequest) sourceWarnings = { ...sourceWarnings, [source.key]: message(error) };
    } finally {
      if (request === streamRequest) {
        sourceLoading = { ...sourceLoading, [source.key]: false };
        loadingStreams = restoringStreamSources || Object.values(sourceLoading).some(Boolean);
        onUpdate?.();
      }
    }
  }

  async function loadStreams(type: MediaType, id: string, forceRefresh = false, onUpdate?: () => void) {
    const request = ++streamRequest;
    const previousFilter = forceRefresh ? selectedStreamSource : '';
    streams = [];
    sourceError = '';
    activeStreamSources = streamSources(type, id);
    selectedStreamSource = activeStreamSources.some((source) => source.key === previousFilter) ? previousFilter : '';
    sourceStreams = {};
    sourceWarnings = {};
    sourceLoading = Object.fromEntries(activeStreamSources.map((source) => [source.key, true]));
    restoringStreamSources = !restorationComplete;
    loadingStreams = restoringStreamSources || activeStreamSources.length > 0;
    const lookups = activeStreamSources.map((source) => refreshStreamSource(source, type, id, request, forceRefresh, onUpdate));
    if (restoringStreamSources) {
      // Render available sources now, then append sources restored from other accounts/plugins.
      // Manual playback never waits for this; automatic selection preserves provider priority.
      await restoreReady;
      await tick();
      if (request !== streamRequest) return;
      const known = new Set(activeStreamSources.map((source) => source.key));
      activeStreamSources = streamSources(type, id);
      const restored = activeStreamSources.filter((source) => !known.has(source.key));
      streams = activeStreamSources.flatMap((source) => sourceStreams[source.key] || []);
      lookups.push(...restored.map((source) => refreshStreamSource(source, type, id, request, forceRefresh, onUpdate)));
      restoringStreamSources = false;
      loadingStreams = Object.values(sourceLoading).some(Boolean);
      onUpdate?.();
    }
    await Promise.all(lookups);
  }

  function refreshAllStreams() {
    if (selected) void loadStreams(selected.type, episode?.id || selected.id, true);
  }

  function refreshOneStreamSource(source: StreamSource) {
    if (selected && !sourceLoading[source.key]) void refreshStreamSource(source, selected.type,
      episode?.id || selected.id, streamRequest, true);
  }

  function updateStreamSelection(preferences: StreamSelectionPreferences) {
    streamSelection = preferences;
    saveStreamSelection(preferences);
  }

  async function startPreferredStream(action: 'play' | 'cast', allowPending = false) {
    if (!selected || loadingDetail || (loadingStreams && !allowPending)) return;
    const stream = loadingStreams
      ? selectReadyPreferredStream(activeStreamSources.map((source) => ({ id: source.key.replace(/^(addon|plugin):/, ''),
        streams: (sourceStreams[source.key] || []).filter(playableStream), loading: !!sourceLoading[source.key] })),
        streamSelection, restoringStreamSources)
      : selectPreferredStream(streams.filter(playableStream), streamSelection);
    if (!stream) {
      if (loadingStreams) return;
      sourceError = 'No stream matches your auto-selection settings. Choose a stream below or adjust your settings.';
      return;
    }
    const selection = selectionContext(stream, streamSelection, false);
    if (action === 'cast') await cast(stream, selection);
    else await playInBrowser(stream, true, selection);
  }

  async function cast(stream: Stream, selection = selectionContext(stream, streamSelection)) {
    if (!selected) return;
    ++streamActionRequest;
    try {
      if (selected.type === 'series') {
        if (!episode) throw new Error('Choose an episode first.');
        const meta = selected;
        await lazyCastSeries(meta, meta.videos?.length ? meta.videos : [episode], episode, stream, addons, plugins, tmdbKey,
          resumePositionMs(meta, episode, accountLibrary, nuvioProgress),
          (value) => { showStatus(value); }, (progress) => reportWatchProgress(meta, progress), selection);
      } else if (selected.type === 'movie') {
        const meta = selected;
        const tracked = await castMovie(meta, stream, resumePositionMs(meta, null, accountLibrary, nuvioProgress),
          (progress) => reportWatchProgress(meta, progress));
        showStatus(tracked ? `Casting ${meta.name} · watch progress sync is on.`
          : `Casting ${meta.name} · progress sync is unavailable for this target.`);
      } else {
        await stopLinkedCast();
        directCast(selected, stream);
        showStatus(`Casting ${selected.name}`);
      }
      sourceError = '';
    } catch (error) {
      sourceError = message(error);
    }
  }

  async function playInBrowser(stream: Stream, recordHistory = true, selection = selectionContext(stream, streamSelection)) {
    if (!selected || !playableStream(stream)) return;
    if (recordHistory) {
      ++streamActionRequest;
      const route = mediaRoute('player');
      playerMemory.set(routeHash(route), { stream, selection });
      router?.push(route);
      return;
    }
    if (selected.type === 'series' && !episode) {
      sourceError = 'Choose an episode first.';
      return;
    }
    const meta = selected;
    const chosenEpisode = episode;
    const request = detailRequest;
    const navigation = routeRequest;
    playbackAttempt += 1;
    logPlayback('play requested', `type=${meta.type}; fallback=${nativePlayerFallback}; custom element=${!!customElements.get('movi-player')}`);
    playerLoading = true;
    playerError = '';
    const importStarted = performance.now();
    try {
      if (!customElements.get('movi-player')) await import('movi-player/element/slim');
      playerReady = true;
      logPlayback('player import ready', `${Math.round(performance.now() - importStarted)}ms`);
    } catch (error) {
      playerReady = false;
      logPlayback('player import failed', `${Math.round(performance.now() - importStarted)}ms; ${safeDiagnosticText(error)}`);
      logPlayerAssets();
      if (!nativePlayerFallback) playerError = 'MoviPlayer could not load. Open Playback diagnostics below for details.';
    }
    playerLoading = false;
    if (request !== detailRequest || navigation !== routeRequest || selected?.id !== meta.id || selected.type !== meta.type) {
      logPlayback('play cancelled', 'The selected title changed while the player loaded.');
      return;
    }
    const video = meta.type === 'series' ? chosenEpisode : null;
    playing = { meta, stream, selection, video, resumePositionMs: resumePositionMs(meta, video, accountLibrary, nuvioProgress), resumeApplied: false };
  }

  async function castPlaying() {
    const current = playing;
    if (!current) return;
    try {
      if (current.meta.type === 'series') {
        if (!current.video) throw new Error('Choose an episode first.');
        await lazyCastSeries(current.meta, current.meta.videos?.length ? current.meta.videos : [current.video], current.video, current.stream, addons, plugins, tmdbKey,
          browserPositionMs() || resumePositionMs(current.meta, current.video, accountLibrary, nuvioProgress),
          (value) => { showStatus(value); }, (progress) => reportWatchProgress(current.meta, progress), current.selection);
      } else if (current.meta.type === 'movie') {
        const tracked = await castMovie(current.meta, current.stream,
          browserPositionMs() || resumePositionMs(current.meta, null, accountLibrary, nuvioProgress),
          (progress) => reportWatchProgress(current.meta, progress));
        showStatus(tracked ? `Casting ${current.meta.name} · watch progress sync is on.`
          : `Casting ${current.meta.name} · progress sync is unavailable for this target.`);
      } else {
        await stopLinkedCast();
        directCast(current.meta, current.stream);
        showStatus(`Casting ${current.meta.name}`);
      }
      closePlayer();
    } catch (error) { playerError = message(error); }
  }

  function closePlayer() {
    router?.back(selected ? mediaRoute('streams') : { kind: 'tab', tab });
  }

  function resetPlayer() {
    if (playing) logPlayback('player closed');
    if (playerElement) reportBrowserPosition(playerElement as HTMLMediaElement, 'stopped');
    playerElement?.removeAttribute('src');
    playing = null;
    playerLoading = false;
    playerError = '';
  }

  function browserPositionMs(): number {
    const seconds = Number((playerElement as HTMLMediaElement | null)?.currentTime);
    return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 1000) : 0;
  }

  function applyBrowserResume(event: Event) {
    if (!playing || playing.resumeApplied || playing.resumePositionMs <= 0) return;
    const media = event.currentTarget as HTMLMediaElement;
    if (media.getAttribute('src') !== playing.stream.url) return;
    const duration = Number(media.duration);
    const seconds = playing.resumePositionMs / 1000;
    if (Number.isFinite(duration) && duration > 0 && seconds >= duration * .95) {
      playing.resumeApplied = true;
      return;
    }
    try {
      media.currentTime = seconds;
      playing.resumeApplied = true;
    } catch { /* Retry when the player becomes ready to seek. */ }
  }

  function browserMetadataReady(event: Event) {
    const duration = Number((event.currentTarget as HTMLMediaElement).duration);
    logPlayback('metadata ready', Number.isFinite(duration) ? `duration=${Math.round(duration)}s` : 'duration unknown');
    applyBrowserResume(event);
  }

  function browserCanPlay(event: Event) {
    logPlayback('can play');
    applyBrowserResume(event);
  }

  function browserTimeUpdate(event: Event) {
    browserWatchState(event, 'playing');
  }

  function browserPlaybackError(event: Event) {
    const detail = (event as CustomEvent<unknown>).detail;
    const reason = detail instanceof Error ? detail.message
      : typeof detail === 'string' ? detail
      : detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string' ? detail.message : '';
    logPlayback('playback error', reason || `event=${event.type}; nativeCode=${event.currentTarget instanceof HTMLVideoElement ? event.currentTarget.error?.code || 0 : 'n/a'}`);
    logPlayerAssets();
    playerError = reason ? `Playback failed: ${safeDiagnosticText(reason)}. Try another source or cast with PlayBridge.`
      : 'This source could not play in the browser. Its host may block browser requests or require headers the browser cannot send. Try another source or cast with PlayBridge.';
  }

  function browserPaused(event: Event) {
    browserWatchState(event, 'paused');
  }

  function browserPlaybackEnded(event: Event) {
    logPlayback('playback ended');
    browserWatchState(event, 'ended');
    void browserEnded();
  }

  function browserWatchState(event: Event, state: string) {
    reportBrowserPosition(event.currentTarget as HTMLMediaElement, state);
  }

  function reportBrowserPosition(element: HTMLMediaElement, state: string) {
    if (!playing || element.getAttribute('src') !== playing.stream.url) return;
    const positionMs = Number(element.currentTime) * 1000;
    const durationMs = Number(element.duration) * 1000;
    if (Number.isFinite(positionMs) && Number.isFinite(durationMs) && positionMs > 0 && durationMs > 0) {
      reportWatchProgress(playing.meta, {
        videoId: playing.video?.id || playing.meta.id, positionMs, durationMs, state
      });
    }
  }

  async function browserEnded() {
    const current = playing;
    if (!current?.video) return;
    const videos = [...(current.meta.videos || [])]
      .filter((video) => video.season != null && video.episode != null)
      .sort((a, b) => (a.season! - b.season!) || (a.episode! - b.episode!));
    const next = videos[videos.findIndex((video) => video.id === current.video?.id) + 1];
    if (!next) return;
    try {
      const sources = (await fetchStreams(addons, 'series', next.id, plugins, tmdbKey)).filter(playableStream);
      if (playing !== current) return;
      const stream = selectNextStream(sources, current.selection);
      if (stream) {
        playbackAttempt += 1;
        logPlayback('next episode', `season=${next.season}; episode=${next.episode}`);
        playing = { meta: current.meta, video: next, stream, selection: current.selection,
          resumePositionMs: resumePositionMs(current.meta, next, accountLibrary, nuvioProgress), resumeApplied: false };
        episode = next;
        season = next.season ?? season;
        const route = mediaRoute('player', next);
        playerMemory.set(routeHash(route), { stream, selection: current.selection });
        replaceRoute(route);
        void loadStreams('series', next.id);
        playerError = '';
      } else playerError = `No matching browser stream for ${next.title || `S${next.season}E${next.episode}`}.`;
    } catch { playerError = 'Could not load the next episode.'; }
  }
</script>

<svelte:head>
  <title>{selected ? detailIdentityReady ? `${selected.name} · Bridged Streams` : 'Loading title · Bridged Streams' : catalogPage ? `${catalogPage.title} · Bridged Streams` : 'Bridged Streams · PlayBridge'}</title>
</svelte:head>

<div class:detail-open={!!selected && !accountPanel && !managing} class:content-open={!!selected || !!catalogPage} class="app-shell">
  <header class:scrolled={pageScrolled} class="sidebar site-header">
    <button class="brand" onclick={() => navigate('home')} aria-label="Bridged Streams home">
      <span class="brand-mark"><Clapperboard size={23} strokeWidth={2.4} /></span>
      <span><strong>BRIDGED</strong><small>STREAMS</small></span>
    </button>
  </header>

  <main aria-busy={startupLoading}>
    {#if startupLoading}
      <section class="startup-screen" role="status" aria-live="polite">
        <div class="startup-copy"><div class="eyebrow">BRIDGED STREAMS</div><h1>Getting your space ready</h1><p><LoaderCircle size={18} class="spin" /> Restoring your accounts and addons…</p></div>
        <div class="startup-skeletons" aria-hidden="true"><div class="startup-hero-skeleton"></div><div class="card-skeletons"><span></span><span></span><span></span><span></span><span></span></div></div>
      </section>
    {:else}
    {#if tab === 'library'}
      <section class="library-panel browse tab-page">
        <div class="page-intro"><div class="eyebrow">CONNECTED ACCOUNTS</div><h1>Library</h1><p>{account || nuvioSession ? `${savedLibrary.length} synced titles` : 'Sign in to Stremio or Nuvio to see your library and watch progress.'}</p></div>
        {#if !account && !nuvioSession}<div class="empty-state">Connect Stremio or Nuvio to bring in your library and Continue Watching.<br /><button class="primary-button inline-action" onclick={() => openSettingsPanel('accounts')}><UserRound size={17} /> Connect an account</button></div>
        {:else if (accountSyncing || nuvioSyncing) && !savedLibrary.length}<div class="loading-line"><LoaderCircle size={20} class="spin" /> Syncing your library…</div>
        {:else if savedLibrary.length}<div class="poster-grid">{#each savedLibrary as item (item.type + item.id)}<MediaTile {item} progress={item.progress} subtitle={item.progress ? `${item.progress}% watched` : undefined} onSelect={() => void openDetail(item)} />{/each}</div>
        {:else}<div class="empty-state">Your connected library is empty. Add a title, then sync again.</div>{/if}
      </section>
    {/if}
    {#if tab === 'settings'}
      <section class="settings-page browse tab-page">
        <div class="page-intro"><div class="eyebrow">YOUR SPACE</div><h1>Settings</h1><p>Manage your accounts, addons, and playback preferences.</p></div>
        <div class="settings-grid">
          <button class="settings-card" onclick={() => openSettingsPanel('accounts')}><span class="settings-card-icon"><UserRound size={24} /></span><span class="settings-card-copy"><strong>Accounts and profiles</strong><small>{account || nuvioSession ? [account && 'Stremio', nuvioSession && 'Nuvio'].filter(Boolean).join(' · ') + ' connected' : 'Connect Stremio or Nuvio'}</small></span><ArrowRight size={19} /></button>
          <button class="settings-card" onclick={() => openSettingsPanel('addons')}><span class="settings-card-icon"><Clapperboard size={24} /></span><span class="settings-card-copy"><strong>Addons and playback</strong><small>{addons.length} enabled {addons.length === 1 ? 'addon' : 'addons'} · catalogs, streams, and TMDB</small></span><ArrowRight size={19} /></button>
          <button class="settings-card" onclick={() => openSettingsPanel('integrations')}><span class="settings-card-icon"><Info size={24} /></span><span class="settings-card-copy"><strong>Integrations</strong><small>TMDB enrichment · {tmdbSettings.enabled ? 'On' : 'Off'}</small></span><ArrowRight size={19} /></button>
        </div>
      </section>
    {/if}
    {#if tab === 'search'}
      <div class="search-panel tab-page">
      <section class="search-page search-home">
        <div class="eyebrow">FIND SOMETHING TO WATCH</div>
        <h1>Search</h1>
        <div class="search-entry" onfocusout={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) searchHistoryOpen = false; }}>
          <form class="search-form" onsubmit={(event) => { event.preventDefault(); searchHistoryOpen = false; void runSearch(); }}>
            <Search size={21} />
            <input value={search} oninput={(event) => updateSearch(event.currentTarget.value)} placeholder="Movies, TV shows, sports..." aria-label="Search movies, TV shows, and sports" autocomplete="off" />
            <button class="search-history-toggle" type="button" onclick={() => searchHistoryOpen = !searchHistoryOpen} disabled={!searchHistory.length} aria-label="Recent searches" aria-expanded={searchHistoryOpen} aria-controls="search-history-list" title={searchHistory.length ? 'Recent searches' : 'No recent searches'}><History size={18} /></button>
            {#if search || submittedSearch}<button class="search-clear" type="button" onclick={clearSearch} aria-label="Clear search"><X size={18} /></button>{/if}
            <button class="search-submit" type="submit">Search <ArrowRight size={18} /></button>
          </form>
          {#if searchHistoryOpen && searchHistory.length}
            <div id="search-history-list" class="search-history" role="group" aria-label="Recent searches">
              <div class="search-history-heading"><span>Recent searches</span><button type="button" onclick={() => { window.clearTimeout(searchHistoryTimer); searchHistory = []; saveSearchHistory(); searchHistoryOpen = false; }}>Clear all</button></div>
              {#each searchHistory as query (query)}
                <div class="search-history-row"><button class="search-history-query" type="button" onclick={() => useSearchHistory(query)}><Search size={16} /><span>{query}</span></button><button class="search-history-remove" type="button" onclick={() => removeSearchHistory(query)} aria-label={`Remove ${query} from search history`}><X size={16} /></button></div>
              {/each}
            </div>
          {/if}
        </div>
      </section>
      {#if submittedSearch}
        <section class="search-results browse" aria-label="Search results">
          <div class="section-heading"><div><span class="section-type">SEARCH RESULTS</span><h2>{searching ? 'Searching…' : `${searchResults.length} ${searchResults.length === 1 ? 'result' : 'results'}`}</h2></div></div>
          {#if searching}<div class="card-skeletons" aria-label="Searching addon catalogs"><span></span><span></span><span></span><span></span><span></span></div>{/if}
          {#if !searching && searchResults.length}<div class="poster-grid">{#each searchResults as item (item.type + item.id)}<MediaTile {item} onSelect={() => void openDetail(item)} />{/each}</div>{/if}
          {#if !searching && !searchResults.length}<div class="empty-state">No results. Make sure an installed catalog supports search.</div>{/if}
        </section>
      {:else}
        <section class="discover-page browse" aria-label="Discover">
          <div class="discover-heading"><div class="eyebrow">EXPLORE YOUR ADDONS</div><h2>Discover</h2></div>
          <div class="discover-filters">
            <div class="discover-filter"><span class="discover-filter-label">Type</span><button class="discover-filter-trigger" disabled={!discoverTypes.length} aria-label="Choose type" aria-haspopup="dialog" aria-expanded={openDiscoverDropdown === 'type'} onclick={(event) => openDiscoverMenu('type', event.currentTarget)}><span>{discoverTypeLabel(effectiveDiscoverType) || 'Type'}</span><ChevronDown size={16} /></button></div>
            <div class="discover-filter"><span class="discover-filter-label">Catalog</span><button class="discover-filter-trigger" disabled={!discoverCatalogOptions.length} aria-label="Choose catalog" aria-haspopup="dialog" aria-expanded={openDiscoverDropdown === 'catalog'} onclick={(event) => openDiscoverMenu('catalog', event.currentTarget)}><span>{selectedDiscoverCatalog ? discoverCatalogLabel(selectedDiscoverCatalog) : 'Catalog'}</span><ChevronDown size={16} /></button></div>
            <div class="discover-filter"><span class="discover-filter-label">Genre</span><button class="discover-filter-trigger" disabled={!discoverGenreOptions.length} aria-label="Choose genre" aria-haspopup="dialog" aria-expanded={openDiscoverDropdown === 'genre'} onclick={(event) => openDiscoverMenu('genre', event.currentTarget)}><span>{effectiveDiscoverGenre || 'All genres'}</span><ChevronDown size={16} /></button></div>
          </div>
          {#if selectedDiscoverCatalog}<p class="discover-context">{selectedDiscoverCatalog.addon.manifest.name} · {discoverTypeLabel(selectedDiscoverCatalog.catalog.type)}</p>{/if}
          {#if discoverLoading && !discoverItems.length}<div class="discover-skeletons" aria-label="Loading discover titles"><span></span><span></span><span></span><span></span><span></span><span></span></div>
          {:else if discoverItems.length}<div class="poster-grid discover-grid">{#each discoverItems as item (`${item.type}:${item.id}`)}<MediaTile {item} onSelect={() => void openDetail(item)} />{/each}</div>
          {:else}<div class="empty-state">{discoverError || (discoverSources.length ? 'No titles in this catalog. Choose another catalog or genre.' : 'No discover catalogs are available. Add a catalog addon in Settings.')} {#if discoverError}<button class="text-action" onclick={() => void loadDiscoverFeed(true)}>Retry <RefreshCw size={15} /></button>{/if}</div>{/if}
          {#if discoverItems.length && discoverError}<div class="discover-footer"><span>{discoverError}</span><button onclick={() => void loadDiscoverFeed(false)}>Retry <RefreshCw size={15} /></button></div>{/if}
          {#if discoverNextSkip !== null}<div class="discover-footer" use:observeDiscoverEnd>{#if discoverLoading}<LoaderCircle size={20} class="spin" /> Loading more…{:else if !discoverError}<button onclick={() => void loadDiscoverFeed(false)}>Load more <ArrowRight size={16} /></button>{/if}</div>{/if}
        </section>
      {/if}
      </div>
    {/if}
    {#if tab === 'home'}
    <div class="home-panel tab-page">
      <HomeContent>
      {#if addons.length === 0 && !localAddons.length && !accountAddons.length && !nuvioAddons.length}
      <section class="welcome"><div class="welcome-glow"></div>
        {#if account || nuvioSession}
          <div class="eyebrow">ACCOUNT CONNECTED</div><h1>Your space is ready.<br /><em>Add a source to watch.</em></h1><p>Your account is connected. Add a catalog addon to browse movies, shows, and sports here.</p>
          <div class="welcome-actions"><button class="primary-button" onclick={() => openSettingsPanel('addons')}><Plus size={18} /> Add an addon</button>{#if nuvioSession && !nuvioProfiles.length}<button class="outline-button" onclick={() => openSettingsPanel('accounts')}><UserRound size={18} /> Set up Nuvio profile</button>{/if}</div>
        {:else}
          <div class="eyebrow">YOUR STREAMING, CONNECTED</div><h1>All your addons.<br /><em>One place to watch.</em></h1><p>Connect Stremio or Nuvio to bring in your addons and library, or install a compatible addon URL yourself. Browse, play, and pick up where you left off in your browser.</p><div class="welcome-actions"><button class="primary-button" onclick={() => openSettingsPanel('accounts')}><UserRound size={19} /> Connect an account</button><button class="outline-button" onclick={() => openSettingsPanel('addons')}><Plus size={18} /> Add an addon</button></div>
        {/if}
      </section>
      {:else}
      {#if featured}
        <section class="feature-hero" aria-label="Featured titles" use:heroGestures>
          {#key `${featured.type}:${featured.id}`}<img class="feature-art" class:poster-art={!featured.background} src={featured.background || featured.poster} alt="" in:fade={{ duration: motionDuration(380) }} out:fade={{ duration: motionDuration(260) }} />{/key}
          {#if !featured.background && featured.poster}<img class="feature-poster" src={featured.poster} alt="" />{/if}
          <div class="feature-content">
            <div class="feature-kicker">FEATURED FROM YOUR ADDONS</div>
            {#if featured.logo}<img class="feature-logo" src={featured.logo} alt={featured.name} />{:else}<h1>{featured.name}</h1>{/if}
            <div class="feature-facts">{#if featured.imdbRating}<span><Star size={15} fill="currentColor" /> {featured.imdbRating}/10</span>{/if}{#if featured.releaseInfo}<span>{displayReleaseInfo(featured.releaseInfo)}</span>{/if}<span>{featured.type === 'movie' ? 'Movie' : 'Series'}</span>{#if featured.genres?.length}<span>{featured.genres.slice(0, 2).join(' · ')}</span>{/if}</div>
            <p>{featured.description || 'Discover this title from your connected addons.'}</p>
            <div class="feature-actions"><button class="feature-play" onclick={() => void openDetail(featured)}><Play size={21} fill="currentColor" /> Play</button><button class="feature-info" onclick={() => void openDetail(featured)} aria-label={`Details for ${featured.name}`}><Info size={21} /> <span>View details</span></button></div>
          </div>
          {#if featureCandidates.length > 1}<div class="feature-pagination" aria-label="Featured titles">{#each featureCandidates as candidate, index (candidate.type + candidate.id)}<button class:active={index === featureIndex} aria-label={`Show ${candidate.name}`} aria-current={index === featureIndex ? 'true' : undefined} onclick={() => selectFeature(index)}></button>{/each}</div>{/if}
        </section>
      {/if}
      <section class="browse">
        {#if continueWatching.length}<section class="catalog-section"><div class="section-heading"><div><span class="section-type">ACCOUNT SYNC</span><h2>Continue Watching</h2></div><button class="text-action" onclick={() => navigate('library')}>View library <ArrowRight size={17} /></button></div><div class="media-row">{#each continueWatching.slice(0, 16) as item (item.type + item.id)}<MediaTile {item} progress={item.progress} subtitle={`${item.progress}% watched`} onSelect={() => void openDetail(item, true)} />{/each}</div></section>{/if}
        {#if browsableAddons.length}
          <section class="provider-section" aria-label="Browse by addon"><div class="section-heading"><div><h2>Browse by Addon</h2><p>Explore catalogs from your connected sources</p></div></div><div class="provider-rail"><button class:active={!effectiveAddonFilter} class="provider-tile" aria-pressed={!effectiveAddonFilter} onclick={() => activeAddonFilter = ''}><span class="provider-mark all-mark"><Clapperboard size={27} /></span><strong>All sources</strong></button>{#each browsableAddons as addon (addon.manifestUrl)}<button class:active={effectiveAddonFilter === addon.manifestUrl} class="provider-tile" aria-pressed={effectiveAddonFilter === addon.manifestUrl} onclick={() => activeAddonFilter = addon.manifestUrl}><span class="provider-mark">{#if addon.manifest.logo}<img src={addon.manifest.logo} alt="" loading="lazy" />{:else}{addon.manifest.name.slice(0, 2).toUpperCase()}{/if}</span><strong>{addon.manifest.name}</strong></button>{/each}</div></section>
        {/if}
        {#if loadingCatalogs && !visibleRows.some((row) => row.items.length)}<div class="loading-line"><LoaderCircle size={20} class="spin" /> Loading catalogs…</div>{/if}
        {#each visibleRows as row (row.key)}
          <section class="catalog-section"><div class="section-heading"><div><span class="section-type">{row.catalog.type === 'movie' ? 'MOVIES' : row.catalog.type === 'series' ? 'TV SHOWS' : row.catalog.type === 'sport' ? 'SPORTS' : 'LIBRARY'} · {row.addon.manifest.name}</span><h2>{row.title}</h2></div><button class="catalog-view-all" onclick={() => openCatalogPage(row)} aria-label={`View all ${row.title} from ${row.addon.manifest.name}`} title={`View all ${row.title}`}><ArrowRight size={20} /></button></div>
            {#if row.items.length}<CatalogRail items={row.items} title={row.title} onSelect={(item) => void openDetail(item)} onLoadMore={() => loadMoreCatalogRow(row.key)} canLoadMore={row.nextSkip != null} loadingMore={!!row.loadingMore} pageError={row.pageError || ''} active={!catalogPage && !selected} />{#if row.error}<p class="catalog-stale-message">Showing cached titles. Refresh failed: {row.error}</p>{/if}
            {:else if row.loading}<div class="card-skeletons" aria-label={`Loading ${row.title}`}><span></span><span></span><span></span><span></span><span></span></div>{:else if row.error}<div class="row-empty">{row.error}</div>{:else}<div class="row-empty">No titles in this catalog.</div>{/if}
          </section>
        {/each}
        {#if !loadingCatalogs && !visibleRows.length}<div class="empty-state">{addons.length ? 'No catalogs match this filter. Choose another category or addon.' : 'All installed addons are disabled. Open Settings to turn one on.'}</div>{/if}
      </section>
      {/if}
      </HomeContent>
    </div>
    {/if}
    {/if}
  </main>

  {#if openDiscoverDropdown}
    <div class="discover-sheet-layer" in:fade={{ duration: motionDuration(180) }} out:fade={{ duration: motionDuration(130) }}>
      <button class="discover-sheet-scrim" aria-label="Close discover options" onclick={closeDiscoverMenu}></button>
      <div class="discover-sheet" role="dialog" aria-modal="true" aria-label={`Select ${openDiscoverDropdown}`}>
        <div class="discover-sheet-handle" aria-hidden="true"></div>
        <div class="discover-sheet-head"><h2>Select {openDiscoverDropdown}</h2><button onclick={closeDiscoverMenu} aria-label="Close options"><X size={19} /></button></div>
        <div class="discover-sheet-options" role="listbox" aria-label={`${openDiscoverDropdown} options`}>
          {#each discoverDropdownOptions as option (option.key)}<button class:selected={option.key === discoverDropdownValue} class="discover-sheet-option" role="option" aria-selected={option.key === discoverDropdownValue} onclick={() => chooseDiscoverOption(option.key)}><span>{option.label}</span>{#if option.key === discoverDropdownValue}<Check size={19} />{/if}</button>{/each}
        </div>
      </div>
    </div>
  {/if}

  <nav class="mobile-nav" class:dock-ready={dockReady} class:compact={dockCompact} class:interacting={dockInteracting} aria-label="Main navigation" bind:this={dockElement} onpointerdown={onDockPointerDown} onpointermove={onDockPointerMove} onpointerup={onDockPointerUp} onpointercancel={() => { dockInteracting = false; dockStretch = 1; updateDockIndicator(); }} onclickcapture={(event) => { if (suppressDockClick) { event.preventDefault(); event.stopPropagation(); suppressDockClick = false; } }}>
    <span class="dock-indicator" aria-hidden="true" style={`--dock-x:${dockIndicatorX}px;--dock-width:${dockIndicatorWidth}px;--dock-offset:${dockPosition * 100}%;--dock-stretch:${dockStretch}`}></span>
    <button class:active={tab === 'home'} aria-label="Home" aria-current={tab === 'home' ? 'page' : undefined} onclick={() => navigate('home')}><Home size={20} /><span>Home</span></button>
    <button class:active={tab === 'search'} aria-label="Search" aria-current={tab === 'search' ? 'page' : undefined} onclick={() => navigate('search')}><Search size={20} /><span>Search</span></button>
    <button class:active={tab === 'library'} aria-label="Library" aria-current={tab === 'library' ? 'page' : undefined} onclick={() => navigate('library')}><Library size={20} /><span>Library</span></button>
    <button class:active={tab === 'settings'} aria-label="Settings" aria-current={tab === 'settings' ? 'page' : undefined} onclick={() => navigate('settings')}><Settings2 size={20} /><span>Settings</span></button>
  </nav>
</div>

{#if catalogPage}
  <div class="catalog-page-overlay" role="presentation" aria-hidden={selected ? 'true' : undefined} in:fade={{ duration: motionDuration(210), easing: cubicOut }} out:fade={{ duration: motionDuration(150), easing: cubicIn }}>
    <div class="catalog-page-panel" role="dialog" aria-modal="true" aria-label={`${catalogPage.title} catalog`}>
      <header class="catalog-page-header"><button class="catalog-page-back" onclick={closeCatalogPage} aria-label="Back to home"><ArrowLeft size={21} /></button><div><span class="section-type">{catalogPage.addon.manifest.name}</span><h1>{catalogPage.title}</h1></div></header>
      <div class="catalog-page-content">
        {#if catalogPageItems.length}<div class="poster-grid catalog-page-grid">{#each catalogPageItems as item (item.type + item.id)}<MediaTile {item} onSelect={() => void openDetail(item)} />{/each}</div>{/if}
        {#if catalogPageLoading && !catalogPageItems.length}<div class="catalog-page-skeletons"><span></span><span></span><span></span><span></span><span></span><span></span></div>{/if}
        {#if catalogPageError}<div class="catalog-page-message" role="alert">{catalogPageError} <button onclick={() => void loadCatalogPage(catalogPageNextSkip == null)}>Retry</button></div>{/if}
        {#if !catalogPageLoading && !catalogPageError && !catalogPageItems.length}<div class="row-empty">No titles in this catalog.</div>{/if}
        {#if catalogPageNextSkip != null}<div class="catalog-page-footer" use:observeCatalogPageEnd>{#if catalogPageLoading}<LoaderCircle size={22} class="spin" />{:else}<button onclick={() => void loadCatalogPage()}>Load more <ArrowRight size={17} /></button>{/if}</div>{/if}
      </div>
    </div>
  </div>
{/if}

{#if status}<div class="toast" role="status" in:fade={{ duration: motionDuration(180) }} out:fade={{ duration: motionDuration(130) }}><Cast size={17} /> {status}<button onclick={() => showStatus('')} aria-label="Dismiss"><X size={16} /></button></div>{/if}

{#if accountPanel}
  <div class="overlay" role="presentation" in:fade={{ duration: motionDuration(180) }} out:fade={{ duration: motionDuration(150) }} onclick={(event) => { if (event.target === event.currentTarget) closeSettingsPanel(); }}>
    <div class="manage-panel account-panel" role="dialog" aria-modal="true" aria-label="Accounts">
      <div class="panel-header"><div><div class="eyebrow">ACCOUNT SYNC</div><h2>Connected accounts</h2></div><button class="icon-button" onclick={closeSettingsPanel} aria-label="Close account"><X size={22} /></button></div>
      <h3 class="account-section-title">Stremio</h3>
      {#if account}
        <div class="signed-in-card"><div class="account-avatar"><UserRound size={24} /></div><div><strong>{account.user.email}</strong><small>{stremioRestoring ? 'Restoring Stremio session…' : 'Connected to Stremio'}</small></div></div>
        <p class="panel-copy">Your addons, library, and watch progress refresh when you open the app and every 10 minutes. Addon and library changes made here sync back to Stremio. Browser playback and linked TV casts report watch progress.</p>
        <button class="sync-button" onclick={() => void syncAccount()} disabled={accountSyncing}>{#if accountSyncing}<LoaderCircle size={18} class="spin" />{:else}<RefreshCw size={18} />{/if} Sync now</button>
        {#if accountMessage}<p class="sync-message" role="status">{accountMessage}</p>{/if}
        {#if accountError}<p class="error-message" role="alert">{accountError}</p>{/if}
        <div class="sync-summary"><span><strong>{accountAddons.length}</strong> account addons</span><span><strong>{accountLibrary.filter((item) => !item.removed && !item.temp).length}</strong> library titles</span></div>
        <button class="disconnect-button" onclick={disconnectAccount}>Disconnect this account</button>
      {:else}
        <p class="panel-copy">Sign in with your Stremio account to import your installed addons, library, and Continue Watching progress.</p>
        <div class="login-tabs"><button class:active={loginMode === 'password'} onclick={() => loginMode = 'password'}>Email & password</button><button class:active={loginMode === 'key'} onclick={() => loginMode = 'key'}>Auth key</button></div>
        <form class="login-form" onsubmit={(event) => { event.preventDefault(); void connectAccount(); }}>
          {#if loginMode === 'password'}<label>Email<input type="email" bind:value={email} autocomplete="username" required placeholder="you@example.com" /></label><label>Password<input type="password" bind:value={password} autocomplete="current-password" required placeholder="Your Stremio password" /></label>
          {:else}<label>Stremio auth key<input type="password" bind:value={authKeyInput} autocomplete="off" required placeholder="Paste your auth key" /></label><p class="login-hint">Use an auth key if you sign in to Stremio through a linked account.</p>{/if}
          <button class="primary-button" type="submit" disabled={accountBusy}>{#if accountBusy}<LoaderCircle size={18} class="spin" />{:else}<UserRound size={18} />{/if} Sign in</button>
        </form>
        {#if accountError}<p class="error-message" role="alert">{accountError}</p>{/if}
        <p class="login-hint">Your password is sent directly to Stremio over HTTPS and is not saved. Your session key stays in this browser until you disconnect or clear site data.</p>
      {/if}
      <h3 class="account-section-title">Nuvio</h3>
      {#if nuvioSession}
        <div class="signed-in-card"><div class="account-avatar"><UserRound size={24} /></div><div><strong>{nuvioSession.user.email}</strong><small>{nuvioRestoring ? 'Restoring Nuvio session…' : `Connected to Nuvio · ${nuvioSession.backendUrl}`}</small></div></div>
        {#if nuvioProfiles.length}
          <label class="profile-select">Profile<select value={nuvioProfileIndex} onchange={(event) => void chooseNuvioProfile(Number(event.currentTarget.value))}>{#each nuvioProfiles as profile (profile.profile_index)}<option value={profile.profile_index}>{profile.name || `Profile ${profile.profile_index}`}{profile.pin_enabled ? ' · PIN' : ''}</option>{/each}</select></label>
        {:else if nuvioProfilesLoading}
          <p class="panel-copy" role="status">Loading Nuvio profiles…</p>
        {:else if nuvioProfilesLoadFailed}
          <p class="panel-copy">Your Nuvio account is connected, but its profiles could not be loaded.</p>
          <button class="sync-button" onclick={() => void retryNuvioProfiles()} disabled={nuvioProfilesLoading}><RefreshCw size={18} /> Retry profiles</button>
        {:else}
          <p class="panel-copy">This Nuvio account has no profiles. Create a primary profile to sync addons, library, and watch progress.</p>
          <button class="sync-button" onclick={() => void retryNuvioProfiles(true)} disabled={nuvioProfilesLoading}><Plus size={18} /> Create primary profile</button>
          <button class="sync-button" onclick={() => void retryNuvioProfiles()} disabled={nuvioProfilesLoading}><RefreshCw size={18} /> Refresh profiles</button>
        {/if}
        {#if nuvioProfiles.length && nuvioProfileLocked}
          <p class="panel-copy">This profile has a PIN. Unlock it to import its sources, library, and progress.</p>
          <form class="login-form" onsubmit={(event) => { event.preventDefault(); void unlockNuvioProfile(); }}><label>Profile PIN<input type="password" inputmode="numeric" bind:value={nuvioPin} autocomplete="off" required /></label><button class="primary-button" type="submit" disabled={nuvioBusy}>Unlock profile</button></form>
        {:else if nuvioProfileReady}
          <p class="panel-copy">Nuvio addons, plugin repositories, library, and progress refresh every 10 minutes. Library changes and playback progress made here sync to this profile.</p>
          <button class="sync-button" onclick={() => void syncNuvio()} disabled={nuvioSyncing || !!pluginSaving}>{#if nuvioSyncing}<LoaderCircle size={18} class="spin" />{:else}<RefreshCw size={18} />{/if} Sync Nuvio now</button>
          <div class="sync-summary"><span><strong>{nuvioAddons.length}</strong> addons</span><span><strong>{nuvioPlugins.length}</strong> plugins</span><span><strong>{nuvioLibrary.length}</strong> titles</span></div>
        {/if}
        {#if nuvioMessage}<p class="sync-message" role="status">{nuvioMessage}</p>{/if}
        {#if nuvioError}<p class="error-message" role="alert">{nuvioError}</p>{/if}
        <button class="disconnect-button" onclick={disconnectNuvio}>Disconnect Nuvio</button>
      {:else}
        <p class="panel-copy">Sign in to Nuvio Cloud to use its profiles, addons, plugin repositories, library, and Continue Watching.</p>
        <form class="login-form" onsubmit={(event) => { event.preventDefault(); void connectNuvio(); }}>
          <label>Email<input type="email" bind:value={nuvioEmail} autocomplete="username" required placeholder="you@example.com" /></label>
          <label>Password<input type="password" bind:value={nuvioPassword} autocomplete="current-password" required placeholder="Your Nuvio password" /></label>
          <details class="nuvio-advanced"><summary>Self-hosted backend settings</summary>
            <label>Backend URL<input type="url" bind:value={nuvioBackend} required placeholder="https://api.nuvio.tv" /></label>
            <button class="discovery-button" type="button" onclick={() => void discoverNuvioBackend()} disabled={nuvioBusy}>Get public settings from backend</button>
            <label>Public publishable key<input type="text" bind:value={nuvioKey} autocomplete="off" required placeholder="Nuvio public client key" /></label>
            <button class="discovery-button" type="button" onclick={() => { nuvioBackend = NUVIO_CLOUD_URL; nuvioKey = NUVIO_CLOUD_PUBLISHABLE_KEY; }}>Use Nuvio Cloud</button>
          </details>
          <button class="primary-button" type="submit" disabled={nuvioBusy}>{#if nuvioBusy}<LoaderCircle size={18} class="spin" />{:else}<UserRound size={18} />{/if} Sign in to Nuvio</button>
        </form>
        {#if nuvioMessage}<p class="sync-message" role="status">{nuvioMessage}</p>{/if}
        {#if nuvioError}<p class="error-message" role="alert">{nuvioError}</p>{/if}
        <p class="login-hint">Your password is sent to the selected Nuvio backend and is not saved. Your session stays in this browser until you disconnect or clear site data.</p>
      {/if}
    </div>
  </div>
{/if}

{#if managing}
  <div class="overlay" role="presentation" in:fade={{ duration: motionDuration(180) }} out:fade={{ duration: motionDuration(150) }} onclick={(event) => { if (event.target === event.currentTarget) closeSettingsPanel(); }}>
    <div class="manage-panel" role="dialog" aria-modal="true" aria-label="Manage addons"><div class="panel-header"><div><div class="eyebrow">YOUR SOURCES</div><h2>Manage addons</h2></div><button class="icon-button" onclick={closeSettingsPanel} aria-label="Close"><X size={22} /></button></div>
      <p class="panel-copy">Set addon priority, enable the resources each addon provides, refresh its manifest, or open its configuration page. Nuvio plugin repositories add browser-compatible stream scrapers.</p>
      <div class="addon-toolbar"><span>{addons.length} active of {accountAddons.length + nuvioAddons.length + localAddons.length} installed</span><button type="button" onclick={() => void loadCatalogs()} disabled={loadingCatalogs}><RefreshCw size={15} /> Refresh catalogs</button></div>
      <div class="catalog-cache-controls"><strong>Catalog refresh</strong><label><input type="checkbox" bind:checked={autoRefreshCatalogs} onchange={updateCatalogRefresh} /> Auto refresh</label><label>Every <select bind:value={catalogRefreshInterval} onchange={updateCatalogRefresh} disabled={!autoRefreshCatalogs}><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>60 min</option></select></label><button type="button" onclick={removeCatalogCache}>Clear cache</button></div>
      <StreamSelectionSettings preferences={streamSelection} providers={selectionProviders} onChange={updateStreamSelection} />
      <label class="playback-fallback-control"><span><strong>Native player fallback</strong><small>If MoviPlayer cannot play a stream, try the browser’s video player. On by default.</small></span><input type="checkbox" role="switch" bind:checked={nativePlayerFallback} onchange={saveNativePlayerFallback} aria-label="Native player fallback" /></label>
      <details class="playback-diagnostics"><summary>Playback diagnostics <span>{playbackDiagnostics.length} events</span></summary><p>Recent player attempts remain on this device across refreshes. Reports omit stream URLs, headers, and account credentials.</p><div class="diagnostic-actions"><button type="button" onclick={() => void runPlaybackChecks()} disabled={diagnosticsChecking}>{diagnosticsChecking ? 'Checking…' : 'Check player engine'}</button><button type="button" onclick={() => void copyPlaybackReport()}>Copy report</button><button type="button" onclick={removePlaybackReport}>Clear history</button></div>{#if diagnosticsStatus}<small role="status">{diagnosticsStatus}</small>{/if}<textarea readonly aria-label="Playback diagnostic report" value={playbackReport(playbackDiagnostics)}></textarea></details>
      <form class="addon-form" onsubmit={(event) => { event.preventDefault(); void addAddon(); }}><input type="url" bind:value={addonInput} placeholder="https://addon.example/manifest.json" aria-label="Addon manifest URL" required /><button type="submit" disabled={adding}>{#if adding}<LoaderCircle size={18} class="spin" />{:else}<Plus size={18} />{/if} Install</button></form>
      {#if account || nuvioSession}<label class="source-destination">Install in <select bind:value={addonDestination}><option value="local">This browser</option>{#if account}<option value="stremio">Stremio account</option>{/if}{#if nuvioSession && nuvioProfileReady}<option value="nuvio">Nuvio profile</option>{/if}</select></label>{/if}
      {#if addonError}<p class="error-message" role="alert">{addonError}</p>{/if}
      <div class="installed-label">STREMIO ACCOUNT · {accountAddons.length}</div>
      {#each accountAddons as addon, index (addon.manifestUrl)}<AddonManagementCard {addon} source="stremio" {index} total={accountAddons.length} busy={addonWorking !== ''} onToggle={(enabled) => void setAddonEnabled('stremio', addon.manifestUrl, enabled)} onFeature={(feature, enabled) => void setAddonFeature('stremio', addon.manifestUrl, feature, enabled)} onMove={(direction) => void moveAddon('stremio', addon.manifestUrl, direction)} onRefresh={() => void refreshAddon('stremio', addon.manifestUrl)} onCopy={() => void copyAddonUrl(addon.manifestUrl)} onDelete={() => addonPendingRemoval = { source: 'stremio', url: addon.manifestUrl, name: addon.manifest.name }} />{/each}
      {#if !account}<div class="row-empty">Connect Stremio to import your account addons. <button class="text-action" onclick={() => openSettingsPanel('accounts')}>Sign in <ArrowRight size={16} /></button></div>{/if}
      {#if nuvioSession && nuvioProfileReady}<div class="installed-label">NUVIO PROFILE ADDONS · {nuvioAddons.length}</div>
        {#each nuvioAddons as addon, index (addon.manifestUrl)}<AddonManagementCard {addon} source="nuvio" {index} total={nuvioAddons.length} busy={addonWorking !== ''} readOnly={activeNuvioProfile?.uses_primary_addons === true && nuvioProfileIndex !== 1} onToggle={(enabled) => void setAddonEnabled('nuvio', addon.manifestUrl, enabled)} onFeature={(feature, enabled) => void setAddonFeature('nuvio', addon.manifestUrl, feature, enabled)} onMove={(direction) => void moveAddon('nuvio', addon.manifestUrl, direction)} onRefresh={() => void refreshAddon('nuvio', addon.manifestUrl)} onCopy={() => void copyAddonUrl(addon.manifestUrl)} onDelete={() => addonPendingRemoval = { source: 'nuvio', url: addon.manifestUrl, name: addon.manifest.name }} />{/each}
      {/if}
      <div class="installed-label">ADDED HERE · {localAddons.length}</div>
      {#each localAddons as addon, index (addon.manifestUrl)}<AddonManagementCard {addon} source="local" {index} total={localAddons.length} busy={addonWorking !== ''} onToggle={(enabled) => void setAddonEnabled('local', addon.manifestUrl, enabled)} onFeature={(feature, enabled) => void setAddonFeature('local', addon.manifestUrl, feature, enabled)} onMove={(direction) => void moveAddon('local', addon.manifestUrl, direction)} onRefresh={() => void refreshAddon('local', addon.manifestUrl)} onCopy={() => void copyAddonUrl(addon.manifestUrl)} onDelete={() => addonPendingRemoval = { source: 'local', url: addon.manifestUrl, name: addon.manifest.name }} />{/each}
      {#if !localAddons.length}<div class="row-empty">No addons added directly in Bridged Streams.</div>{/if}
      <div class="installed-label">NUVIO PLUGIN REPOSITORIES · {plugins.length}</div>
      <form class="addon-form" onsubmit={(event) => { event.preventDefault(); void addPlugin(); }}><input type="url" bind:value={pluginInput} placeholder="https://plugins.example/manifest.json" aria-label="Nuvio plugin repository URL" required /><button type="submit" disabled={addingPlugin}>{#if addingPlugin}<LoaderCircle size={18} class="spin" />{:else}<Plus size={18} />{/if} Install</button></form>
      {#if nuvioSession && nuvioProfileReady}<label class="sync-choice"><input type="checkbox" bind:checked={syncNewPlugin} /> Install new plugin repositories in my Nuvio profile</label>{/if}
      {#if pluginError}<p class="error-message" role="alert">{pluginError}</p>{/if}
      {#each plugins as repo (repo.manifestUrl)}<div class="plugin-repo"><div class="addon-row"><div class="addon-logo">N</div><div class="addon-info"><strong>{repo.name}</strong><small>{nuvioPlugins.some((item) => item.manifestUrl === repo.manifestUrl) ? 'Nuvio profile' : 'This browser'} · {repo.scrapers.filter(browserCompatible).length} enabled of {repo.scrapers.length} scrapers</small></div>{#if localPlugins.some((item) => item.manifestUrl === repo.manifestUrl)}<button class="icon-button" onclick={() => removePlugin(repo.manifestUrl)} aria-label={`Remove ${repo.name} from this browser`}><Trash2 size={18} /></button>{:else if !activeNuvioProfile?.uses_primary_plugins || nuvioProfileIndex === 1}<button class="icon-button" onclick={() => void removeNuvioPlugin(repo.manifestUrl)} aria-label={`Remove ${repo.name} from Nuvio`}><Trash2 size={18} /></button>{/if}</div>
        {#if nuvioPlugins.some((item) => item.manifestUrl === repo.manifestUrl)}<p class="panel-copy">Scraper controls sync to this Nuvio profile for Bridged Streams. Nuvio Mobile stores these controls locally.</p>{#if activeNuvioProfile?.uses_primary_plugins && nuvioProfileIndex !== 1}<p class="panel-copy">Select the primary profile to edit shared plugins.</p>{/if}{/if}
        {#each repo.scrapers as scraper (scraper.id)}
          {@const readOnly = nuvioPlugins.some((item) => item.manifestUrl === repo.manifestUrl) && activeNuvioProfile?.uses_primary_plugins && nuvioProfileIndex !== 1}
          <div class="scraper-row"><span>{scraper.name}</span>
            {#if scraper.hasSettings && platformCompatible(scraper)}<button aria-label={`Configure ${scraper.name}`} disabled={!!pluginSaving || nuvioSyncing || readOnly} onclick={() => pluginSettingsTarget = { repo, scraperId: scraper.id, synced: nuvioPlugins.some((item) => item.manifestUrl === repo.manifestUrl) }}><Settings2 size={14} /> Configure</button>{/if}
            {#if platformCompatible(scraper)}<button class:enabled={scraper.enabled !== false} aria-label={`${scraper.name} enabled`} aria-pressed={scraper.enabled !== false} disabled={!!pluginSaving || nuvioSyncing || readOnly} onclick={() => void togglePluginScraper(repo.manifestUrl, scraper.id, scraper.enabled === false)}>{pluginSaving === `${repo.manifestUrl}:${scraper.id}` ? 'Saving…' : scraper.enabled === false ? 'Off' : 'On'}</button>{:else}<small>Native only</small>{/if}
          </div>
        {/each}
      </div>{/each}
      <div class="installed-label">TMDB LOOKUP KEY</div>
      <p class="panel-copy">A TMDB API key lets Nuvio scrapers use titles from IMDb-based catalogs. The key stays in this browser.</p>
      <input class="settings-input" type="password" bind:value={tmdbKey} oninput={() => saveTmdbKey(tmdbKey)} placeholder="Your TMDB API key" aria-label="TMDB API key" autocomplete="off" />
    </div>
  </div>
{/if}

{#if pluginSettingsTarget}
  {@const target = pluginSettingsTarget}
  {@const scraper = target.repo.scrapers.find((item) => item.id === target.scraperId)}
  {#if scraper}
    <PluginSettingsDialog repo={target.repo} {scraper} {tmdbKey} synced={target.synced} onClose={() => pluginSettingsTarget = null} onSave={async (settings) => {
      await updatePluginScraper(target.repo.manifestUrl, target.scraperId, { settings });
      if (pluginSettingsTarget === target) pluginSettingsTarget = null;
    }} />
  {/if}
{/if}

{#if integrationsPanel}
  <div class="overlay" role="presentation" in:fade={{ duration: motionDuration(180) }} out:fade={{ duration: motionDuration(150) }} onclick={(event) => { if (event.target === event.currentTarget) closeSettingsPanel(); }}>
    <div class="manage-panel" role="dialog" aria-modal="true" aria-label="Integrations">
      <div class="panel-header"><div><div class="eyebrow">EXTRA DETAILS</div><h2>Integrations</h2></div><button class="icon-button" onclick={closeSettingsPanel} aria-label="Close"><X size={21} /></button></div>
      <p class="panel-copy">Choose the extra details you want to see on movie and TV show pages.</p>
      <TmdbSettingsPanel settings={tmdbSettings} apiKey={tmdbKey} onChange={updateTmdbSettings} onKeyChange={updateTmdbKey} />
    </div>
  </div>
{/if}

{#if addonPendingRemoval}
  <div class="overlay confirm-overlay" role="presentation" in:fade={{ duration: motionDuration(150) }} out:fade={{ duration: motionDuration(120) }} onclick={(event) => { if (event.target === event.currentTarget) addonPendingRemoval = null; }}>
    <div class="confirm-panel" role="dialog" aria-modal="true" aria-label="Remove addon"><h2>Remove addon?</h2><p>{addonPendingRemoval.name} will be removed from {addonPendingRemoval.source === 'local' ? 'this browser' : addonPendingRemoval.source === 'stremio' ? 'your Stremio account' : 'your Nuvio profile'}.</p><div><button class="outline-button" onclick={() => addonPendingRemoval = null}>Cancel</button><button class="confirm-delete" onclick={() => void confirmRemoveAddon()}>Remove</button></div></div>
  </div>
{/if}

{#if selected && streamScreen}
  <div class="overlay stream-overlay" role="presentation" in:fade={{ duration: motionDuration(240), easing: cubicOut }} out:fade={{ duration: motionDuration(170), easing: cubicIn }} onclick={(event) => { if (event.target === event.currentTarget) closeStreamScreen(); }}>
    <div class="stream-panel" role="dialog" aria-modal="true" aria-label={detailIdentityReady ? `Streams for ${selected.name}` : 'Title streams'}>
      <div class="stream-screen-hero" class:without-art={!episode?.thumbnail && !selected.background && !selected.poster} style:background-image={(episode?.thumbnail || selected.background || selected.poster) ? `linear-gradient(0deg, #090b0f 0%, #090b0f5c 100%), url('${(episode?.thumbnail || selected.background || selected.poster || '').replaceAll("'", '%27')}')` : ''}>
        <button class="stream-back" onclick={closeStreamScreen}><ArrowLeft size={20} /> {streamBackToDetail ? 'Details' : 'Back'}</button>
        <div class="stream-hero-copy">{#if !detailIdentityReady}<TitleSkeleton loading={loadingDetail} />{:else}<span class="section-type">CHOOSE A STREAM</span><h1>{selected.name}</h1>{#if episode}<p>S{episode.season ?? '?'} E{episode.episode ?? '?'} · {episode.title || `Episode ${episode.episode ?? '?'}`}</p>{/if}{/if}</div>
      </div>
      <div class="stream-screen-body">
        {#if detailResumeMs > 0}<div class="stream-resume-banner"><Play size={17} fill="currentColor" /> Resume from {playbackClock(detailResumeMs)}</div>{/if}
        {#if loadingDetail}<div class="loading-line"><LoaderCircle size={20} class="spin" /> Finding your {selected.type === 'series' ? 'episode' : 'streams'}…</div>{/if}
        {#if detailError}<div class="error-message" role="alert">{detailError}</div>{/if}
        {#if selected.type === 'series' && !episode && !loadingDetail}<button class="stream-choose-episode" onclick={() => router?.push(mediaRoute('detail'))}>Choose an episode <ArrowRight size={17} /></button>{/if}
        {#if detailIdentityReady && (selected.type !== 'series' || episode)}
          <div class="stream-screen-heading"><div><span class="section-type">AVAILABLE SOURCES</span><h2>Streams <small>{visiblePlayable.length}</small></h2></div></div>
          {#if streamSelection.enabled}<div class="stream-auto-actions"><button class="watch-button" onclick={() => void startPreferredStream('play')} disabled={loadingDetail || loadingStreams || playerLoading}><Play size={17} fill="currentColor" /> {detailResumeMs > 0 ? 'Resume best match' : 'Play best match'}</button><button class="cast-button" onclick={() => void startPreferredStream('cast')} disabled={!bridge || loadingDetail || loadingStreams || playerLoading} title={bridge ? 'Choose a matching stream and cast' : 'Open in PlayBridge to cast'}><Cast size={17} /> Cast best match</button></div>{/if}
          <div class="stream-provider-row" role="group" aria-label="Filter and refresh stream sources">
            <button class="stream-refresh-all" onclick={refreshAllStreams} disabled={loadingDetail} aria-label="Refresh all streams" title="Refresh all streams"><RefreshCw size={17} class={loadingStreams ? 'spin' : ''} /></button>
            <button class:active={!selectedStreamSource} class="stream-provider-chip" onclick={() => selectedStreamSource = ''}>All <small>{playable.length}</small></button>
            {#each activeStreamSources as source, index (source.key)}
              <div class:active={selectedStreamSource === source.key} class="stream-provider" style:--reveal-index={Math.min(index, 8)}>
                <button class="stream-provider-chip" onclick={() => selectedStreamSource = source.key}>{source.name} <small>{(sourceStreams[source.key] || []).filter(playableStream).length}</small>{#if sourceLoading[source.key]}<LoaderCircle size={13} class="spin" />{/if}</button>
                <button class="stream-provider-refresh" onclick={() => refreshOneStreamSource(source)} disabled={sourceLoading[source.key]} aria-label={`Refresh ${source.name} streams`} title={`Refresh ${source.name}`}><RefreshCw size={14} /></button>
              </div>
            {/each}
          </div>
          {#if sourceError}<div class="error-message" role="alert">{sourceError}</div>{/if}
          {#each activeStreamSources.filter((source) => !selectedStreamSource || selectedStreamSource === source.key) as source (source.key)}
            {#if sourceWarnings[source.key]}<p class="stream-source-warning">{sourceWarnings[source.key]}</p>{/if}
          {/each}
          {#if visibleSourcesLoading && !visiblePlayable.length}<div class="loading-line"><LoaderCircle size={20} class="spin" /> Finding streams…</div>{/if}
          <div class="stream-results">
            {#each visiblePlayable as stream, index (`${stream.addonUrl}:${stream.url}:${index}`)}
              <div class="stream-result" style:--reveal-index={Math.min(index, 8)}><div class="stream-result-copy"><strong>{streamHeading(stream, index)}</strong>{#if streamDetails(stream, streamHeading(stream, index))}<p>{streamDetails(stream, streamHeading(stream, index))}</p>{/if}<small>{stream.addonName}</small></div><div class="source-actions"><button class="watch-button" onclick={() => void playInBrowser(stream)} disabled={playerLoading}>{#if playerLoading}<LoaderCircle size={17} class="spin" /> Opening…{:else}<Play size={17} fill="currentColor" /> {stream.behaviorHints?.notWebReady ? 'Try in browser' : 'Play'}{/if}</button><button class="cast-button" onclick={() => void cast(stream)} disabled={!bridge} title={bridge ? 'Cast with PlayBridge' : 'Open in PlayBridge to cast'}><Cast size={17} /> Cast</button></div></div>
            {/each}
          </div>
          {#if !visibleSourcesLoading && !visiblePlayable.length}<div class="row-empty">No direct HTTP streams found{selectedStreamSource ? ' from this source' : ''}. Try refreshing or choose another source.</div>{/if}
          {#if unavailable && !selectedStreamSource}<p class="stream-note">{unavailable} source{unavailable === 1 ? '' : 's'} need torrent, debrid, or proxy resolution before browser playback or casting.</p>{/if}
          {#if browserUncertain && !selectedStreamSource}<p class="stream-note">{browserUncertain} source{browserUncertain === 1 ? ' is' : 's are'} marked as not web ready. Browser playback may fail.</p>{/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if selected && !streamScreen}
  <div class:season-picker-open={seasonPickerOpen} class="overlay detail-overlay" role="presentation" in:fade={{ duration: motionDuration(260), easing: cubicOut }} out:fade={{ duration: motionDuration(170), easing: cubicIn }} onclick={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
    <div class="detail-panel" role="dialog" aria-modal="true" aria-label={detailIdentityReady ? selected.name : 'Title details'}>
      <button class="detail-back" onclick={closeDetail}><ArrowLeft size={20} /> <span>Back to browsing</span></button>
      <div class="detail-hero" style:background-image={detailBackdrop ? `${selected.background ? 'linear-gradient(90deg, #090b0fec 2%, #090b0f85 43%, #090b0f24 100%), linear-gradient(0deg, #090b0f 0%, transparent 55%)' : 'linear-gradient(90deg, #090b0ff2, #090b0f99), linear-gradient(0deg, #090b0f, transparent)'}, url('${detailBackdrop.replaceAll("'", '%27')}')` : ''}>
        <div class="detail-intro">
          {#if !detailIdentityReady}<TitleSkeleton loading={loadingDetail} />{:else}
          <div class="detail-type">{selected.type === 'movie' ? 'MOVIE' : selected.type === 'series' ? 'TV SERIES' : selected.type === 'sport' ? 'SPORTS' : 'TITLE'} {selected.releaseInfo ? `· ${displayReleaseInfo(selected.releaseInfo)}` : ''}</div>
          {#if selected.logo}<img class="detail-logo" src={selected.logo} alt={selected.name} />{:else}<h1>{selected.name}</h1>{/if}
          {#if selected.genres?.length}<div class="detail-genres">{selected.genres.slice(0, 4).join('  ·  ')}</div>{/if}
          <div class="detail-actions"><button class="detail-play" onclick={() => void detailPlay()} disabled={loadingDetail}>{#if loadingDetail}<LoaderCircle size={21} class="spin" />{:else}<Play size={21} fill="currentColor" />{/if} {loadingDetail ? 'Loading…' : selected.type === 'series' ? (episode && detailResumeMs > 0 ? `Resume S${episode.season ?? '?'}E${episode.episode ?? '?'}` : 'Choose episode') : detailResumeMs > 0 ? 'Resume' : 'Play'}</button>{#if streamSelection.enabled}<button class="detail-action-icon" onclick={() => void detailPlay('cast')} disabled={loadingDetail || !bridge} aria-label="Cast with auto-selection" title={bridge ? 'Choose a matching stream and cast' : 'Open in PlayBridge to cast'}><Cast size={21} /></button>{/if}<button class="detail-action-icon" onclick={() => detailJump('detail-about')} aria-label="About this title" title="About this title"><Info size={21} /></button>{#if account && (selected.type === 'movie' || selected.type === 'series')}<button class:added={selectedInLibrary} class="detail-action-icon" onclick={() => void toggleLibrary()} disabled={libraryBusy} aria-label={selectedInLibrary ? 'Remove from Stremio library' : 'Add to Stremio library'} title={selectedInLibrary ? 'Remove from Stremio library' : 'Add to Stremio library'}>{#if libraryBusy}<LoaderCircle size={20} class="spin" />{:else}<Bookmark size={20} fill={selectedInLibrary ? 'currentColor' : 'none'} />{/if}</button>{/if}{#if nuvioSession && nuvioProfileReady && (selected.type === 'movie' || selected.type === 'series')}<button class:added={selectedInNuvioLibrary} class="detail-action-icon" onclick={() => void toggleNuvioLibrary()} disabled={nuvioLibraryBusy} aria-label={selectedInNuvioLibrary ? 'Remove from Nuvio library' : 'Add to Nuvio library'} title={selectedInNuvioLibrary ? 'Remove from Nuvio library' : 'Add to Nuvio library'}>{#if nuvioLibraryBusy}<LoaderCircle size={20} class="spin" />{:else}<Library size={20} />{/if}</button>{/if}</div>
          <div class="detail-facts">{#if selected.imdbRating}<span class="detail-rating"><Star size={16} fill="currentColor" /> {selected.imdbRating}<small>/10{selected.ratingSource ? ` · ${selected.ratingSource}` : ''}</small></span>{/if}{#if selected.releaseInfo}<span>{displayReleaseInfo(selected.releaseInfo)}</span>{/if}{#if selected.runtime}<span>{selected.runtime}</span>{/if}{#if selected.ageRating}<span>{selected.ageRating}</span>{/if}<span>{selected.type === 'series' ? 'Series' : selected.type === 'movie' ? 'Movie' : 'Sports'}</span></div>
          {#if selected.description}<p class:expanded={detailExpanded} class="detail-description">{selected.description}</p>{#if selected.description.length > 190}<button class="detail-read-more" onclick={() => detailExpanded = !detailExpanded}>{detailExpanded ? 'Show less' : 'Read more'}</button>{/if}{/if}
          {/if}
        </div>
        {#if selected.director || selected.writer || selected.cast?.length || selected.country || selected.status || selected.language}<aside class="detail-facts-card" aria-label="Title facts">{#if selected.director}<div><span>DIRECTED BY</span><strong>{Array.isArray(selected.director) ? selected.director.join(', ') : selected.director}</strong></div>{/if}{#if selected.writer}<div><span>WRITTEN BY</span><strong>{Array.isArray(selected.writer) ? selected.writer.join(', ') : selected.writer}</strong></div>{/if}{#if selected.cast?.length}<div><span>STARRING</span><strong>{selected.cast.slice(0, 3).join(', ')}</strong></div>{/if}{#if selected.country}<div><span>COUNTRY</span><strong>{selected.country}</strong></div>{/if}{#if selected.status}<div><span>STATUS</span><strong>{selected.status}</strong></div>{/if}{#if selected.language}<div><span>ORIGINAL LANGUAGE</span><strong>{selected.language.toUpperCase()}</strong></div>{/if}</aside>{/if}
      </div>
      <div id="detail-about" class="detail-content">
        {#if loadingDetail}<div class="loading-line"><LoaderCircle size={20} class="spin" /> Loading details…</div>{/if}
        {#if enrichmentBusy}<p class="tmdb-detail-status" role="status">Adding TMDB details…</p>{/if}
        {#if enrichmentError}<p class="tmdb-detail-status">{enrichmentError} <button class="text-action" onclick={() => { const base = selected && detailMemory.get(`${selected.type}:${selected.id}`); if (base) { lastEnrichmentSeasonKey = ''; void enrichDetail(base); } }}>Retry TMDB details</button></p>{/if}
        {#if detailError}<div class="error-message">{detailError}</div>{/if}
        {#if detailIdentityReady && selected.type === 'series'}
          <section id="detail-episodes" class="detail-section"><div class="section-heading"><div><span class="section-type">EXPLORE THE STORY</span><h2>Episodes</h2>{#if pendingEpisodeAction === 'cast'}<p class="episode-action-hint">Choose an episode to cast. <button onclick={() => pendingEpisodeAction = 'play'}>Cancel</button></p>{/if}</div>{#if seasons.length}<div class="season-picker"><button class="season-trigger" onclick={() => void openSeasonPicker()} aria-expanded={seasonPickerOpen} aria-controls="season-options"><span>{season === 0 ? 'Specials' : `Season ${season}`}</span><ChevronDown size={17} class={seasonPickerOpen ? 'flipped' : ''} /></button>{#if seasonPickerOpen}<div id="season-options" class="season-popover" role="group" aria-label="Choose season">{#each seasonSummaries as item}<button class:active={item.value === season} class="season-option" onclick={() => chooseSeason(item.value)}><span class="season-option-art">{#if item.image}<img src={item.image} alt="" loading="lazy" />{:else}<Tv size={19} />{/if}</span><span class="season-option-copy"><strong>{item.label}</strong><small>{item.count} {item.count === 1 ? 'episode' : 'episodes'}</small></span></button>{/each}</div>{/if}</div>{/if}</div>
          {#if episodes.length}<div class="episode-list" bind:this={episodeListElement}>{#each episodes as video, index (video.id)}<button class:selected={episode?.id === video.id} class="episode-row" style:--reveal-index={Math.min(index, 8)} onclick={() => openStreamScreen(video)}><span class="episode-art">{#if video.thumbnail}<img src={video.thumbnail} alt="" loading="lazy" />{:else if selected?.background}<img src={selected.background} alt="" loading="lazy" />{:else}<Film size={28} />{/if}<small>E{video.episode ?? '?'}</small></span><span class="episode-text"><small>SEASON {video.season} · EPISODE {video.episode}</small><strong>{video.title || `Episode ${video.episode}`}</strong>{#if video.description}<span>{video.description}</span>{/if}{#if video.runtime}<small>{video.runtime} min</small>{/if}</span><span class="episode-arrow"><Play size={18} fill="currentColor" /></span></button>{/each}</div>{:else if !loadingDetail}<div class="row-empty">No episode list was returned by the metadata addon.</div>{/if}</section>
        {/if}
        {#if selected.cast?.length && !selected.people?.length}<section class="detail-section"><div class="section-heading"><div><span class="section-type">THE PEOPLE</span><h2>Cast</h2></div></div><div class="cast-list">{#each selected.cast.slice(0, 12) as name}<div class="cast-person"><span>{name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><strong>{name}</strong></div>{/each}</div></section>{/if}
        <TmdbDetails meta={selected} onTrailer={(trailer) => activeTrailer = trailer} onSelect={(item) => { openDetail(item); document.querySelector('.detail-panel')?.scrollTo({ top: 0, behavior: 'smooth' }); }} />
        {#if detailIdentityReady && !selected.moreLikeThis?.length && relatedTitles.length}<section class="detail-section"><div class="section-heading"><div><span class="section-type">FROM YOUR ADDONS</span><h2>You might also like</h2></div></div><div class="media-row">{#each relatedTitles as item (item.type + item.id)}<MediaTile {item} onSelect={() => { void openDetail(item); document.querySelector('.detail-panel')?.scrollTo({ top: 0, behavior: 'smooth' }); }} />{/each}</div></section>{/if}
      </div>
      {#if seasonPickerOpen}
        <div class="season-mobile-sheet" role="dialog" aria-modal="true" aria-label="Choose season">
          <div class="season-mobile-head"><strong>Seasons</strong><button onclick={() => seasonPickerOpen = false} aria-label="Close seasons"><X size={21} /></button></div>
          <div class="season-wheel" bind:this={seasonWheel} onscroll={seasonWheelScrolled} role="group" aria-label="Seasons">{#each seasonSummaries as item}<button class:active={item.value === season} onclick={() => chooseSeason(item.value)} aria-current={item.value === season ? 'true' : undefined}>{item.label}</button>{/each}</div>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if activeTrailer}<TrailerPlayer trailer={activeTrailer} onClose={() => activeTrailer = null} />{/if}

{#if playing}
  <div class="player-overlay" role="dialog" aria-modal="true" aria-label={`Now playing ${playing.meta.name}`} in:fade={{ duration: motionDuration(220), easing: cubicOut }} out:fade={{ duration: motionDuration(160), easing: cubicIn }}>
    <div class="player-top"><button class="player-back" onclick={closePlayer}><ArrowLeft size={21} /> Choose another stream</button><div class="player-title"><strong>{playing.meta.name}</strong>{#if playing.video}<span> S{playing.video.season} E{playing.video.episode} · {playing.video.title || 'Episode'}</span>{/if}</div><button class="player-close" onclick={closePlayer} aria-label="Close player"><X size={22} /></button></div>
    <div class="player-stage">
      {#if playerReady}
        <movi-player bind:this={playerElement} src={playing.stream.url} poster={playing.meta.background || playing.meta.poster || ''} title={playing.video?.title || playing.meta.name} headers={JSON.stringify(playing.stream.headers || {})} wasmurl={moviWasmUrl} controls autoplay playsinline theme="dark" sw="auto" fallback={nativePlayerFallback ? 'native' : undefined} onloadedmetadata={browserMetadataReady} oncanplay={browserCanPlay} onplaying={() => logPlayback('playing')} onwaiting={() => logPlayback('waiting')} onstalled={() => logPlayback('stalled')} ontimeupdate={browserTimeUpdate} onpause={browserPaused} onended={browserPlaybackEnded} onerror={browserPlaybackError} onnativefallback={() => { logPlayback('native fallback'); playerError = ''; }}></movi-player>
      {:else if nativePlayerFallback}
        <!-- svelte-ignore a11y_media_has_caption: source addons do not always provide a caption track -->
        <video bind:this={playerElement} src={playing.stream.url} poster={playing.meta.background || playing.meta.poster || ''} controls autoplay playsinline onloadedmetadata={browserMetadataReady} oncanplay={browserCanPlay} onplaying={() => logPlayback('native playing')} onwaiting={() => logPlayback('native waiting')} onstalled={() => logPlayback('native stalled')} ontimeupdate={browserTimeUpdate} onpause={browserPaused} onended={browserPlaybackEnded} onerror={browserPlaybackError}></video>
      {/if}
    </div>
    <div class="player-bottom"><div><span class="eyebrow">PLAYING IN YOUR BROWSER</span><h2>{playing.video?.title || playing.meta.name}</h2><p>{playing.stream.name || playing.stream.title || playing.stream.addonName} · {playing.stream.addonName}</p></div>{#if bridge}<button class="cast-button" onclick={() => void castPlaying()}><Cast size={17} /> Cast to PlayBridge</button>{/if}</div>
    {#if playerError}<p class="player-error" role="alert">{playerError}</p>{/if}
    {#if playerError}<details class="playback-diagnostics player-diagnostics"><summary>Playback diagnostics <span>Open report</span></summary><p>Run an engine check, then copy the report. Stream URLs, headers, and account credentials are omitted.</p><div class="diagnostic-actions"><button type="button" onclick={() => void runPlaybackChecks()} disabled={diagnosticsChecking}>{diagnosticsChecking ? 'Checking…' : 'Check player engine'}</button><button type="button" onclick={() => void copyPlaybackReport()}>Copy report</button></div>{#if diagnosticsStatus}<small role="status">{diagnosticsStatus}</small>{/if}<textarea readonly aria-label="Playback diagnostic report" value={playbackReport(playbackDiagnostics)}></textarea></details>{/if}
  </div>
{/if}
