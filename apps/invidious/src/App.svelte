<script lang="ts">
  import { Cast, Home, Library as LibraryIcon, Rss, Search as SearchIcon, Settings as SettingsIcon, Smartphone, X } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { tokenFromCallback, TOKEN_STORAGE_KEY } from './lib/auth.ts';
  import { bridgeErrorMessage, destinationsSupported } from './lib/bridge.ts';
  import { linkTarget, navigate, parseRoute, type Route, type Tab } from './lib/router.ts';
  import { app } from './lib/state.svelte.ts';
  import Channel from './views/Channel.svelte';
  import HomeView from './views/Home.svelte';
  import Library from './views/Library.svelte';
  import Playlist from './views/Playlist.svelte';
  import Search from './views/Search.svelte';
  import Settings from './views/Settings.svelte';
  import Setup from './views/Setup.svelte';
  import Subscriptions from './views/Subscriptions.svelte';
  import Watch from './views/Watch.svelte';

  const initialRoute = parseRoute(location.hash);
  let route = $state<Route>(initialRoute);
  let query = $state(initialRoute.kind === 'search' ? initialRoute.query : '');
  let callbackNotice = $state('');
  const bridge = destinationsSupported();
  const activeTab = $derived<Tab | null>(route.kind === 'tab' ? route.tab : null);
  const tabs: { tab: Tab; label: string; icon: typeof Home }[] = [
    { tab: 'home', label: 'Home', icon: Home },
    { tab: 'subscriptions', label: 'Subscriptions', icon: Rss },
    { tab: 'library', label: 'Library', icon: LibraryIcon },
    { tab: 'settings', label: 'Settings', icon: SettingsIcon }
  ];

  const titles: Record<Tab, string> = { home: 'Home', subscriptions: 'Subscriptions', library: 'Library', settings: 'Settings' };

  onMount(() => {
    // The instance returns here with ?token=… after sign-in.
    const token = tokenFromCallback(location.search);
    if (location.search) history.replaceState(history.state, '', `${location.pathname}${location.hash || '#/'}`);
    if (token && app.instance) {
      if (app.acceptToken(token)) {
        callbackNotice = 'Signed in. If you started from the PlayBridge app, go back to it; it picks up the sign-in by itself.';
        navigate({ kind: 'tab', tab: 'subscriptions' });
      } else {
        app.showToast('The instance sent a sign-in this app couldn’t read. Try again.');
      }
    }

    const onHash = () => {
      route = parseRoute(location.hash);
      if (route.kind === 'search') query = route.query;
      if (route.kind === 'tab') document.title = titles[route.tab];
      window.scrollTo({ top: 0 });
    };
    const onStorage = (event: StorageEvent) => { if (event.key === TOKEN_STORAGE_KEY) app.reloadToken(); };
    const onVisible = () => { if (document.visibilityState === 'visible') { app.reloadToken(); void app.refreshDestination(); } };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    void app.refreshDestination();
    if (route.kind === 'tab') document.title = titles[route.tab];
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  });

  async function submitSearch(event: SubmitEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    // A pasted YouTube or Invidious link opens its page instead of searching for it.
    const link = linkTarget(value);
    if (!link) { navigate({ kind: 'search', query: value }); return; }
    query = '';
    if ('route' in link) { navigate(link.route); return; }
    try { navigate({ kind: 'channel', id: await app.api.resolveChannel(link.resolve) }); }
    catch (error) { app.showToast((error as Error).message); }
  }

  async function changeDestination() {
    try { await app.pickDestination(); }
    catch (error) { app.showToast(bridgeErrorMessage(error)); }
  }
</script>

{#if !app.instance}
  <Setup />
{:else}
  <div class="shell">
    <header class="topbar">
      <button class="brand" onclick={() => navigate({ kind: 'tab', tab: 'home' })} aria-label="Home">
        <img src="/bridged-invidious.svg" alt="" />
      </button>
      <nav class="tabs">
        {#each tabs as item (item.tab)}
          <button class:active={activeTab === item.tab} onclick={() => navigate({ kind: 'tab', tab: item.tab })}>{item.label}</button>
        {/each}
      </nav>
      <form class="search-box" role="search" onsubmit={submitSearch}>
        <SearchIcon size={18} />
        <input bind:value={query} placeholder="Search or paste a link" aria-label="Search or paste a YouTube link" enterkeyhint="search" />
        {#if query}<button type="button" aria-label="Clear search" onclick={() => (query = '')}><X size={16} /></button>{/if}
      </form>
      {#if bridge}
        <button class="destination-chip" class:remote={app.destination?.kind && app.destination.kind !== 'local'} onclick={changeDestination} title="Choose where videos play">
          {#if app.destination?.kind && app.destination.kind !== 'local'}<Cast size={16} />{:else}<Smartphone size={16} />{/if}
          <span>{app.destination?.kind === 'local' ? 'This phone' : app.destination?.name || 'Choose device'}</span>
        </button>
      {/if}
    </header>

    {#if callbackNotice}
      <div class="page" style="padding-bottom:0"><div class="notice">{callbackNotice}</div></div>
    {/if}

    <main>
      {#if route.kind === 'watch'}
        {#key route.id + (route.list || '')}<Watch id={route.id} list={route.list} />{/key}
      {:else if route.kind === 'search'}
        <Search query={route.query} />
      {:else if route.kind === 'channel'}
        {#key route.id}<Channel id={route.id} />{/key}
      {:else if route.kind === 'playlist'}
        {#key route.id}<Playlist id={route.id} />{/key}
      {:else if route.tab === 'subscriptions'}
        <Subscriptions />
      {:else if route.tab === 'library'}
        <Library />
      {:else if route.tab === 'settings'}
        <Settings />
      {:else}
        <HomeView />
      {/if}
    </main>

    <nav class="mobile-nav">
      {#each tabs as item (item.tab)}
        <button class:active={activeTab === item.tab} onclick={() => navigate({ kind: 'tab', tab: item.tab })}>
          <item.icon size={21} />{item.label}
        </button>
      {/each}
    </nav>
  </div>
{/if}

{#if app.toast}
  <div class="toast" role="status">{app.toast}<button onclick={() => (app.toast = '')}>OK</button></div>
{/if}
