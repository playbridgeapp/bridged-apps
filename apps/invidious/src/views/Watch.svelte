<script lang="ts">
  import { Bell, BellOff, Cast, LoaderCircle, Play, Smartphone, Tv } from 'lucide-svelte';
  import ErrorNotice from '../lib/ErrorNotice.svelte';
  import { bridgeErrorMessage, destinationsSupported, prepareItem, startSession } from '../lib/bridge.ts';
  import { avatar, formatCount, formatDuration, instanceUrl, videoThumbnail } from '../lib/instance.ts';
  import { AutoplayQueue, mediaPlan, PlaylistPager } from '../lib/playback.ts';
  import { navigate, openVideo, replaceRoute, takeAutoplay } from '../lib/router.ts';
  import { app } from '../lib/state.svelte.ts';
  import type { PlaylistDetails, VideoDetails, VideoSummary } from '../lib/types';

  let { id, list }: { id: string; list?: string } = $props();

  let video = $state<VideoDetails | null>(null);
  let playlist = $state<PlaylistDetails | null>(null);
  /** Every page of [playlist] loaded so far; shared with TV playback so its queue can keep going. */
  let pager: PlaylistPager | null = null;
  let playlistVideos = $state<(VideoSummary & { index?: number })[]>([]);
  let loading = $state(true);
  let error = $state('');
  let attempt = $state(0);
  let busy = $state(false);
  let playError = $state('');
  let remoteName = $state('');
  let browserSrc = $state('');
  let expanded = $state(false);
  let subscribing = $state(false);
  let lastSave = 0;
  let markedWatched = false;

  const bridge = destinationsSupported();
  const destinationLabel = $derived(app.destination?.kind === 'local' ? 'This phone' : app.destination?.name || 'Choose a device');
  const sideVideos = $derived<(VideoSummary & { index?: number })[]>(playlistVideos.length ? playlistVideos : video?.recommendedVideos || []);
  const subscribed = $derived(video ? app.subscriptions.has(video.authorId) : false);

  $effect(() => {
    void attempt;
    const api = app.api;
    const videoId = id, listId = list;
    const controller = new AbortController();
    loading = true;
    error = '';
    playError = '';
    browserSrc = '';
    remoteName = '';
    expanded = false;
    markedWatched = false;
    pager = null;
    playlistVideos = [];
    Promise.all([
      api.video(videoId, controller.signal),
      listId ? api.playlist(listId, 1, controller.signal).catch(() => null) : Promise.resolve(null)
    ]).then(([details, list]) => {
      video = details;
      playlist = list;
      if (list && listId) {
        const loaded = new PlaylistPager((page) => api.playlist(listId, page), list);
        pager = loaded;
        playlistVideos = loaded.videos;
        // Show this video's place in a long playlist.
        if (!loaded.has(videoId)) {
          void loaded.find(videoId).then(() => { if (pager === loaded) playlistVideos = loaded.videos; }).catch(() => {});
        }
      }
      document.title = details.title;
      if (takeAutoplay(videoId)) void play();
    }).catch((reason) => {
      if (!controller.signal.aborted) error = reason.message;
    }).finally(() => {
      if (!controller.signal.aborted) loading = false;
    });
    return () => controller.abort();
  });

  function markWatched(videoId: string) {
    if (app.signedIn) void app.api.markWatched(videoId).catch(() => {});
  }

  async function play(change = false) {
    if (!video || busy) return;
    playError = '';
    busy = true;
    try {
      if (bridge) {
        let destination = app.destination;
        if (change || !destination?.id) destination = await app.pickDestination();
        if (!destination.id) throw new Error('Choose a device first.');
        await startSession({
          api: app.api,
          instance: app.instance,
          progress: app.progress,
          autoplay: app.autoplay,
          onWatched: markWatched,
          onNowPlaying: (nowId) => {
            // Follow the queue without restarting playback.
            replaceRoute({ kind: 'watch', id: nowId, list });
          }
        }, destination, video, pager ?? undefined);
        if (pager) playlistVideos = pager.videos;
        remoteName = destination.kind === 'local' ? '' : destination.name || 'your TV';
        if (destination.kind === 'local') app.showToast('Opening the PlayBridge player…');
      } else {
        await playInBrowser(video);
      }
    } catch (reason) {
      playError = bridgeErrorMessage(reason);
    } finally {
      busy = false;
    }
  }

  async function playInBrowser(details: VideoDetails) {
    const item = await prepareItem({ api: app.api, instance: app.instance, progress: app.progress }, details, 'external');
    const plan = mediaPlan(details, 'browser');
    browserSrc = plan.kind === 'hls' ? instanceUrl(app.instance, plan.path) : item.url;
    if (!markedWatched) { markedWatched = true; markWatched(details.videoId); }
  }

  function onLoaded(event: Event) {
    const media = event.currentTarget as HTMLVideoElement;
    const resume = video ? app.progress.resumeMs(video.videoId) : 0;
    if (resume > 0) media.currentTime = resume / 1000;
    void media.play().catch(() => {});
  }

  function onTime(event: Event) {
    const media = event.currentTarget as HTMLVideoElement;
    const now = Date.now();
    if (!video || now - lastSave < 4000 || !Number.isFinite(media.duration)) return;
    lastSave = now;
    app.progress.save(video.videoId, media.currentTime * 1000, media.duration * 1000, video);
  }

  async function onEnded(event: Event) {
    if (!video) return;
    const ended = video, playing = pager;
    const media = event.currentTarget as HTMLVideoElement;
    if (Number.isFinite(media.duration)) app.progress.save(ended.videoId, media.duration * 1000, media.duration * 1000, ended);
    const queue = new AutoplayQueue(playing ? () => playing.videos : [], ended.videoId, app.autoplay);
    let next = queue.next(ended.recommendedVideos);
    // At the end of the loaded pages, load the next page of the playlist.
    while (!next && playing && !playing.done && (await playing.more().catch(() => [])).length) next = queue.next();
    if (next && video === ended) openVideo(next, list);
  }

  async function toggleSubscription() {
    if (!video || subscribing) return;
    subscribing = true;
    try { await app.setSubscribed(video.authorId, !subscribed); }
    catch (reason) { app.showToast((reason as Error).message); }
    finally { subscribing = false; }
  }
