<script lang="ts">
  import { Film, Info, Star } from 'lucide-svelte';
  import type { MetaPreview } from './types';

  export let item: MetaPreview;
  export let onSelect: () => void;
  export let progress: number | undefined = undefined;
  export let subtitle: string | undefined = undefined;

  $: release = typeof item.releaseInfo === 'string' ? item.releaseInfo.trim().replace(/^(\d{4})\s*[-–—−]\s*$/, '$1') : '';
  $: typeLabel = item.type === 'series' ? 'TV show' : item.type === 'movie' ? 'Movie' : item.type === 'sport' ? 'Sports' : 'Title';
  $: detail = subtitle ?? (release || typeLabel);
</script>

<button class="media-card" aria-label={`View details for ${item.name}`} onclick={onSelect}>
  <span class="poster">
    {#if item.poster}<img src={item.poster} alt="" loading="lazy" />{:else}<Film size={34} />{/if}
    <span class="tile-hover" aria-hidden="true">
      <span class="tile-hover-icon"><Info size={23} /></span>
      <span class="tile-hover-title">{item.name}</span>
      <span class="tile-hover-meta">{#if item.imdbRating}<span class="tile-rating"><Star size={12} fill="currentColor" /> {item.imdbRating}</span>{/if}<span>{detail}</span></span>
    </span>
    {#if progress && progress > 0}<span class="poster-progress"><span style:width={`${progress}%`}></span></span>{/if}
  </span>
  <span class="tile-caption">
    <span class="tile-title">{item.name}</span>
    <span class="tile-meta">{#if item.imdbRating}<span class="tile-rating"><Star size={10} fill="currentColor" /> {item.imdbRating}</span>{/if}<span>{detail}</span></span>
  </span>
</button>
