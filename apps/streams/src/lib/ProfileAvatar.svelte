<script lang="ts">
  import { Lock } from 'lucide-svelte';
  import { profileColor, profileInkColor } from './profile-launch';
  import type { NuvioProfile } from './nuvio';

  export let profile: NuvioProfile;
  export let size = 48;
  export let locked = false;
  export let ring = false;

  $: background = profileColor(profile);
  $: ink = profileInkColor(background);
  $: initial = (profile.name.trim()[0] || String(profile.profile_index)).toUpperCase();
</script>

<span class="profile-avatar" class:ring style:--avatar-size={`${size}px`} style:--avatar-bg={background} style:--avatar-ink={ink} aria-hidden="true">
  <span class="face">
    {initial}
  </span>
  {#if locked}<span class="lock"><Lock size={Math.max(10, Math.round(size * 0.13))} strokeWidth={2.4} /></span>{/if}
</span>

<style>
  .profile-avatar { position: relative; display: inline-grid; flex: none; width: var(--avatar-size); height: var(--avatar-size); }
  .face { display: grid; place-items: center; overflow: hidden; width: 100%; height: 100%; border-radius: 50%; background: var(--avatar-bg); color: var(--avatar-ink); font-family: Manrope, sans-serif; font-weight: 800; font-size: calc(var(--avatar-size) * 0.4); line-height: 1; transition: transform .16s, box-shadow .16s; }
  .ring .face { box-shadow: 0 0 0 calc(var(--avatar-size) * 0.03 + 2px) #090b0f, 0 0 0 calc(var(--avatar-size) * 0.03 + 5px) #f4f5f4; }
  .lock { position: absolute; right: -2px; bottom: -2px; display: grid; place-items: center; width: calc(var(--avatar-size) * 0.28 + 6px); height: calc(var(--avatar-size) * 0.28 + 6px); border: 2px solid #2a3038; border-radius: 50%; background: #090b0f; color: #f2f2f2; }
</style>
