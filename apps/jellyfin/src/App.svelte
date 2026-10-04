<script lang="ts">
  import { onMount } from 'svelte';
  import PlaybackDestination from './lib/components/PlaybackDestination.svelte';
  import Navbar from './lib/components/Navbar.svelte';
  import LoginScreen from './lib/components/LoginScreen.svelte';
  import HeroSpotlight from './lib/components/HeroSpotlight.svelte';
  import MediaSection from './lib/components/MediaSection.svelte';
  import MediaCard from './lib/components/MediaCard.svelte';
  import ItemDetailModal from './lib/components/ItemDetailModal.svelte';
  import VideoPlayer from './lib/components/VideoPlayer.svelte';
  import ServerConnectModal from './lib/components/ServerConnectModal.svelte';
  import DiagnosticsDrawer from './lib/components/DiagnosticsDrawer.svelte';
  import QueueDrawer from './lib/components/QueueDrawer.svelte';

  import {
    activeTab,
    serverConfig,
    userViews,
    latestMedia,
    resumeMedia,
    nextUpMedia,
    libraryLatestMap,
    moviesList,
    showsList,
    allLibraryItems,
    searchQuery,
    selectedGenre,
    sortBy,
    isLoadingLibrary,
    initializeSession,
    playFolderOrAlbumWithCast,
    playMedia,
    shufflePlay,
    shuffleCast,
    activeToast,
    favoritesRevision
  } from './lib/stores/appState';
  import { bridgeStatus, initPlayBridgeDetector } from './lib/cast/playbridge';
  import * as jfApi from './lib/api/jellyfin';
  import { getCachedData } from './lib/api/cache';
  import type { JellyfinItem, ServerConfig } from './lib/types';
  import {
    Film,
    Clapperboard,
    Sparkles,
    Search,
    Loader2,
    SlidersHorizontal,
    Folder,
    Cast,
    Play,
    Shuffle,
    Music,
    Tv,
    Layers,
    ChevronRight,
    ArrowLeft
  } from 'lucide-svelte';

  let customViewItems: JellyfinItem[] = [];
  let customViewLimit = 48;
  let isLoadingCustomView = false;
  let activeLibraryViewId: string | null = null;
  let folderStack: Array<{ id: string; name: string }> = [];

  $: visibleCustomItems = customViewItems.slice(0, customViewLimit);
  $: if ($activeTab) {
    customViewLimit = 48;
  }

  onMount(() => {
    const disposeBridge = initPlayBridgeDetector();
    initializeSession();
    return () => { disposeBridge(); clearTimeout(queryTimer); ++queryRequest; ++folderRequest; };
  });

  // Folder state belongs to an account, even when library IDs coincide.
  let folderConfig: ServerConfig;
  $: if ($serverConfig !== folderConfig) {
    folderConfig = $serverConfig;
    ++folderRequest;
    activeLibraryViewId = '';
    folderStack = [];
    customViewItems = [];
    isLoadingCustomView = false;
  }

  // Active view object
  $: currentView = $userViews.find((v) => v.Id === $activeTab);

  // When active tab switches to a user view, initialize folder stack and load root of that view
  $: if (
    $serverConfig.connected &&
    currentView &&
    currentView.Id !== activeLibraryViewId &&
    $activeTab !== 'home' &&
    $activeTab !== 'search' &&
    $activeTab !== 'favorites' &&
    $activeTab !== 'movies' &&
    $activeTab !== 'shows'
  ) {
    activeLibraryViewId = currentView.Id;
    folderStack = [{ id: currentView.Id, name: currentView.Name }];
    loadFolderLevel(currentView.Id, currentView.CollectionType, false);
  }

  async function loadFolderLevel(folderId: string, collectionType?: string, isSubfolder = false) {
    if (!$serverConfig.connected || $serverConfig.isDemo) return;

    const isTypedRoot =
      !isSubfolder &&
      (collectionType === 'movies' || collectionType === 'tvshows' || collectionType === 'music');

    const queryOptions: any = {
      parentId: folderId,
      recursive: isTypedRoot ? true : false
    };

    if (isTypedRoot) {
      if (collectionType === 'movies') queryOptions.includeItemTypes = 'Movie';
      else if (collectionType === 'tvshows') queryOptions.includeItemTypes = 'Series';
      else if (collectionType === 'music') queryOptions.includeItemTypes = 'Audio,MusicAlbum,MusicArtist,Folder';
    }

    const config = $serverConfig;
    const request = ++folderRequest;
    const cacheKey = jfApi.cacheKey(config.url, config.userId, 'library', queryOptions);
    const cached = getCachedData<{ items: JellyfinItem[] }>(cacheKey);
    if (cached && cached.items && cached.items.length > 0) {
      customViewItems = cached.items;
      isLoadingCustomView = false;
    } else {
      isLoadingCustomView = true;
    }

    try {
      const res = await jfApi.getLibraryItems(
        config.url,
        config.userId,
        config.token,
        queryOptions,
        (fresh) => {
          if (request === folderRequest && config === $serverConfig) customViewItems = fresh.items;
        }
      );
      if (request === folderRequest && config === $serverConfig) customViewItems = res.items;
    } catch (err) {
      console.error('Failed to fetch folder items', err);
    } finally {
      if (request === folderRequest) isLoadingCustomView = false;
    }
  }
  let folderRequest = 0;

  function handleNavigateIntoFolder(folderItem: JellyfinItem) {
    folderStack = [...folderStack, { id: folderItem.Id, name: folderItem.Name }];
    loadFolderLevel(folderItem.Id, currentView?.CollectionType, true);
  }

  function handleNavigateToBreadcrumb(index: number) {
    folderStack = folderStack.slice(0, index + 1);
    const target = folderStack[folderStack.length - 1];
    loadFolderLevel(target.id, currentView?.CollectionType, folderStack.length > 1);
  }

  function handleBackOneFolder() {
    if (folderStack.length > 1) {
      handleNavigateToBreadcrumb(folderStack.length - 2);
    }
  }

  // Featured Spotlight item
  $: featuredItem =
    $latestMedia.length > 0
      ? $latestMedia[0]
      : $moviesList.length > 0
      ? $moviesList[0]
      : $allLibraryItems.length > 0
      ? $allLibraryItems[0]
      : null;

  // Genres extraction
  $: availableGenres = Array.from(
    new Set(
      $allLibraryItems
        .flatMap((i) => i.Genres || [])
        .filter(Boolean)
    )
  );

  // Filtered Movies
  $: filteredMovies = $moviesList.filter((m) => {
    const matchGenre = $selectedGenre === 'all' || (m.Genres && m.Genres.includes($selectedGenre));
    const matchSearch = !$searchQuery || m.Name.toLowerCase().includes($searchQuery.toLowerCase());
    return matchGenre && matchSearch;
  });

  // Filtered Shows
  $: filteredShows = $showsList.filter((s) => {
    const matchGenre = $selectedGenre === 'all' || (s.Genres && s.Genres.includes($selectedGenre));
    const matchSearch = !$searchQuery || s.Name.toLowerCase().includes($searchQuery.toLowerCase());
    return matchGenre && matchSearch;
  });

  let remoteItems: JellyfinItem[] = [];
  let remoteTotal = 0;
  let remoteBusy = false;
  let remoteError = '';
  let queryRequest = 0;
  let queryTimer: ReturnType<typeof setTimeout>;
  let queryScope = '';
  $: scheduleServerQuery($serverConfig, $activeTab, $searchQuery.trim(), $favoritesRevision);
  function scheduleServerQuery(config: ServerConfig, tab: string, term: string, revision: number) {
    clearTimeout(queryTimer);
    ++queryRequest;
    remoteItems = []; remoteTotal = 0; remoteError = ''; remoteBusy = false;
    queryScope = `${config.url}|${config.userId}|${tab}|${term}|${revision}`;
    if (config.isDemo || !config.connected || !['search', 'favorites'].includes(tab) || (tab === 'search' && !term)) return;
    remoteBusy = true;
    queryTimer = setTimeout(() => void fetchServerQuery(config, tab, term, false), tab === 'search' ? 250 : 0);
  }
  async function fetchServerQuery(config = $serverConfig, tab = $activeTab, term = $searchQuery.trim(), append = true) {
    const request = ++queryRequest;
    const scope = queryScope;
    const startIndex = append ? remoteItems.length : 0;
    remoteBusy = true; remoteError = '';
    try {
      const options = { searchTerm: tab === 'search' ? term : undefined, filters: tab === 'favorites' ? 'IsFavorite' : undefined,
        recursive: true, sortBy: 'SortName', sortOrder: 'Ascending' as const, limit: 48, startIndex };
      const result = await jfApi.getLibraryItems(config.url, config.userId, config.token, options);
      if (request !== queryRequest || scope !== queryScope || config !== $serverConfig) return;
      remoteItems = append ? [...remoteItems, ...result.items] : result.items;
      remoteTotal = result.totalRecordCount;
    } catch {
      if (request === queryRequest) remoteError = 'Could not load this server view. Please retry.';
    } finally { if (request === queryRequest) remoteBusy = false; }
  }
  $: searchResults = !$serverConfig.isDemo ? remoteItems : $searchQuery.trim()
    ? $allLibraryItems.filter(i => [i.Name, i.Overview, i.AlbumArtist, ...(i.Genres || []), ...(i.Artists || [])]
      .some(value => value?.toLowerCase().includes($searchQuery.toLowerCase()))) : [];
  $: favoriteItems = !$serverConfig.isDemo ? remoteItems : $allLibraryItems.filter(i => i.UserData?.IsFavorite);

  function handleBatchCastFolder() {
    if (!currentView || customViewItems.length === 0) return;
    const folderItem: JellyfinItem = {
      Id: currentView.Id,
      Name: currentView.Name,
      Type: 'Folder',
      tracks: customViewItems
    };
    playFolderOrAlbumWithCast(folderItem, customViewItems, 0);
  }

  function handlePlayFolder() {
    if (!currentView || customViewItems.length === 0) return;
    const folderItem: JellyfinItem = {
      Id: currentView.Id,
      Name: currentView.Name,
      Type: 'Folder',
      tracks: customViewItems
    };
    playMedia(folderItem, customViewItems, 0, false);
  }

  function handleShufflePlayFolder() {
    if (!currentView || customViewItems.length === 0) return;
    const folderItem: JellyfinItem = {
      Id: currentView.Id,
      Name: currentView.Name,
      Type: 'Folder',
      tracks: customViewItems
    };
    shufflePlay(folderItem, customViewItems);
  }

  function handleShuffleCastFolder() {
    if (!currentView || customViewItems.length === 0) return;
    const folderItem: JellyfinItem = {
      Id: currentView.Id,
      Name: currentView.Name,
      Type: 'Folder',
      tracks: customViewItems
    };
    shuffleCast(folderItem, customViewItems);
  }
