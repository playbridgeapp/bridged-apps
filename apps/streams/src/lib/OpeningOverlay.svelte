<script lang="ts">
  import { onMount } from 'svelte';
  import { LoaderCircle } from 'lucide-svelte';
  import type { Meta, Video } from './types';
  export let meta: Meta;
  export let returnFocus: HTMLElement | null = null;
  export let video: Video | null = null;
  export let status: string;
  export let onCancel: () => void;
  export let onManual: () => void;
  let dialog: HTMLDivElement;
  onMount(() => {
    const previous = returnFocus || document.activeElement as HTMLElement | null;
    dialog.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onCancel(); }
      if (event.key !== 'Tab') return;
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', trap, true);
    return () => { window.removeEventListener('keydown', trap, true); const playerBack = document.querySelector<HTMLButtonElement>('.player-overlay:not([inert]) .player-back'); if (playerBack) playerBack.focus(); else if (previous?.isConnected) previous.focus(); };
  });
</script>

<div class="opening-overlay" role="dialog" aria-modal="true" aria-label={`Opening ${meta.name}`} aria-describedby="opening-status" bind:this={dialog}>
  {#if meta.background || meta.poster}<img class="opening-backdrop" src={meta.background || meta.poster} alt="" />{/if}
  <div class="opening-copy">
    {#if meta.logo}<img class="opening-logo" src={meta.logo} alt="" />{/if}
    <h1>{meta.name}</h1>
    {#if video}<p class="opening-episode">S{video.season ?? '?'} · E{video.episode ?? '?'}{video.title ? ` — ${video.title}` : ''}</p>{/if}
    <p class="opening-status" id="opening-status" role="status" aria-live="polite"><LoaderCircle size={22} />{status}</p>
    <div class="opening-actions"><button onclick={onCancel}>Cancel</button><button onclick={onManual}>Choose manually</button></div>
  </div>
</div>

<style>
  .opening-overlay{position:fixed;inset:0;z-index:300;display:grid;place-items:center;background:#090b0f;color:#f2f5f3;padding:24px;overflow:auto;isolation:isolate}
  .opening-backdrop{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.25;z-index:-2}
  .opening-overlay:before{content:'';position:absolute;inset:0;background:linear-gradient(0deg,#090b0f 0%,#090b0f44 100%);z-index:-1}
  .opening-copy{width:min(560px,100%);text-align:center;overflow-wrap:anywhere}
  .opening-logo{max-width:min(360px,85%);max-height:120px;object-fit:contain;margin:0 auto 20px}
  h1{font-size:clamp(27px,6vw,44px);line-height:1.15;margin:0 0 16px}.opening-episode{color:#b4c3c8;line-height:1.6}
  .opening-status{display:flex;align-items:center;justify-content:center;gap:12px;min-height:70px;color:#b4f3df}
  .opening-status :global(svg){flex:none;animation:opening-spin 1.1s linear infinite}
  .opening-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:12px;margin-top:18px}
  button{min-height:44px;border:1px solid #ffffff40;border-radius:999px;background:#ffffff10;color:inherit;font:inherit;padding:12px 22px;cursor:pointer}
  button:focus-visible{outline:2px solid #9debd2;outline-offset:4px}
  @keyframes opening-spin{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.opening-status :global(svg){animation:none}}
</style>
