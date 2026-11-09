<script lang="ts">
  import ErrorNotice from '../lib/ErrorNotice.svelte';
  import Loading from '../lib/Loading.svelte';
  import PlaylistCard from '../lib/PlaylistCard.svelte';
  import VideoCard from '../lib/VideoCard.svelte';
  import { navigate } from '../lib/router.ts';
  import { app } from '../lib/state.svelte.ts';
  import type { PlaylistSummary, VideoSummary } from '../lib/types';

  const resume = $derived(app.progress.continueWatching(24));
  let history = $state<VideoSummary[]>([]);
  let playlists = $state<PlaylistSummary[]>([]);
  let channels = $state<{ author: string; authorId: string }[]>([]);
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
    Promise.all([
      api.history(1, controller.signal).catch(() => [] as string[]),
      api.playlists(controller.signal).catch(() => [] as PlaylistSummary[]),
      api.subscriptions(controller.signal).catch(() => [])
    ]).then(async ([ids, lists, subs]) => {
      playlists = lists;
      channels = [...subs].sort((a, b) => a.author.localeCompare(b.author));
      // History is a list of ids; show the most recent ones with details.
      const details = await Promise.all(ids.slice(0, 12).map((id) => api.video(id, controller.signal).catch(() => null)));
      if (!controller.signal.aborted) history = details.filter((video): video is NonNullable<typeof video> => !!video);
    }).catch((reason) => {
      if (!controller.signal.aborted) error = reason.message;
    }).finally(() => {
      if (!controller.signal.aborted) loading = false;
    });
    return () => controller.abort();
  });
</script>

<div class="page">
  <h1 class="page-title">Library</h1>
  <p class="page-sub">{app.signedIn ? 'Your Invidious account and this device’s watch progress.' : 'Watch progress on this device.'}</p>

  <section class="section">
    <div class="section-head"><h2>Continue watching</h2></div>
    {#if resume.length}
      <div class="row">{#each resume as video (video.videoId)}<VideoCard {video} progress={video.progress} />{/each}</div>
    {:else}
      <div class="empty">Videos you start appear here.</div>
    {/if}
  </section>

  {#if !app.signedIn}
    <div class="notice">
      Sign in to your Invidious account to see your history, playlists and subscriptions here.
      <div><button class="btn primary small" onclick={() => navigate({ kind: 'tab', tab: 'settings' })}>Go to sign in</button></div>
    </div>
  {:else if loading && !history.length && !playlists.length}
    <Loading />
  {:else if error}
    <ErrorNotice message={error} retry={() => attempt++} />
  {:else}
    <section class="section">
      <div class="section-head"><h2>History</h2></div>
      {#if history.length}
        <div class="row">{#each history as video (video.videoId)}<VideoCard {video} />{/each}</div>
      {:else}<div class="empty">No watch history on your account.</div>{/if}
    </section>
    <section class="section">
      <div class="section-head"><h2>Playlists</h2></div>
      {#if playlists.length}
        <div class="grid">{#each playlists as playlist (playlist.playlistId)}<PlaylistCard {playlist} />{/each}</div>
      {:else}<div class="empty">You have no playlists.</div>{/if}
    </section>
    <section class="section">
      <div class="section-head"><h2>Subscribed channels</h2></div>
      {#if channels.length}
        <div class="actions">
          {#each channels as channel (channel.authorId)}
            <button class="btn small" onclick={() => navigate({ kind: 'channel', id: channel.authorId })}>{channel.author}</button>
          {/each}
        </div>
      {:else}<div class="empty">You aren’t subscribed to any channels.</div>{/if}
    </section>
  {/if}
</div>