</script>

{#if !$serverConfig.connected}
  <!-- Full Screen Login / Connect Screen -->
  <LoginScreen />
{:else}
  <!-- Main Jellyfin Web Client Layout -->
  <div class="app-layout">
    <Navbar />

    <!-- Floating Cast Toast Notification -->
    {#if $activeToast}
      <div class="toast-notification">
        <div class="toast-badge">
          <Cast size={15} />
        </div>
        <span class="toast-text">{$activeToast.message}</span>
      </div>
    {/if}

    <main class="main-content">
      <PlaybackDestination />
      {#if $isLoadingLibrary}
        <div class="loading-state">
          <Loader2 size={36} class="spinner" />
          <p>Loading library from {$serverConfig.serverName || 'Jellyfin'}...</p>
        </div>
      {:else}
        <!-- TAB: HOME -->
        {#if $activeTab === 'home'}
          {#if featuredItem}
            <HeroSpotlight item={featuredItem} />
          {/if}

          <div class="sections-wrapper">
            <!-- 1. My Media (Jellyfin Official Library Tiles) -->
            {#if $userViews.length > 0}
              <section class="my-media-section">
                <div class="section-header-row">
                  <h2 class="section-title">My Media</h2>
                  <span class="section-sub">{$userViews.length} libraries on {$serverConfig.serverName}</span>
                </div>

                <div class="library-tiles-grid">
                  {#each $userViews as view (view.Id)}
                    <button class="library-tile-card" on:click={() => ($activeTab = view.Id)}>
                      <div class="tile-icon-box">
                        {#if view.CollectionType === 'movies'}
                          <Film size={26} />
                        {:else if view.CollectionType === 'tvshows'}
                          <Clapperboard size={26} />
                        {:else if view.CollectionType === 'music'}
                          <Music size={26} />
                        {:else}
                          <Folder size={26} />
                        {/if}
                      </div>

                      <div class="tile-info">
                        <span class="tile-title">{view.Name}</span>
                        <span class="tile-kind">
                          {view.CollectionType === 'movies'
                            ? 'Movies'
                            : view.CollectionType === 'tvshows'
                            ? 'TV Shows'
                            : view.CollectionType === 'music'
                            ? 'Music'
                            : 'Library'}
                        </span>
                      </div>
                    </button>
                  {/each}
                </div>
              </section>
            {/if}

            <!-- 2. Continue Watching (Resume) -->
            {#if $resumeMedia.length > 0}
              <MediaSection
                title="Continue Watching"
                subtitle="Pick up where you left off"
                items={$resumeMedia}
              />
            {/if}

            <!-- 3. Next Up (Television In-Progress Episodes) -->
            {#if $nextUpMedia.length > 0}
              <MediaSection
                title="Next Up"
                subtitle="Next unplayed episodes in your shows"
                items={$nextUpMedia}
              />
            {/if}

            <!-- 4. Dedicated Recently Added Shelves per Library -->
            {#each $userViews as view (view.Id)}
              {#if $libraryLatestMap[view.Id] && $libraryLatestMap[view.Id].length > 0}
                <MediaSection
                  title={`Recently Added in ${view.Name}`}
                  subtitle={`New additions to your ${view.Name} library`}
                  items={$libraryLatestMap[view.Id]}
                  onSeeAll={() => ($activeTab = view.Id)}
                />
              {/if}
            {/each}

            <!-- Fallback generic sections if server does not have segmented latest -->
            {#if Object.keys($libraryLatestMap).length === 0}
              {#if $latestMedia.length > 0}
                <MediaSection
                  title="Latest Media"
                  subtitle="Recently added to {$serverConfig.serverName}"
                  items={$latestMedia}
                />
              {/if}

              {#if $moviesList.length > 0}
                <MediaSection
                  title="Movies"
                  subtitle="Feature films and cinema"
                  items={$moviesList}
                />
              {/if}

              {#if $showsList.length > 0}
                <MediaSection
                  title="TV Series"
                  subtitle="Series, seasons and next episodes"
                  items={$showsList}
                />
              {/if}
            {/if}
          </div>

        <!-- TAB: MOVIES -->
        {:else if $activeTab === 'movies'}
          <div class="library-view">
            <div class="view-header">
              <div>
                <h1 class="view-title">Movies</h1>
                <p class="view-subtitle">{filteredMovies.length} titles in library</p>
              </div>

              <!-- Genre filters -->
              {#if availableGenres.length > 0}
                <div class="genre-filter-bar">
                  <button
                    class="genre-chip"
                    class:active={$selectedGenre === 'all'}
                    on:click={() => ($selectedGenre = 'all')}
                  >
                    All
                  </button>
                  {#each availableGenres as genre}
                    <button
                      class="genre-chip"
                      class:active={$selectedGenre === genre}
                      on:click={() => ($selectedGenre = genre)}
                    >
                      {genre}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>

            <div class="media-grid">
              {#each filteredMovies as item (item.Id)}
                <MediaCard {item} />
              {/each}
            </div>
          </div>

        <!-- TAB: TV SHOWS -->
        {:else if $activeTab === 'shows'}
          <div class="library-view">
            <div class="view-header">
              <div>
                <h1 class="view-title">TV Shows</h1>
                <p class="view-subtitle">{filteredShows.length} series in library</p>
              </div>

              {#if availableGenres.length > 0}
                <div class="genre-filter-bar">
                  <button
                    class="genre-chip"
                    class:active={$selectedGenre === 'all'}
                    on:click={() => ($selectedGenre = 'all')}
                  >
                    All
                  </button>
                  {#each availableGenres as genre}
                    <button
                      class="genre-chip"
                      class:active={$selectedGenre === genre}
                      on:click={() => ($selectedGenre = genre)}
                    >
                      {genre}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>

            <div class="media-grid">
              {#each filteredShows as item (item.Id)}
                <MediaCard {item} />
              {/each}
            </div>
          </div>

        <!-- TAB: DYNAMIC USER FOLDERS / CUSTOM VIEWS -->
        {:else if currentView}
          <div class="library-view">
            <div class="view-header">
              <div class="view-title-group">
                <!-- Breadcrumbs and back button -->
                {#if folderStack.length > 1}
                  <div class="breadcrumbs-bar">
                    <button class="back-folder-btn" on:click={handleBackOneFolder} title="Go back to parent folder">
                      <ArrowLeft size={16} />
                      <span>Back</span>
                    </button>

                    <div class="crumbs-trail">
                      {#each folderStack as crumb, idx}
                        {#if idx > 0}
                          <ChevronRight size={13} class="crumb-sep" />
                        {/if}
                        {#if idx === folderStack.length - 1}
                          <span class="crumb-current">{crumb.name}</span>
                        {:else}
                          <button class="crumb-link" on:click={() => handleNavigateToBreadcrumb(idx)}>
                            {crumb.name}
                          </button>
                        {/if}
                      {/each}
                    </div>
                  </div>
                {/if}

                <h1 class="view-title">{folderStack.length > 0 ? folderStack[folderStack.length - 1].name : currentView.Name}</h1>
                <p class="view-subtitle">
                  {customViewItems.length} items in {folderStack.length > 0 ? folderStack[folderStack.length - 1].name : currentView.Name}
                </p>
              </div>

              <!-- Quick actions for Music/Audio folders -->
              {#if currentView.CollectionType === 'music' || customViewItems.some((i) => i.Type === 'Audio' || i.Type === 'MusicAlbum')}
                <div class="batch-cast-actions">
                  {#if $bridgeStatus.available && !$bridgeStatus.playback}
                    <button class="btn-primary batch-btn" on:click={handleBatchCastFolder}>
                      <Cast size={16} />
                      <span>Cast All</span>
                    </button>
                  {/if}
                  <button class="btn-secondary batch-btn" on:click={handlePlayFolder}>
                    <Play size={16} />
                    <span>Play</span>
                  </button>
                  <button class="btn-secondary batch-btn" on:click={handleShufflePlayFolder} title="Shuffle Play in Browser">
                    <Shuffle size={16} />
                    <span>Shuffle</span>
                  </button>
                  {#if $bridgeStatus.available && !$bridgeStatus.playback}
                    <button class="btn-accent batch-btn" on:click={handleShuffleCastFolder} title="Shuffle Cast to PlayBridge Receiver">
                      <Shuffle size={16} />
                      <span>Shuffle Cast</span>
                    </button>
                  {/if}
                </div>
              {/if}
            </div>

            {#if isLoadingCustomView}
              <div class="loading-state">
                <Loader2 size={32} class="spinner" />
                <p>Loading items...</p>
              </div>
            {:else if customViewItems.length === 0}
              <div class="empty-state">
                <Folder size={44} class="empty-icon" />
                <p>No media found in this folder</p>
              </div>
            {:else}
              <div class="media-grid">
                {#each visibleCustomItems as item (item.Id)}
                  <MediaCard {item} onOpenFolder={handleNavigateIntoFolder} />
                {/each}
              </div>

              {#if customViewItems.length > customViewLimit}
                <div class="load-more-row">
                  <button class="btn-secondary load-more-btn" on:click={() => (customViewLimit += 48)}>
                    <span>Load More ({customViewItems.length - customViewLimit} remaining)</span>
                  </button>
                </div>
              {/if}
            {/if}
          </div>

        <!-- TAB: SEARCH -->
        {:else if $activeTab === 'search'}
          <div class="library-view">
            <div class="view-header">
              <div>
                <h1 class="view-title">Search Results</h1>
                <p class="view-subtitle">
                  {searchResults.length} matches for "{$searchQuery}"
                </p>
              </div>
            </div>

            {#if remoteBusy}<p role="status">Searching server…</p>{/if}
            {#if remoteError}<p role="alert">{remoteError}</p><button class="btn-secondary" on:click={() => fetchServerQuery(undefined, undefined, undefined, false)}>Retry</button>{/if}
            {#if searchResults.length === 0 && !remoteBusy && !remoteError}
              <div class="empty-state">
                <Search size={44} class="empty-icon" />
                <p>No results found for "{$searchQuery}"</p>
                <span class="empty-sub">Try searching for a movie, series, track, or artist.</span>
              </div>
            {:else}
              <div class="media-grid">
                {#each searchResults as item (item.Id)}
                  <MediaCard {item} onOpenFolder={handleNavigateIntoFolder} />
                {/each}
              </div>
            {/if}

            {#if !$serverConfig.isDemo && remoteItems.length < remoteTotal}<button class="btn-secondary" disabled={remoteBusy} on:click={() => fetchServerQuery()}>Load more results</button>{/if}
          </div>

        <!-- TAB: FAVORITES -->
        {:else if $activeTab === 'favorites'}
          <div class="library-view">
            <div class="view-header">
              <div>
                <h1 class="view-title">Favorites</h1>
                <p class="view-subtitle">{favoriteItems.length} bookmarked titles</p>
              </div>
            </div>

            {#if remoteBusy}<p role="status">Loading favorites…</p>{/if}
            {#if remoteError}<p role="alert">{remoteError}</p><button class="btn-secondary" on:click={() => fetchServerQuery(undefined, undefined, undefined, false)}>Retry</button>{/if}
            {#if favoriteItems.length === 0 && !remoteBusy && !remoteError}
              <div class="empty-state">
                <Sparkles size={44} class="empty-icon" />
                <p>No favorites yet</p>
              </div>
            {:else}
              <div class="media-grid">
                {#each favoriteItems as item (item.Id)}
                  <MediaCard {item} onOpenFolder={handleNavigateIntoFolder} />
                {/each}
              </div>
            {/if}

            {#if !$serverConfig.isDemo && remoteItems.length < remoteTotal}<button class="btn-secondary" disabled={remoteBusy} on:click={() => fetchServerQuery()}>Load more results</button>{/if}
          </div>
        {/if}
      {/if}
    </main>

    <!-- Modals & Overlays -->
    <ItemDetailModal />
    <VideoPlayer />
    <QueueDrawer />
    <ServerConnectModal />
    <DiagnosticsDrawer />
  </div>
{/if}

<style>
  .app-layout {
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-base);
    padding-bottom: calc(120px + env(safe-area-inset-bottom, 0px));
  }

  @media (min-width: 769px) {
    .app-layout {
      padding-bottom: 74px;
    }
  }

  /* Floating Toast Notification */
  .toast-notification {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(29, 23, 40, 0.9);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(122, 107, 174, 0.4);
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.8), 0 0 20px rgba(149, 255, 80, 0.2);
    padding: 8px 18px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 80;
    animation: toastSlideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    max-width: 90vw;
  }

  @keyframes toastSlideDown {
    from { opacity: 0; transform: translate(-50%, -10px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }

  .toast-badge {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent-gradient);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #050505;
    flex-shrink: 0;
  }

  .toast-text {
    font-size: 0.88rem;
    font-weight: 700;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .loading-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 80px 20px;
    color: var(--text-muted);
  }

  .spinner {
    animation: spin 1s linear infinite;
    color: var(--theme-primary-accent);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .sections-wrapper {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* My Media (Library Tiles) Section */
  .my-media-section {
    padding: 16px 36px 8px;
    max-width: 1440px;
    margin: 0 auto;
    width: 100%;
  }

  .section-header-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .section-title {
    font-size: 1.35rem;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -0.02em;
  }

  .section-sub {
    font-size: 0.8rem;
    color: var(--theme-type-muted);
  }

  .library-tiles-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
  }

  .library-tile-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    background: rgba(29, 23, 40, 0.65);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(122, 107, 174, 0.22);
    border-radius: var(--radius-lg);
    cursor: pointer;
    text-align: left;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .library-tile-card:hover {
    background: rgba(48, 39, 65, 0.85);
    border-color: var(--theme-primary-accent);
    transform: translateY(-3px);
    box-shadow: 0 10px 24px rgba(13, 10, 18, 0.8), 0 0 16px rgba(149, 255, 80, 0.2);
  }

  .tile-icon-box {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    background: rgba(43, 36, 80, 0.7);
    border: 1px solid rgba(122, 107, 174, 0.3);
    color: var(--theme-primary-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }

  .library-tile-card:hover .tile-icon-box {
    background: var(--accent-gradient);
    color: #050505;
    box-shadow: 0 0 16px rgba(149, 255, 80, 0.4);
  }

  .tile-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .tile-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tile-kind {
    font-size: 0.72rem;
    color: var(--theme-type-muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 2px;
  }

  .library-view {
    padding: 28px 36px 64px;
    max-width: 1440px;
    margin: 0 auto;
    width: 100%;
  }

  .view-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-bottom: 24px;
    gap: 16px;
    flex-wrap: wrap;
  }

  .view-title-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Breadcrumbs Navigation */
  .breadcrumbs-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }

  .back-folder-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: var(--radius-full);
    background: rgba(30, 23, 40, 0.7);
    border: 1px solid rgba(122, 107, 174, 0.25);
    color: var(--theme-primary-accent);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .back-folder-btn:hover {
    background: rgba(44, 34, 60, 0.9);
    border-color: var(--theme-primary-accent);
    color: #fff;
  }

  .crumbs-trail {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.82rem;
    flex-wrap: wrap;
  }

  :global(.crumb-sep) {
    color: var(--text-muted);
  }

  .crumb-link {
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.82rem;
    font-weight: 500;
    padding: 2px 6px;
  }

  .crumb-link:hover {
    color: var(--theme-primary-accent);
    text-decoration: underline;
  }

  .crumb-current {
    color: #ffffff;
    font-weight: 700;
    font-size: 0.82rem;
  }

  .view-title {
    font-size: 2rem;
    font-weight: 800;
    color: #fff;
    letter-spacing: -0.02em;
  }

  .view-subtitle {
    font-size: 0.85rem;
    color: var(--theme-type-muted);
    margin-top: 3px;
  }

  .batch-cast-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .batch-btn {
    padding: 9px 16px;
    font-size: 0.88rem;
  }

  .genre-filter-bar {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
    scrollbar-width: none;
  }

  .genre-chip {
    padding: 6px 14px;
    border-radius: var(--radius-full);
    background: rgba(30, 23, 40, 0.65);
    border: 1px solid rgba(122, 107, 174, 0.25);
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-weight: 500;
    white-space: nowrap;
    transition: all 0.2s ease;
  }

  .genre-chip:hover {
    background: rgba(44, 34, 60, 0.85);
    color: #fff;
    border-color: var(--theme-pill-highlight);
  }

  .genre-chip.active {
    background: var(--theme-primary-accent);
    border-color: var(--theme-primary-accent);
    color: #050505;
    font-weight: 700;
    box-shadow: 0 0 14px rgba(149, 255, 80, 0.35);
  }

  .media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
    gap: 24px 18px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 80px 20px;
    color: var(--text-muted);
    gap: 12px;
  }

  :global(.empty-icon) {
    opacity: 0.5;
    color: var(--theme-primary-accent);
  }

  .empty-sub {
    font-size: 0.82rem;
    color: var(--theme-type-muted);
  }

  @media (max-width: 768px) {
    .my-media-section {
      padding: 12px 14px 4px;
    }
    .library-tiles-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .library-tile-card {
      padding: 12px;
      gap: 10px;
    }
    .tile-icon-box {
      width: 38px;
      height: 38px;
    }
    .tile-title {
      font-size: 0.86rem;
    }
    .library-view {
      padding: 16px 14px 28px;
    }
    .view-header {
      margin-bottom: 16px;
      gap: 12px;
    }
    .view-title {
      font-size: 1.45rem;
    }
    .media-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px 10px;
    }
    .batch-cast-actions {
      width: 100%;
    }
    .batch-cast-actions button {
      flex: 1;
    }
  }

  @media (min-width: 480px) and (max-width: 768px) {
    .media-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px 12px;
    }
  }
</style>
