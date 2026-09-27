<script lang="ts">
  import {
    activeTab,
    serverConfig,
    savedAccounts,
    userViews,
    searchQuery,
    isServerModalOpen,
    isDiagnosticsOpen,
    loadDemoMode,
    logout,
    refreshServerLibrary,
    switchAccount,
    removeSavedAccount,
    clearAppCache
  } from '../stores/appState';
  import { bridgeStatus } from '../cast/playbridge';
  import {
    Tv,
    Search,
    Server,
    Activity,
    Radio,
    Film,
    Clapperboard,
    Sparkles,
    User,
    Check,
    LogOut,
    RefreshCw,
    Folder,
    Home,
    Music,
    Cast,
    X,
    Plus,
    Trash2,
    Layers,
    ChevronDown,
    RotateCcw
  } from 'lucide-svelte';

  let showProfileMenu = false;
  let showMoreViewsMenu = false;
  let showMobileSearch = false;

  $: currentServerId = $serverConfig.url ? `${$serverConfig.url}_${$serverConfig.userId}` : '';

  // Segregate views so navbar never stretches out of control
  $: musicViews = $userViews.filter((v) => v.CollectionType === 'music');
  $: otherFolderViews = $userViews.filter(
    (v) => v.CollectionType !== 'movies' && v.CollectionType !== 'tvshows' && v.CollectionType !== 'music'
  );

  function toggleProfileMenu() {
    showProfileMenu = !showProfileMenu;
    showMoreViewsMenu = false;
  }

  function closeProfileMenu() {
    showProfileMenu = false;
  }

  function toggleMobileSearch() {
    showMobileSearch = !showMobileSearch;
    if (showMobileSearch) {
      $activeTab = 'search';
    }
  }

  function handleRefresh() {
    refreshServerLibrary($serverConfig);
    closeProfileMenu();
  }

  function handleLogout() {
    logout();
    closeProfileMenu();
  }

  function handleSwitch(acc: any) {
    switchAccount(acc);
    closeProfileMenu();
  }

  function handleRemoveAccount(id: string) {
    removeSavedAccount(id);
  }
</script>

