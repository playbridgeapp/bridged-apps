<script lang="ts">
  import { Bell, BellOff } from 'lucide-svelte';
  import ErrorNotice from '../lib/ErrorNotice.svelte';
  import Loading from '../lib/Loading.svelte';
  import VideoCard from '../lib/VideoCard.svelte';
  import { avatar, formatCount, imageUrl } from '../lib/instance.ts';
  import { app } from '../lib/state.svelte.ts';
  import type { ChannelDetails, VideoSummary } from '../lib/types';

  let { id }: { id: string } = $props();
  let channel = $state<ChannelDetails | null>(null);
  let videos = $state<VideoSummary[]>([]);
  let continuation = $state<string | undefined>();
  let loading = $state(true);
  let loadingMore = $state(false);
  let error = $state('');
  let attempt = $state(0);
  let subscribing = $state(false);
  const subscribed = $derived(app.subscriptions.has(id));
  const banner = $derived(channel?.authorBanners?.length
    ? imageUrl(app.instance, [...channel.authorBanners].sort((a, b) => (b.width || 0) - (a.width || 0))[0].url) : '');

  $effect(() => {
    void attempt;
    const api = app.api, channelId = id;
    const controller = new AbortController();
    loading = true;
    error = '';
    videos = [];
    Promise.all([api.channel(channelId, controller.signal), api.channelVideos(channelId, undefined, controller.signal)])
      .then(([details, page]) => {
        channel = details;
        videos = page.videos;
        continuation = page.continuation;
        document.title = details.author;
      })
      .catch((reason) => { if (!controller.signal.aborted) error = reason.message; })
      .finally(() => { if (!controller.signal.aborted) loading = false; });
    return () => controller.abort();
  });

  async function more() {
    if (!continuation || loadingMore) return;
    loadingMore = true;
    try {
      const page = await app.api.channelVideos(id, continuation);
      const seen = new Set(videos.map((video) => video.videoId));
      videos = [...videos, ...page.videos.filter((video) => !seen.has(video.videoId))];
      continuation = page.continuation;
    } catch (reason) {
      app.showToast((reason as Error).message);
    } finally {
      loadingMore = false;
    }
  }

  async function toggle() {
    subscribing = true;
    try { await app.setSubscribed(id, !subscribed); }
    catch (reason) { app.showToast((reason as Error).message); }
    finally { subscribing = false; }
  }
</script>

<div class="page">
  {#if loading && !channel}
    <Loading />
  {:else if error}
    <ErrorNotice message={error} retry={() => attempt++} />
  {:else if channel}
    {#if banner}<div class="channel-hero" style:background-image="url('{banner}')"></div>{/if}
    <div class="channel-head">
      {#if avatar(app.instance, channel.authorThumbnails)}
        <img class="avatar" src={avatar(app.instance, channel.authorThumbnails)} alt="" />
      {:else}<span class="avatar">{channel.author.slice(0, 1)}</span>{/if}
      <div>
        <h1>{channel.author}</h1>
        <p>{formatCount(channel.subCount, 'subscriber')}</p>
      </div>
      {#if app.signedIn}
        <button class="btn" class:primary={!subscribed} onclick={toggle} disabled={subscribing}>
          {#if subscribed}<BellOff size={16} />Unsubscribe{:else}<Bell size={16} />Subscribe{/if}
        </button>
      {/if}
    </div>
    <section class="section">
      <div class="section-head"><h2>Videos</h2></div>
      {#if videos.length}
        <div class="grid">{#each videos as video (video.videoId)}<VideoCard {video} />{/each}</div>
        {#if continuation}
          <div style="display:flex;justify-content:center;margin-top:28px">
            <button class="btn" onclick={more} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show more'}</button>
          </div>
        {/if}
      {:else}
        <div class="empty">This channel has no videos.</div>
      {/if}
    </section>
  {/if}
</div>
