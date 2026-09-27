<script lang="ts">
  import type { JellyfinItem } from '../types';
  import {
    playInBrowser,
    playWithDirectCast,
    openItemDetail,
    resolveItemBackdropUrl,
    resolveItemPosterUrl
  } from '../stores/appState';
  import { bridgeStatus } from '../cast/playbridge';
  import { Play, Cast, Info, Star, Clock, Calendar } from 'lucide-svelte';

  export let item: JellyfinItem;

  function formatRuntime(ticks?: number): string {
    if (!ticks) return '';
    const mins = Math.round(ticks / (10000 * 1000 * 60));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
</script>

<div class="hero-banner">
  <div class="backdrop-wrapper">
    <img src={resolveItemBackdropUrl(item)} alt={item.Name} class="backdrop-img" />
    <div class="backdrop-gradient-bottom"></div>
    <div class="backdrop-gradient-left"></div>
  </div>

  <div class="hero-content">
    <div class="meta-pills">
      {#if item.CommunityRating}
        <span class="pill pill-rating">
          <Star size={12} fill="#e3b341" stroke="#e3b341" />
          {item.CommunityRating.toFixed(1)}
        </span>
      {/if}
      {#if item.ProductionYear}
        <span class="pill pill-muted">
          <Calendar size={12} />
          {item.ProductionYear}
        </span>
      {/if}
      {#if item.RunTimeTicks}
        <span class="pill pill-muted">
          <Clock size={12} />
          {formatRuntime(item.RunTimeTicks)}
        </span>
      {/if}
      {#if item.OfficialRating}
        <span class="badge badge-outline">{item.OfficialRating}</span>
      {/if}
      <span class="badge badge-purple">{item.Type}</span>
    </div>

    <h1 class="hero-title">{item.Name}</h1>

    {#if item.Taglines && item.Taglines.length > 0}
      <p class="hero-tagline">{item.Taglines[0]}</p>
    {/if}

    <p class="hero-overview">{item.Overview || 'Explore and stream media seamlessly to PlayBridge receivers on your local network.'}</p>

    <div class="hero-actions">
      <!-- Direct PlayBridge Cast Button -->
      <button class="btn-accent hero-btn action-cast" on:click={() => playWithDirectCast(item)}>
        <Cast size={18} />
        <span>Direct Cast</span>
      </button>

      <!-- Web Player Play Button -->
      <button class="btn-primary hero-btn action-play" on:click={() => playInBrowser(item)}>
        <Play size={18} fill="currentColor" />
        <span>Play</span>
      </button>

      <!-- Details Modal Button -->
      <button class="btn-secondary hero-btn action-details" on:click={() => openItemDetail(item)}>
        <Info size={18} />
        <span>Info</span>
      </button>
    </div>
  </div>
</div>

<style>
  .hero-banner {
    position: relative;
    width: 100%;
    min-height: 480px;
    display: flex;
    align-items: flex-end;
    padding: 44px 36px;
    margin-bottom: 28px;
    overflow: hidden;
  }

  .backdrop-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
  }

  .backdrop-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 25%;
    filter: brightness(0.65) saturate(1.15);
  }

  .backdrop-gradient-bottom {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 85%;
    background: linear-gradient(to top, var(--bg-base) 0%, rgba(5, 5, 5, 0.85) 50%, transparent 100%);
  }

  .backdrop-gradient-left {
    position: absolute;
    top: 0;
    left: 0;
    width: 65%;
    height: 100%;
    background: linear-gradient(to right, var(--bg-base) 0%, rgba(5, 5, 5, 0.8) 60%, transparent 100%);
  }

  .hero-content {
    position: relative;
    z-index: 2;
    max-width: 720px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .meta-pills {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 3px 9px;
    border-radius: var(--radius-full);
    backdrop-filter: blur(10px);
  }

  .pill-rating {
    background: rgba(227, 179, 65, 0.18);
    color: #ffd043;
    border: 1px solid rgba(227, 179, 65, 0.35);
  }

  .pill-muted {
    background: rgba(30, 23, 40, 0.7);
    color: var(--text-secondary);
    border: 1px solid rgba(122, 107, 174, 0.25);
  }

  .hero-title {
    font-size: 2.5rem;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.12;
    color: #ffffff;
    text-shadow: 0 2px 16px rgba(0, 0, 0, 0.8);
  }

  .hero-tagline {
    font-size: 0.95rem;
    font-style: italic;
    color: var(--theme-primary-accent-hover);
    font-weight: 500;
  }

  .hero-overview {
    font-size: 0.92rem;
    color: #9da7b7;
    line-height: 1.55;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85);
  }

  .hero-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
    flex-wrap: wrap;
  }

  .hero-btn {
    padding: 11px 22px;
    font-size: 0.92rem;
  }

  .action-cast {
    background: var(--theme-primary-accent);
    color: #050505;
    font-weight: 800;
    box-shadow: 0 0 24px rgba(149, 255, 80, 0.35);
  }

  .action-play {
    background: rgba(44, 34, 60, 0.85);
    border: 1px solid rgba(122, 107, 174, 0.3);
    color: #ffffff;
  }

  @media (max-width: 768px) {
    .hero-banner {
      min-height: 340px;
      padding: 24px 16px;
      margin-bottom: 16px;
    }
    .hero-title {
      font-size: 1.6rem;
    }
    .hero-overview {
      -webkit-line-clamp: 2;
      font-size: 0.84rem;
    }
    .hero-actions {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 8px;
      width: 100%;
    }
    .hero-btn {
      padding: 10px 12px;
      font-size: 0.85rem;
      width: 100%;
    }
    .action-details {
      padding: 10px 14px;
    }
  }
</style>
