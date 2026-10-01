<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fetchAddonSubtitles, loadSubtitleCues, subtitleRenderer, subtitlesVtt } from './subtitles';
  import type { SubtitleCue } from './subtitle-cues';
  import type { AddonSubtitle } from './subtitles';
  import type { InstalledAddon } from './types';
  export let player: HTMLElement | null;
  export let addons: InstalledAddon[];
  export let type: string;
  export let videoId: string;
  let tracks: AddonSubtitle[] = [];
  let loading = false;
  let selecting = false;
  let selected = '';
  let error = '';
  let request = 0;
  let lookup: AbortController | null = null;
  let selection: AbortController | null = null;
  let cleanup: (() => void) | null = null;
  let lastKey = '';
  $: key = JSON.stringify([type, videoId, addons.map((addon) => [addon.manifestUrl, addon.enabled, addon.disabledFeatures])]);
  $: if (key !== lastKey) { lastKey = key; void discover(); }

  function stop() { cleanup?.(); cleanup = null; selected = ''; }
  async function discover() {
    const token = ++request;
    lookup?.abort(); selection?.abort(); stop(); tracks = []; error = ''; selecting = false; loading = true;
    const controller = new AbortController(); lookup = controller;
    try {
      const result = await fetchAddonSubtitles(addons, type, videoId, controller.signal);
      if (token !== request) return;
      tracks = result.tracks; error = result.errors.join(' ');
    } finally { if (token === request) loading = false; }
  }
  function activeNativeVideo(target: HTMLElement): HTMLVideoElement | null {
    if (target instanceof HTMLVideoElement) return target;
    return [...(target.shadowRoot?.querySelectorAll('video') || [])]
      .find((video) => getComputedStyle(video).display !== 'none') || null;
  }

  function nativeTrack(video: HTMLVideoElement, cues: SubtitleCue[], track: AddonSubtitle) {
    const previous = [...video.textTracks].map((item) => [item, item.mode] as const);
    previous.forEach(([item]) => item.mode = 'disabled');
    const url = URL.createObjectURL(new Blob([subtitlesVtt(cues)], { type: 'text/vtt' }));
    const node = document.createElement('track'); node.src = url; node.kind = 'subtitles'; node.srclang = track.language; node.label = track.label;
    node.addEventListener('load', () => { node.track.mode = 'showing'; }, { once: true });
    video.append(node); node.track.mode = 'showing';
    return () => { node.remove(); URL.revokeObjectURL(url); previous.forEach(([item, mode]) => item.mode = mode); };
  }

  async function choose(id: string) {
    selection?.abort(); selection = null; selecting = false; stop(); error = '';
    const track = tracks.find((item) => item.id === id);
    const target = player;
    if (!track || !target) return;
    const token = request;
    const controller = new AbortController(); selection = controller; selecting = true;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const cues = await loadSubtitleCues(track.url, controller.signal);
      if (controller.signal.aborted || token !== request || target !== player) return;
      const native = activeNativeVideo(target);
      if (native) {
        cleanup = nativeTrack(native, cues, track);
      } else {
        const movi = target as HTMLElement & { setSubtitleRenderer?: (renderer: ReturnType<typeof subtitleRenderer> | null) => void };
        if (!movi.setSubtitleRenderer) throw new Error('This player cannot load external subtitles.');
        // Own the caption layer inside the fullscreen host. Native fallback
        // switches to a real text track for platform fullscreen support.
        const root = target.shadowRoot;
        if (!root) throw new Error('The player subtitle surface is unavailable.');
        const layer = document.createElement('div');
        layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;';
        root.append(layer);
        const renderer = subtitleRenderer(cues);
        const adapter = { ...renderer, mount: () => renderer.mount(layer), render: () => renderer.render(Number((target as HTMLElement & { currentTime?: number }).currentTime) || 0) };
        adapter.mount();
        let nativeCleanup: (() => void) | null = null;
        const handoff = () => {
          const video = activeNativeVideo(target);
          if (!video || nativeCleanup) return;
          nativeCleanup = nativeTrack(video, cues, track);
          layer.style.display = 'none';
        };
        target.addEventListener('nativefallback', handoff);
        cleanup = () => {
          target.removeEventListener('nativefallback', handoff);
          target.removeEventListener('timeupdate', render);
          target.removeEventListener('subtitledelaychange', delay);
          nativeCleanup?.();
          // The native wrapper in Movi 0.4 does not implement this method.
          try { movi.setSubtitleRenderer?.(null); } catch { /* owned layer is removed below */ }
          renderer.destroy(); layer.remove();
        };
        const render = () => renderer.render(Number((target as HTMLElement & { currentTime?: number }).currentTime) || 0);
        const delay = () => renderer.setDelay(Number((target as HTMLElement & { subtitleDelay?: number }).subtitleDelay) || 0);
        movi.setSubtitleRenderer(adapter);
        target.addEventListener('timeupdate', render);
        target.addEventListener('subtitledelaychange', delay);
        delay(); render();

      }
      selected = id;
    } catch (reason) {
      if (token === request && selection === controller) {
        cleanup?.(); cleanup = null;
        error = controller.signal.aborted ? 'Subtitle loading timed out. Try another track.' : reason instanceof Error ? reason.message : 'Subtitle could not load.';
      }
    } finally { clearTimeout(timeout); if (selection === controller) selecting = false; }
  }
  onDestroy(() => { request++; lookup?.abort(); selection?.abort(); stop(); });
</script>

<div class="addon-subtitles">
  <label>Addon subtitles <select aria-label="Addon subtitles" value={selected} disabled={loading || selecting || !player} onchange={(event) => void choose(event.currentTarget.value)}>
    <option value="">{loading ? 'Finding subtitles…' : selecting ? 'Loading subtitle…' : 'Off'}</option>
    {#each tracks as track (track.id)}<option value={track.id}>{track.label}</option>{/each}
  </select></label>
  {#if !loading && !tracks.length}<span>No addon subtitles available.</span>{/if}
  {#if error}<span role="alert">{error} <button onclick={() => void discover()}>Retry</button></span>{/if}
</div>
