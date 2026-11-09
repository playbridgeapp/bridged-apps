<script lang="ts">
  import { avatar, formatCount } from './instance.ts';
  import { navigate } from './router.ts';
  import { app } from './state.svelte.ts';
  import type { ChannelSummary } from './types';

  let { channel }: { channel: ChannelSummary } = $props();
  const image = $derived(avatar(app.instance, channel.authorThumbnails));
</script>

<button class="channel-card" onclick={() => navigate({ kind: 'channel', id: channel.authorId })}>
  {#if image}<img class="avatar" src={image} alt="" loading="lazy" />{:else}<span class="avatar">{channel.author.slice(0, 1)}</span>{/if}
  <span>
    <strong>{channel.author}</strong>
    <small>{[formatCount(channel.subCount, 'subscriber'), formatCount(channel.videoCount, 'video')].filter(Boolean).join(' · ')}</small>
  </span>
</button>
