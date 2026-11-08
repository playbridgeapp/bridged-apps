<script lang="ts">
  import ErrorNotice from '../lib/ErrorNotice.svelte';
  import Loading from '../lib/Loading.svelte';
  import VideoCard from '../lib/VideoCard.svelte';
  import { app } from '../lib/state.svelte.ts';
  import type { VideoSummary } from '../lib/types';

  let trending = $state<VideoSummary[]>([]);
  let loading = $state(true);
  let error = $state('');
  let attempt = $state(0);
  const resume = $derived(app.progress.continueWatching(12));

  $effect(() => {
    void attempt;
    const api = app.api;
    const controller = new AbortController();
    loading = true;
    error = '';
    api.trending(controller.signal)
      .then((videos) => { trending = videos.filter((video) => video.type !== undefined ? video.type === 'video' : true); })
      .catch((reason) => { if (!controller.signal.aborted) error = reason.message; })
      .finally(() => { if (!controller.signal.aborted) loading = false; });
    return () => controller.abort();
  });
</script>

<div class="page">
  {#if resume.length}
    <section class="section">
      <div class="section-head"><h2>Continue watching</h2></div>
      <div class="row">
        {#each resume as video (video.videoId)}<VideoCard {video} progress={video.progress} />{/each}
      </div>
    </section>
  {/if}
  <section class="section">
    <div class="section-head"><h2>Trending</h2></div>
    {#if loading && !trending.length}
      <Loading />
    {:else if error}
      <ErrorNotice message={error} retry={() => attempt++} />
    {:else if !trending.length}
      <div class="empty">Nothing is trending on this instance right now.</div>
    {:else}
      <div class="grid">
        {#each trending as video (video.videoId)}<VideoCard {video} />{/each}
      </div>
    {/if}
  </section>
</div>
