<script lang="ts">
  import { Play } from 'lucide-svelte';
  import ErrorNotice from '../lib/ErrorNotice.svelte';
  import Loading from '../lib/Loading.svelte';
  import VideoCard from '../lib/VideoCard.svelte';
  import { navigate } from '../lib/router.ts';
  import { app } from '../lib/state.svelte.ts';
  import { PlaylistPager } from '../lib/playback.ts';
  import type { PlaylistDetails, VideoSummary } from '../lib/types';

  let { id }: { id: string } = $props();
  let playlist = $state<PlaylistDetails | null>(null);
  let pager: PlaylistPager | null = null;
  let videos = $state<(VideoSummary & { index?: number })[]>([]);
  let done = $state(true);
  let loadingMore = $state(false);
  let moreError = $state('');
  let sentinel = $state<HTMLElement | null>(null);
  let loading = $state(true);
  let error = $state('');
  let attempt = $state(0);

  $effect(() => {
    void attempt;
    const api = app.api, playlistId = id;
    const controller = new AbortController();
    loading = true;
    error = '';
    pager = null;
    videos = [];
    api.playlist(playlistId, 1, controller.signal)
      .then((details) => {
        playlist = details;
        pager = new PlaylistPager((page) => api.playlist(playlistId, page), details);
        videos = pager.videos;
        done = pager.done;
        document.title = details.title;
      })
      .catch((reason) => { if (!controller.signal.aborted) error = reason.message; })
      .finally(() => { if (!controller.signal.aborted) loading = false; });
    return () => controller.abort();
  });

  async function more() {
    const current = pager;
    if (!current || current.done || loadingMore) return;
    loadingMore = true;
    moreError = '';
    try {
      await current.more();
      if (pager !== current) return;
      videos = current.videos;
      done = current.done;
    } catch (reason) {
      if (pager === current) moreError = (reason as Error).message;
    } finally {
      loadingMore = false;
    }
  }

  // Load the next page as the end of the list scrolls into view.
  $effect(() => {
    const target = sentinel;
    if (!target || done) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !moreError) void more();
    }, { rootMargin: '800px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  });
</script>

<div class="page">
  {#if loading && !playlist}
    <Loading />
  {:else if error}
    <ErrorNotice message={error} retry={() => attempt++} />
  {:else if playlist}
    <h1 class="page-title">{playlist.title}</h1>
    <p class="page-sub">{playlist.author} · {playlist.videoCount} videos</p>
    {#if videos.length}
      <div style="margin-bottom:24px">
        <button class="btn primary" onclick={() => navigate({ kind: 'watch', id: videos[0].videoId, list: id })}>
          <Play size={16} fill="currentColor" />Play all
        </button>
      </div>
      <div class="grid">
        {#each videos as video, index (video.videoId + (video.index ?? index))}<VideoCard {video} list={id} />{/each}
      </div>
      {#if !done}
        <div bind:this={sentinel} style="display:flex;justify-content:center;margin-top:28px">
          {#if moreError}<ErrorNotice message={moreError} retry={more} />
          {:else}<Loading label="Loading more videos…" />{/if}
        </div>
      {/if}
    {:else}
      <div class="empty">This playlist is empty.</div>
    {/if}
  {/if}
</div>