<!-- Top Navbar -->
<header class="navbar glass-header">
  {#if showMobileSearch}
    <!-- Expanded Mobile Search Bar -->
    <div class="mobile-search-bar">
      <Search size={18} class="search-bar-icon" />
      <input
        type="text"
        placeholder="Search movies, shows, music..."
        bind:value={$searchQuery}
        autofocus
        on:input={() => {
          if ($activeTab !== 'search') $activeTab = 'search';
        }}
      />
      {#if $searchQuery}
        <button class="clear-search-btn" on:click={() => ($searchQuery = '')}>
          <X size={16} />
        </button>
      {/if}
      <button class="close-search-btn" on:click={() => (showMobileSearch = false)}>
        Done
      </button>
    </div>
  {:else}
    <div class="nav-left">
      <!-- Brand Logo with Cinejoy Neon Accent -->
      <div class="brand" on:click={() => ($activeTab = 'home')}>
        <div class="logo-icon">
          <svg viewBox="0 0 100 100" fill="none" class="brand-svg">
            <path d="M50 16 L84 76 L66 76 L50 46 L34 76 L16 76 Z" fill="url(#brand-cine-grad)"/>
            <defs>
              <linearGradient id="brand-cine-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#95FF50"/>
                <stop offset="100%" stop-color="#43861E"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div class="brand-text">
          <span class="brand-name">PlayBridge</span>
          <span class="brand-sub">Jellyfin Cast</span>
        </div>
      </div>

      <!-- Desktop Navigation Tabs (Cinejoy Floating Pill Design) -->
      <nav class="nav-links desktop-only">
        <button
          class="nav-link"
          class:active={$activeTab === 'home'}
          on:click={() => ($activeTab = 'home')}
        >
          <Home size={15} />
          <span>Home</span>
        </button>

        <button
          class="nav-link"
          class:active={$activeTab === 'movies'}
          on:click={() => ($activeTab = 'movies')}
        >
          <Film size={15} />
          <span>Movies</span>
        </button>

        <button
          class="nav-link"
          class:active={$activeTab === 'shows'}
          on:click={() => ($activeTab = 'shows')}
        >
          <Clapperboard size={15} />
          <span>Shows</span>
        </button>

        <!-- Dynamic Music Views -->
        {#each musicViews as mView (mView.Id)}
          <button
            class="nav-link"
            class:active={$activeTab === mView.Id}
            on:click={() => ($activeTab = mView.Id)}
          >
            <Music size={15} />
            <span>{mView.Name}</span>
          </button>
        {/each}

        <!-- Other Folder Views Dropdown -->
        {#if otherFolderViews.length > 0}
          <div class="more-views-container">
            <button
              class="nav-link more-btn"
              class:active={otherFolderViews.some((v) => $activeTab === v.Id)}
              on:click={() => (showMoreViewsMenu = !showMoreViewsMenu)}
            >
              <Folder size={15} />
              <span>Libraries</span>
              <ChevronDown size={13} />
            </button>

            {#if showMoreViewsMenu}
              <div class="more-views-dropdown glass-menu" on:mouseleave={() => (showMoreViewsMenu = false)}>
                {#each otherFolderViews as view (view.Id)}
                  <button
                    class="dropdown-item"
                    class:active-item={$activeTab === view.Id}
                    on:click={() => {
                      $activeTab = view.Id;
                      showMoreViewsMenu = false;
                    }}
                  >
                    <Folder size={14} />
                    <span>{view.Name}</span>
                    {#if $activeTab === view.Id}
                      <Check size={14} class="check-icon" />
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <button
          class="nav-link"
          class:active={$activeTab === 'favorites'}
          on:click={() => ($activeTab = 'favorites')}
        >
          <Sparkles size={15} />
          <span>Favorites</span>
        </button>
      </nav>
    </div>

    <!-- Right Controls -->
    <div class="nav-right">
      <!-- Desktop Search Bar -->
      <div class="search-box desktop-only">
        <Search size={16} class="search-icon" />
        <input
          type="text"
          placeholder="Search movies, shows..."
          bind:value={$searchQuery}
          on:input={() => {
            if ($searchQuery.trim().length > 0 && $activeTab !== 'search') {
              $activeTab = 'search';
            }
          }}
        />
        {#if $searchQuery}
          <button class="clear-search" on:click={() => ($searchQuery = '')}>&times;</button>
        {/if}
      </div>

      <!-- Mobile Search Toggle Icon -->
      <button
        class="btn-icon mobile-only"
        on:click={toggleMobileSearch}
        title="Search"
      >
        <Search size={18} />
      </button>

      <!-- PlayBridge Cast Status Icon Pill -->
      <button
        class="cast-icon-pill"
        class:cast-active={$bridgeStatus.available}
        on:click={() => ($isDiagnosticsOpen = true)}
        title={$bridgeStatus.available
          ? 'PlayBridge Receiver Active'
          : 'PlayBridge Receiver not detected'}
      >
        <Cast size={16} class="cast-symbol" />
        {#if $bridgeStatus.available}
          <span class="pulsing-dot-inline"></span>
        {/if}
      </button>

      <!-- Diagnostics Drawer Toggle -->
      <button
        class="btn-icon"
        on:click={() => ($isDiagnosticsOpen = !$isDiagnosticsOpen)}
        title="PlayBridge Diagnostics & Event Inspector"
      >
        <Activity size={18} />
      </button>

      <!-- Multi-Server & Multi-User Profile Menu -->
      <div class="profile-container">
        <button class="profile-btn" on:click={toggleProfileMenu}>
          <div class="avatar">
            <User size={14} />
          </div>
          <span class="server-badge desktop-only">
            {$serverConfig.username || 'User'}
          </span>
        </button>

        {#if showProfileMenu}
          <div class="profile-dropdown glass-menu" on:mouseleave={closeProfileMenu}>
            <!-- Active Server / User Banner -->
            <div class="dropdown-header">
              <div class="active-badge-tag">CONNECTED SERVER</div>
              <p class="user-title">{$serverConfig.username || 'Guest'}</p>
              <p class="server-subtitle">{$serverConfig.serverName || 'Jellyfin Server'}</p>
              {#if $serverConfig.url}
                <p class="server-url-sub">{$serverConfig.url}</p>
              {/if}
            </div>

            <!-- Multi-Server / Multi-User Switcher List -->
            {#if $savedAccounts.length > 1}
              <div class="dropdown-divider"></div>
              <div class="section-label">SWITCH SERVER / USER</div>
              <div class="saved-accounts-list">
                {#each $savedAccounts as acc (acc.id)}
                  {#if acc.id !== currentServerId}
                    <div class="account-item-row">
                      <button class="account-switch-btn" on:click={() => handleSwitch(acc)}>
                        <div class="account-avatar-sm">
                          {acc.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div class="account-meta">
                          <span class="account-user">{acc.username}</span>
                          <span class="account-server">{acc.serverName}</span>
                        </div>
                      </button>
                      <button
                        class="account-del-btn"
                        on:click|stopPropagation={() => handleRemoveAccount(acc.id)}
                        title="Remove profile"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}

            <div class="dropdown-divider"></div>

            {#if !$serverConfig.isDemo}
              <button class="dropdown-item" on:click={handleRefresh}>
                <RefreshCw size={15} />
                <span>Refresh Library</span>
              </button>
            {/if}

            <button
              class="dropdown-item"
              on:click={() => {
                $isServerModalOpen = true;
                closeProfileMenu();
              }}
            >
              <Plus size={15} />
              <span>Add Server or User</span>
            </button>

            <button
              class="dropdown-item"
              on:click={() => {
                loadDemoMode();
                closeProfileMenu();
              }}
            >
              <Sparkles size={15} />
              <span>Explore Demo Library</span>
              {#if $serverConfig.isDemo}
                <Check size={15} class="check-icon" />
              {/if}
            </button>

            <button
              class="dropdown-item"
              on:click={() => {
                clearAppCache(false);
                closeProfileMenu();
              }}
            >
              <RotateCcw size={15} />
              <span>Clear Cache & Re-sync</span>
            </button>

            <button
              class="dropdown-item"
              on:click={() => {
                $isDiagnosticsOpen = true;
                closeProfileMenu();
              }}
            >
              <Activity size={15} />
              <span>Diagnostics Log</span>
            </button>

            <div class="dropdown-divider"></div>

            <button class="dropdown-item logout-item" on:click={handleLogout}>
              <LogOut size={15} />
              <span>Sign Out</span>
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</header>

<!-- Cinejoy Style Mobile Bottom Floating Pill Dock -->
<nav class="mobile-bottom-nav mobile-only glass-header">
  <button
    class="bottom-nav-item"
    class:active={$activeTab === 'home'}
    on:click={() => ($activeTab = 'home')}
  >
    <Home size={19} />
    <span>Home</span>
  </button>

  <button
    class="bottom-nav-item"
    class:active={$activeTab === 'movies'}
    on:click={() => ($activeTab = 'movies')}
  >
    <Film size={19} />
    <span>Movies</span>
  </button>

  <button
    class="bottom-nav-item"
    class:active={$activeTab === 'shows'}
    on:click={() => ($activeTab = 'shows')}
  >
    <Clapperboard size={19} />
    <span>Shows</span>
  </button>

  <!-- If Music library exists, add direct tab -->
  {#if musicViews.length > 0}
    <button
      class="bottom-nav-item"
      class:active={$activeTab === musicViews[0].Id}
      on:click={() => ($activeTab = musicViews[0].Id)}
    >
      <Music size={19} />
      <span>Music</span>
    </button>
  {/if}

  <button
    class="bottom-nav-item"
    class:active={$activeTab === 'favorites'}
    on:click={() => ($activeTab = 'favorites')}
  >
    <Sparkles size={19} />
    <span>Favs</span>
  </button>

  <button
    class="bottom-nav-item"
    class:active={$activeTab === 'search'}
    on:click={() => {
      $activeTab = 'search';
      showMobileSearch = true;
    }}
  >
    <Search size={19} />
    <span>Search</span>
  </button>
</nav>

<style>
  .navbar {
    position: sticky;
    top: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 28px;
    height: 68px;
    border-bottom: 1px solid rgba(122, 107, 174, 0.2);
    gap: 16px;
  }

  .nav-left {
    display: flex;
    align-items: center;
    gap: 24px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }

  .logo-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 0 10px rgba(149, 255, 80, 0.45));
  }

  .brand-svg {
    width: 100%;
    height: 100%;
  }

  .brand-text {
    display: flex;
    flex-direction: column;
  }

  .brand-name {
    font-size: 1.1rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #ffffff;
    line-height: 1.1;
  }

  .brand-sub {
    font-size: 0.65rem;
    color: var(--theme-primary-accent);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .nav-links {
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(30, 23, 40, 0.6);
    padding: 4px;
    border-radius: var(--radius-full);
    border: 1px solid rgba(122, 107, 174, 0.2);
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .nav-links::-webkit-scrollbar {
    display: none;
  }

  .nav-link {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 16px;
    font-size: 0.84rem;
    font-weight: 500;
    color: var(--text-secondary);
    border-radius: var(--radius-full);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .nav-link:hover {
    color: #ffffff;
    background-color: rgba(255, 255, 255, 0.08);
  }

  .nav-link.active {
    color: #050505;
    background: var(--theme-primary-accent);
    font-weight: 700;
    box-shadow: 0 0 16px rgba(149, 255, 80, 0.35);
  }

  .more-views-container {
    position: relative;
  }

  .more-btn {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .more-views-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    width: 210px;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: 6px;
    z-index: 60;
    animation: fadeIn 0.15s ease;
    background: rgba(16, 11, 26, 0.94);
  }

  .nav-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .search-box {
    position: relative;
    display: flex;
    align-items: center;
  }

  :global(.search-icon) {
    position: absolute;
    left: 12px;
    color: var(--theme-type-muted);
    pointer-events: none;
  }

  .search-box input {
    width: 180px;
    height: 38px;
    padding: 0 30px 0 34px;
    font-size: 0.84rem;
    background-color: rgba(30, 23, 40, 0.6);
    border: 1px solid rgba(122, 107, 174, 0.25);
    border-radius: var(--radius-full);
    color: #ffffff;
    transition: all 0.2s ease;
  }

  .search-box input:focus {
    width: 240px;
    outline: none;
    border-color: var(--theme-primary-accent);
    box-shadow: 0 0 14px rgba(149, 255, 80, 0.25);
    background-color: rgba(44, 34, 60, 0.85);
  }

  .clear-search {
    position: absolute;
    right: 10px;
    color: var(--text-muted);
    font-size: 1.1rem;
    line-height: 1;
    padding: 2px;
  }

  .btn-icon {
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: var(--text-secondary);
    background: rgba(30, 23, 40, 0.6);
    border: 1px solid rgba(122, 107, 174, 0.2);
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .btn-icon:hover {
    color: #ffffff;
    background-color: rgba(60, 47, 82, 0.8);
    border-color: var(--theme-pill-highlight);
    transform: translateY(-1px);
  }

  /* Cinejoy Cast Icon Button */
  .cast-icon-pill {
    position: relative;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(30, 23, 40, 0.6);
    border: 1px solid rgba(122, 107, 174, 0.25);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .cast-icon-pill:hover {
    color: #fff;
    border-color: var(--theme-primary-accent);
    transform: translateY(-1px);
  }

  .cast-icon-pill.cast-active {
    color: #050505;
    background: var(--theme-primary-accent);
    border-color: var(--theme-primary-accent);
    box-shadow: 0 0 16px rgba(149, 255, 80, 0.4);
  }

  .pulsing-dot-inline {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: #ffffff;
    box-shadow: 0 0 8px #ffffff;
    animation: pulse 1.8s infinite;
  }

  @keyframes pulse {
    0% { transform: scale(0.9); opacity: 0.8; }
    50% { transform: scale(1.3); opacity: 1; }
    100% { transform: scale(0.9); opacity: 0.8; }
  }

  .profile-container {
    position: relative;
    flex-shrink: 0;
  }

  .profile-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 4px 4px;
    border-radius: var(--radius-full);
    background-color: rgba(30, 23, 40, 0.6);
    border: 1px solid rgba(122, 107, 174, 0.25);
    transition: all 0.15s ease;
  }

  .profile-btn:hover {
    background-color: rgba(44, 34, 60, 0.85);
    border-color: var(--theme-pill-highlight);
    transform: translateY(-1px);
  }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent-gradient);
    color: #050505;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 800;
  }

  .server-badge {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .profile-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 260px;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 8px;
    z-index: 60;
    animation: fadeIn 0.15s ease;
    background: rgba(16, 11, 26, 0.94);
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .dropdown-header {
    padding: 10px 12px;
  }

  .active-badge-tag {
    font-size: 0.65rem;
    font-weight: 800;
    color: var(--theme-primary-accent);
    letter-spacing: 0.06em;
    margin-bottom: 4px;
  }

  .user-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: #ffffff;
  }

  .server-subtitle {
    font-size: 0.78rem;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .server-url-sub {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
    word-break: break-all;
    margin-top: 2px;
  }

  .section-label {
    font-size: 0.66rem;
    font-weight: 700;
    color: var(--text-muted);
    letter-spacing: 0.05em;
    padding: 6px 12px 2px;
  }

  .saved-accounts-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 4px 0;
  }

  .account-item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
  }

  .account-item-row:hover {
    background-color: rgba(255, 255, 255, 0.06);
  }

  .account-switch-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    text-align: left;
    min-width: 0;
  }

  .account-avatar-sm {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--accent-gradient);
    color: #050505;
    font-size: 0.65rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .account-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .account-user {
    font-size: 0.8rem;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-server {
    font-size: 0.68rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-del-btn {
    padding: 4px;
    color: var(--text-muted);
    border-radius: 4px;
  }

  .account-del-btn:hover {
    color: var(--status-error);
    background-color: rgba(248, 81, 73, 0.15);
  }

  .dropdown-divider {
    height: 1px;
    background-color: var(--border);
    margin: 6px 0;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: all 0.15s ease;
  }

  .dropdown-item:hover {
    color: #ffffff;
    background-color: rgba(255, 255, 255, 0.08);
  }

  .dropdown-item.active-item {
    color: var(--theme-primary-accent);
    font-weight: 600;
  }

  :global(.check-icon) {
    margin-left: auto;
    color: var(--theme-primary-accent);
  }

  .logout-item:hover {
    color: var(--status-error);
    background-color: rgba(235, 87, 87, 0.15);
  }

  /* Mobile Search Bar */
  .mobile-search-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 100%;
  }

  :global(.search-bar-icon) {
    color: var(--text-muted);
  }

  .mobile-search-bar input {
    flex: 1;
    height: 40px;
    background: rgba(30, 23, 40, 0.8);
    border: 1px solid rgba(122, 107, 174, 0.3);
    border-radius: var(--radius-full);
    padding: 0 16px;
    color: #fff;
    font-size: 0.9rem;
  }

  .clear-search-btn {
    padding: 6px;
    color: var(--text-muted);
  }

  .close-search-btn {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--theme-primary-accent);
    padding: 6px 10px;
  }

  /* Cinejoy Mobile Floating Dock */
  .mobile-bottom-nav {
    position: fixed !important;
    top: auto !important;
    bottom: max(16px, env(safe-area-inset-bottom, 16px)) !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    width: calc(100% - 32px);
    max-width: 440px;
    height: 60px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 0 8px;
    z-index: 90;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.8);
  }

  .bottom-nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    flex: 1;
    height: 44px;
    color: var(--text-muted);
    font-size: 0.65rem;
    font-weight: 600;
    border-radius: var(--radius-full);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .bottom-nav-item.active {
    color: #050505;
    background: var(--theme-primary-accent);
    box-shadow: 0 0 14px rgba(149, 255, 80, 0.35);
  }

  /* Responsive Rules */
  .desktop-only {
    display: flex;
  }
  .mobile-only {
    display: none;
  }

  @media (max-width: 768px) {
    .desktop-only {
      display: none !important;
    }
    .mobile-only {
      display: flex !important;
    }
    .navbar {
      padding: 0 16px;
      height: 60px;
    }
  }
</style>
