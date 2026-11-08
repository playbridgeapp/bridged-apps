<script lang="ts">
  import { formatCount, formatDuration, videoThumbnail } from './instance.ts';
  import { navigate } from './router.ts';
  import { app } from './state.svelte.ts';
  import type { VideoSummary } from './types';

  let { video, list, progress }: { video: VideoSummary; list?: string; progress?: number } = $props();

  const saved = $derived(progress ?? (() => {
    const entry = app.progress.get(video.videoId);
    return entry && entry.durationMs > 0 ? entry.positionMs / entry.durationMs : 0;
  })());
  const meta = $derived([video.viewCountText || formatCount(video.viewCount, 'view'), video.publishedText].filter(Boolean).join(' · '));
</script>

<button class="card" onclick={() => navigate({ kind: 'watch', id: video.videoId, list })}>
  <div class="thumb">
    <img src={videoThumbnail(app.instance, video.videoId, video.videoThumbnails)} alt="" loading="lazy" decoding="async" />
    {#if video.liveNow}
      <span class="badge live">LIVE</span>
    {:else if video.lengthSeconds > 0}
      <span class="badge">{formatDuration(video.lengthSeconds)}</span>
    {/if}
    {#if saved > 0.01 && saved < 0.95}
      <div class="progress"><span style:width="{Math.round(saved * 100)}%"></span></div>
    {/if}
  </div>
  <div class="card-body">
    <div class="card-title">{video.title}</div>
    <div class="card-meta">
      <span class="author">{video.author}</span>
      {#if meta}<span>{meta}</span>{/if}
    </div>
  </div>
</button>
