<script lang="ts">
  import { onMount } from 'svelte';
  import { ExternalLink, X } from 'lucide-svelte';
  import type { MetaTrailer } from './types';

  export let trailer: MetaTrailer;
  export let onClose: () => void;
  let dialog: HTMLDialogElement;
  let closeButton: HTMLButtonElement;
  $: videoId = /^[\w-]{11}$/.test(trailer.id) ? trailer.id : '';
  $: embedUrl = videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0` : '';

  onMount(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    closeButton.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  });

  function closeOnBackdrop(event: MouseEvent) {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }
</script>

<dialog bind:this={dialog} class="trailer-player" aria-label={`Trailer: ${trailer.name}`} onclick={closeOnBackdrop} oncancel={(event) => { event.preventDefault(); onClose(); }}>
  <header><div><small>TRAILER</small><h2>{trailer.name}</h2></div><button bind:this={closeButton} class="close-trailer" aria-label="Close trailer" onclick={onClose}><X size={22} /></button></header>
  {#if embedUrl}
    <iframe src={embedUrl} title={trailer.name} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
    <footer><a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer">Watch on YouTube <ExternalLink size={14} /></a></footer>
  {:else}<p>This trailer is unavailable.</p>{/if}
</dialog>

<style>
  .trailer-player{width:min(960px,calc(100vw - 24px));max-width:none;max-height:calc(100dvh - 32px);padding:0;border:1px solid #ffffff24;border-radius:18px;background:#0d121b;color:#edf1ef;box-shadow:0 28px 100px #0009;overflow:auto}
  .trailer-player[open]{animation:trailer-in .2s cubic-bezier(.2,.8,.2,1)}
  .trailer-player::backdrop{background:#02050bc9;backdrop-filter:blur(9px);animation:trailer-backdrop-in .18s ease-out}
  header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px}header small{color:#86d5bd;font-size:10px;font-weight:700;letter-spacing:.15em}h2{font-size:16px;line-height:1.4;margin:5px 0 0}
  .close-trailer{display:grid;place-items:center;flex:none;width:44px;height:44px;border:1px solid #ffffff1f;border-radius:50%;background:#ffffff08;color:#edf1ef;cursor:pointer}.close-trailer:hover{background:#ffffff14}.close-trailer:focus-visible,a:focus-visible{outline:2px solid #86d5bd;outline-offset:3px}
  iframe{display:block;width:100%;aspect-ratio:16/9;min-height:200px;border:0;background:#000}
  footer{display:flex;justify-content:flex-end;padding:14px 20px}footer a{display:flex;align-items:center;gap:7px;color:#aab8bf;font-size:12px;text-decoration:none}footer a:hover{color:#fff}p{padding:20px}
  @keyframes trailer-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}@keyframes trailer-backdrop-in{from{opacity:0}to{opacity:1}}
  @media(prefers-reduced-motion:reduce){.trailer-player[open],.trailer-player::backdrop{animation:none}}
</style>
