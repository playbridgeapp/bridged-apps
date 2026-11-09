<script lang="ts">
  import ErrorNotice from '../lib/ErrorNotice.svelte';
  import Loading from '../lib/Loading.svelte';
  import VideoCard from '../lib/VideoCard.svelte';
  import { navigate } from '../lib/router.ts';
  import { app } from '../lib/state.svelte.ts';
  import type { VideoSummary } from '../lib/types';

  let videos = $state<VideoSummary[]>([]);
  let loading = $state(false);
  let error = $state('');
  let attempt = $state(0);

  $effect(() => {
    void attempt;
    if (!app.signedIn) return;
    const api = app.api;
    const controller = new AbortController();
    loading = true;
    error = '';
    api.feed(controller.signal)
      .then((feed) => {
        const seen = new Set<string>();
        videos = [...feed.notifications, ...feed.videos].filter((video) => !seen.has(video.videoId) && seen.add(video.videoId));
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        if (reason.status === 403) app.expireToken();
        error = reason.message;
      })
      .finally(() => { if (!controller.signal.aborted) loading = false; });
    return () => controller.abort();
  });
</script>

<div class="page">
  <h1 class="page-title">Subscriptions</h1>
  {#if !app.signedIn}
    <p class="page-sub">New videos from the channels you follow on your Invidious account.</p>
    <div class="notice">
      Sign in to your Invidious account to see your subscriptions here.
      <div><button class="btn primary small" onclick={() => navigate({ kind: 'tab', tab: 'settings' })}>Go to sign in</button></div>
    </div>
  {:else}
    <p class="page-sub">Latest from the channels you follow.</p>
    {#if loading && !videos.length}
      <Loading />
    {:else if error}
      <ErrorNotice message={error} retry={() => attempt++} />
    {:else if !videos.length}
      <div class="empty">No new videos. Subscribe to channels to fill this page.</div>
    {:else}
      <div class="grid">{#each videos as video (video.videoId)}<VideoCard {video} />{/each}</div>
    {/if}
  {/if}
</div>
