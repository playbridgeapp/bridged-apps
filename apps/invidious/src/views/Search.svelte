<script lang="ts">
  import ChannelCard from '../lib/ChannelCard.svelte';
  import ErrorNotice from '../lib/ErrorNotice.svelte';
  import Loading from '../lib/Loading.svelte';
  import PlaylistCard from '../lib/PlaylistCard.svelte';
  import VideoCard from '../lib/VideoCard.svelte';
  import { app } from '../lib/state.svelte.ts';
  import type { SearchResult } from '../lib/types';

  let { query }: { query: string } = $props();
  let results = $state<SearchResult[]>([]);
  let page = $state(1);
  let loading = $state(false);
  let more = $state(true);
  let error = $state('');
  let generation = 0;

  async function load(reset: boolean) {
    const current = reset ? ++generation : generation;
    const next = reset ? 1 : page + 1;
    loading = true;
    error = '';
    try {
      const batch = await app.api.search(query, next);
      if (current !== generation) return;
      const seen = new Set(reset ? [] : results.map(key));
      const fresh = batch.filter((item) => !seen.has(key(item)));
      results = reset ? fresh : [...results, ...fresh];
      page = next;
      more = fresh.length > 0;
    } catch (reason) {
      if (current === generation) error = (reason as Error).message;
    } finally {
      if (current === generation) loading = false;
    }
  }

  function key(item: SearchResult): string {
    return item.type === 'channel' ? `c:${item.authorId}` : item.type === 'playlist' ? `p:${item.playlistId}` : `v:${item.videoId}`;
  }

  $effect(() => {
    void app.api;
    if (query.trim()) void load(true); else { results = []; more = false; }
  });
</script>

<div class="page">
  <h1 class="page-title">{query ? `Results for “${query}”` : 'Search'}</h1>
  {#if !query}
    <p class="page-sub">Search videos, channels and playlists on your instance.</p>
  {:else if loading && !results.length}
    <Loading label="Searching…" />
  {:else if error && !results.length}
    <ErrorNotice message={error} retry={() => load(true)} />
  {:else if !results.length}
    <div class="empty">No results.</div>
  {:else}
    <div class="grid" style="margin-top:20px">
      {#each results as item (key(item))}
        {#if item.type === 'channel'}<ChannelCard channel={item} />
        {:else if item.type === 'playlist'}<PlaylistCard playlist={item} />
        {:else}<VideoCard video={item} />{/if}
      {/each}
    </div>
    <div style="display:flex;justify-content:center;margin-top:28px">
      {#if error}<ErrorNotice message={error} retry={() => load(false)} />
      {:else if loading}<Loading />
      {:else if more}<button class="btn" onclick={() => load(false)}>Show more</button>{/if}
    </div>
  {/if}
</div>
