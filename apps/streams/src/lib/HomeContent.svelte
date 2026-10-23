<script lang="ts">
  import { onMount, tick } from 'svelte';

  /** Returning to a remembered place: build the rows now so the position can be restored without a jump. */
  export let immediate = false;
  export let onReady: () => void = () => {};

  let ready = immediate;

  onMount(() => {
    if (ready) { void tick().then(onReady); return; }
    let frame = requestAnimationFrame(() => {
      // Give the tab shell a paint opportunity before creating Home's content.
      frame = requestAnimationFrame(() => {
        timer = window.setTimeout(() => { ready = true; void tick().then(onReady); }, 0);
      });
    });
    let timer = 0;
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  });
</script>

{#if ready}
  <slot />
{:else}
  <section class="home-loading" role="status" aria-label="Loading home">
    <div class="startup-hero-skeleton" aria-hidden="true"></div>
  </section>
{/if}

<style>
  .home-loading{min-height:100svh;padding:100px 22px 80px}
  .home-loading :global(.startup-hero-skeleton){height:clamp(320px,60svh,560px)}
</style>
