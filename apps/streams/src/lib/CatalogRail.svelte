<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ArrowRight, LoaderCircle } from 'lucide-svelte';
  import MediaTile from './MediaTile.svelte';
  import { railPosition, saveRailPosition } from './rail-positions';
  import type { MetaPreview } from './types';

  export let items: MetaPreview[];
  export let title: string;
  export let onSelect: (item: MetaPreview) => void;
  export let onLoadMore: () => Promise<void>;
  export let canLoadMore = false;
  export let loadingMore = false;
  export let pageError = '';
  export let active = true;
  /** Keeps this rail's place when its tab unmounts and comes back. */
  export let memoryKey = '';

  const batchSize = 12;
  const remembered = memoryKey ? railPosition(memoryKey) : undefined;
  let rail: HTMLDivElement;
  // A rail the user already scrolled mounts at once, so its offset can be restored.
  let mounted = !!remembered;
  let limit = Math.max(batchSize, remembered?.limit ?? 0);
  let requesting = false;

  // Off-screen rows skip layout (content-visibility), so apply the offset once it sticks.
  let pendingScroll = remembered?.scrollLeft ?? 0;
  // Tracked while scrolling: the element may already be detached when the tab unmounts.
  let scrollLeft = pendingScroll;
  function applyPendingScroll() {
    if (!pendingScroll || !rail) return;
    rail.scrollLeft = pendingScroll;
    if (Math.abs(rail.scrollLeft - pendingScroll) < 1) { scrollLeft = rail.scrollLeft; pendingScroll = 0; }
  }

  onMount(() => {
    if (pendingScroll) void tick().then(() => requestAnimationFrame(applyPendingScroll));
    const save = () => {
      if (memoryKey && rail && mounted) saveRailPosition(memoryKey, {
        scrollLeft: pendingScroll || scrollLeft, limit: limit > batchSize ? limit : 0 });
    };
    if (typeof IntersectionObserver === 'undefined') { mounted = true; return save; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      mounted = true;
      if (pendingScroll) { void tick().then(() => { applyPendingScroll(); requestAnimationFrame(applyPendingScroll); }); return; }
      observer.disconnect();
    }, { rootMargin: '300px 0px' });
    observer.observe(rail);
    return () => { save(); observer.disconnect(); };
  });

  async function revealMore() {
    if (!active || requesting || loadingMore) return;
    if (limit < items.length) {
      limit = Math.min(limit + batchSize, items.length);
    } else if (canLoadMore) {
      requesting = true;
      try {
        await onLoadMore();
        await tick();
        limit = Math.min(limit + batchSize, items.length);
      } finally { requesting = false; }
    }
  }

  function onScroll() {
    if (!pendingScroll) scrollLeft = rail.scrollLeft;
    if (rail.scrollLeft > 0 && rail.scrollWidth - rail.clientWidth - rail.scrollLeft < 280) void revealMore();
  }
</script>

<div class="media-row" bind:this={rail} onscroll={onScroll}>
  {#if mounted}
    {#each items.slice(0, limit) as item (item.type + item.id)}
      <MediaTile {item} onSelect={() => onSelect(item)} />
    {/each}
    {#if limit < items.length || canLoadMore}
      <div class="catalog-row-end">
        {#if loadingMore || requesting}<LoaderCircle size={21} class="spin" />
        {:else}<button onclick={() => void revealMore()} aria-label={`Load more ${title}`}>{pageError && limit >= items.length ? 'Retry' : 'More'} <ArrowRight size={17} /></button>{/if}
      </div>
    {/if}
  {:else}
    <div class="card-skeletons" aria-label={`Loading ${title}`}><span></span><span></span><span></span><span></span><span></span></div>
  {/if}
</div>

<style>
  /* Reserve the card captions' height while the row contains placeholders. */
  .card-skeletons{flex:none;max-width:100%;padding-bottom:44px}
</style>
