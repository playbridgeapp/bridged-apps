<script lang="ts">
  import { ListVideo } from 'lucide-svelte';
  import { imageUrl, videoThumbnail } from './instance.ts';
  import { navigate } from './router.ts';
  import { app } from './state.svelte.ts';
  import type { PlaylistSummary } from './types';

  let { playlist }: { playlist: PlaylistSummary } = $props();
  const first = $derived(playlist.videos?.[0]);
  const image = $derived(playlist.playlistThumbnail
    ? imageUrl(app.instance, playlist.playlistThumbnail)
    : first ? videoThumbnail(app.instance, first.videoId, first.videoThumbnails) : '');
</script>

<button class="card" onclick={() => navigate({ kind: 'playlist', id: playlist.playlistId })}>
  <div class="thumb playlist-thumb">
    {#if image}<img src={image} alt="" loading="lazy" />{/if}
    <div class="stack"><ListVideo size={20} /><span>{playlist.videoCount}</span></div>
  </div>
  <div class="card-body">
    <div class="card-title">{playlist.title}</div>
    <div class="card-meta"><span class="author">{playlist.author}</span><span>Playlist</span></div>
  </div>
</button>
