<script lang="ts">
  import type { JellyfinItem } from '../types';
  import MediaCard from './MediaCard.svelte';
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';

  export let title: string;
  export let subtitle: string = '';
  export let items: JellyfinItem[] = [];
  export let onSeeAll: (() => void) | undefined = undefined;

  let scrollContainer: HTMLDivElement;

  function scroll(direction: 'left' | 'right') {
    if (!scrollContainer) return;
    const distance = scrollContainer.clientWidth * 0.75;
    scrollContainer.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth'
    });
  }
</script>

{#if items && items.length > 0}
  <section class="media-section">
    <div class="section-header">
      <div class="header-titles">
        <h2 class="section-title">{title}</h2>
        {#if subtitle}
          <p class="section-subtitle">{subtitle}</p>
        {/if}
      </div>

      <div class="scroll-controls">
        {#if onSeeAll}
          <button class="see-all-btn" on:click={onSeeAll}>
            View All &rarr;
          </button>
        {/if}
        <button class="control-btn" on:click={() => scroll('left')} aria-label="Scroll left">
          <ChevronLeft size={18} />
        </button>
        <button class="control-btn" on:click={() => scroll('right')} aria-label="Scroll right">
          <ChevronRight size={18} />
        </button>
      </div>
    </div>

    <div class="cards-carousel" bind:this={scrollContainer}>
      {#each items as item (item.Id)}
        <div class="carousel-item">
          <MediaCard {item} />
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .media-section {
    padding: 0 36px;
    margin-bottom: 40px;
  }

  .section-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .section-title {
    font-size: 1.35rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #ffffff;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-subtitle {
    font-size: 0.8rem;
    color: var(--theme-type-muted);
    margin-top: 2px;
  }

  .scroll-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .see-all-btn {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--theme-primary-accent);
    background: rgba(30, 23, 40, 0.6);
    border: 1px solid rgba(122, 107, 174, 0.25);
    padding: 6px 14px;
    border-radius: var(--radius-full);
    margin-right: 4px;
    transition: all 0.2s ease;
  }

  .see-all-btn:hover {
    background: rgba(44, 34, 60, 0.85);
    border-color: var(--theme-primary-accent);
    box-shadow: 0 0 14px rgba(149, 255, 80, 0.25);
    color: #fff;
  }

  .control-btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: rgba(30, 23, 40, 0.6);
    border: 1px solid rgba(122, 107, 174, 0.25);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .control-btn:hover {
    background: rgba(44, 34, 60, 0.9);
    color: #fff;
    border-color: var(--theme-pill-highlight);
    transform: scale(1.08);
  }

  .cards-carousel {
    display: flex;
    gap: 18px;
    overflow-x: auto;
    padding-bottom: 16px;
    scroll-behavior: smooth;
    scrollbar-width: none;
  }

  .cards-carousel::-webkit-scrollbar {
    display: none;
  }

  .carousel-item {
    width: 180px;
    flex-shrink: 0;
  }

  @media (max-width: 768px) {
    .media-section {
      padding: 0 16px;
      margin-bottom: 28px;
    }
    .carousel-item {
      width: 135px;
    }
    .section-title {
      font-size: 1.15rem;
    }
  }
</style>