</script>

<div class="page">
  {#if loading && !video}
    <div class="watch"><div><div class="stage skeleton"></div></div></div>
  {:else if error}
    <ErrorNotice message={error} retry={() => attempt++} />
  {:else if video}
    <div class="watch">
      <div>
        <div class="stage">
          {#if browserSrc}
            <!-- svelte-ignore a11y_media_has_caption -->
            <!-- Captions load through the API origin: tracks must be same-origin, and the
                 instance's final video response carries no CORS header for a crossorigin video. -->
            <video src={browserSrc} controls playsinline onloadedmetadata={onLoaded} ontimeupdate={onTime} onended={onEnded}>
              {#if app.api.base === location.origin}
                {#each video.captions || [] as caption (caption.url)}
                  <track kind="subtitles" src={instanceUrl(app.api.base, caption.url)} srclang={caption.language_code} label={caption.label} />
                {/each}
              {/if}
            </video>
          {:else}
            <img class="poster" src={videoThumbnail(app.instance, video.videoId, video.videoThumbnails?.filter((thumb) => thumb.quality === 'maxres' || thumb.quality === 'high'))} alt="" />
            <div class="stage-overlay">
              {#if remoteName}
                <Tv size={34} />
                <p>Playing on <strong>{remoteName}</strong>. Use the PlayBridge remote to control it.</p>
                <button class="btn small" onclick={() => play()} disabled={busy}>Play again</button>
              {:else}
                <button class="play-big" onclick={() => play()} disabled={busy} aria-label="Play">
                  {#if busy}<LoaderCircle size={34} class="spin" />{:else}<Play size={34} fill="currentColor" />{/if}
                </button>
                {#if video.isUpcoming}<p>This video hasn’t premiered yet.</p>{/if}
              {/if}
            </div>
          {/if}
        </div>
        {#if playError}<div style="margin-top:12px"><ErrorNotice message={playError} /></div>{/if}

        <h1>{video.title}</h1>
        <div class="watch-bar">
          <button class="author-line" onclick={() => navigate({ kind: 'channel', id: video!.authorId })}>
            {#if avatar(app.instance, video.authorThumbnails, 88)}
              <img class="avatar" src={avatar(app.instance, video.authorThumbnails, 88)} alt="" />
            {:else}<span class="avatar">{video.author.slice(0, 1)}</span>{/if}
            <span><strong>{video.author}</strong>{#if video.subCountText}<small>{video.subCountText} subscribers</small>{/if}</span>
          </button>
          <div class="actions">
            {#if app.signedIn}
              <button class="btn small" class:primary={!subscribed} onclick={toggleSubscription} disabled={subscribing}>
                {#if subscribed}<BellOff size={16} />Unsubscribe{:else}<Bell size={16} />Subscribe{/if}
              </button>
            {/if}
            {#if bridge}
              <button class="btn small" onclick={() => play(true)} disabled={busy}>
                {#if app.destination?.kind === 'local'}<Smartphone size={16} />{:else}<Cast size={16} />{/if}
                {destinationLabel}
              </button>
            {/if}
          </div>
        </div>

        <div class="description" class:clamped={!expanded}>
          <div class="facts">{[formatCount(video.viewCount, 'view'), video.publishedText, formatDuration(video.lengthSeconds)].filter(Boolean).join(' · ')}</div>
          {video.description || 'No description.'}
        </div>
        {#if (video.description || '').length > 280}
          <button class="link-btn" style="margin-top:8px" onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : 'Show more'}</button>
        {/if}
      </div>

      <aside class="side-list">
        <h2>{playlist ? playlist.title : app.autoplay ? 'Up next' : 'Related'}</h2>
        {#each sideVideos as item (item.videoId + (item.index ?? ''))}
          <button class="compact" class:current={item.videoId === video.videoId} onclick={() => navigate({ kind: 'watch', id: item.videoId, list })}>
            <div class="thumb">
              <img src={videoThumbnail(app.instance, item.videoId, item.videoThumbnails)} alt="" loading="lazy" />
              {#if item.lengthSeconds > 0}<span class="badge">{formatDuration(item.lengthSeconds)}</span>{/if}
            </div>
            <div>
              <div class="card-title">{item.title}</div>
              <div class="card-meta"><span class="author">{item.author}</span>{item.viewCountText || ''}</div>
            </div>
          </button>
        {:else}
          <p class="card-meta">No related videos.</p>
        {/each}
      </aside>
    </div>
  {/if}
</div>
