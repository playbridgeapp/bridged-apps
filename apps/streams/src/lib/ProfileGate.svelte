<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowLeft, Clapperboard, LoaderCircle, RefreshCw, X } from 'lucide-svelte';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import PinPad from './PinPad.svelte';
  import type { NuvioProfile } from './nuvio';
  import type { PinResult } from './profile-launch';

  export let profiles: NuvioProfile[];
  /** The profile ringed as "Last used" (or "Current" when opened from the switcher). */
  export let highlightIndex = 0;
  export let highlightLabel = 'Last used';
  /** Profiles shown from the display cache until the account confirms them. */
  export let validating = false;
  export let busyIndex: number | null = null;
  export let error = '';
  export let message = '';
  export let pinIndex: number | null = null;
  export let returnLabel = '';
  export let email = '';
  export let closable = false;
  export let onPick: (index: number) => void;
  export let onSubmitPin: (pin: string) => Promise<PinResult>;
  export let onCancelPin: () => void;
  export let onRetry: () => void;
  export let onClose: () => void;
  export let onSignOut: () => void;

  let dialog: HTMLElement;
  $: pinProfile = pinIndex === null ? null : profiles.find((profile) => profile.profile_index === pinIndex) || null;

  onMount(() => dialog?.focus());
</script>

<div class="profile-gate" role="dialog" aria-modal="true" aria-label="Who's watching?" tabindex="-1" bind:this={dialog}>
  <header class="gate-header">
    <span class="gate-brand"><span class="gate-mark"><Clapperboard size={22} strokeWidth={2.4} /></span></span>
    {#if closable && !pinProfile}<button class="gate-close" type="button" onclick={onClose} aria-label="Close profile picker"><X size={22} /></button>{/if}
  </header>

  <div class="gate-body">
    {#if pinProfile}
      <PinPad profile={pinProfile} onSubmit={onSubmitPin} onBack={onCancelPin} />
    {:else}
      <h1>Who's watching?</h1>
      {#if returnLabel}<p class="gate-return"><ArrowLeft size={15} /> Returns to <strong>{returnLabel}</strong></p>{/if}
      {#if message}<p class="gate-note" role="status">{message}</p>{/if}
      <div class="gate-profiles">
        {#each profiles as profile (profile.profile_index)}
          <button class="gate-profile" type="button" disabled={validating || busyIndex !== null} onclick={() => onPick(profile.profile_index)}
            aria-label={`${profile.name || `Profile ${profile.profile_index}`}${profile.pin_enabled ? ', PIN required' : ''}${profile.profile_index === highlightIndex ? `, ${highlightLabel.toLowerCase()}` : ''}`}>
            <ProfileAvatar {profile} size={128} locked={profile.pin_enabled === true} ring={profile.profile_index === highlightIndex} />
            <span class="gate-name">{profile.name || `Profile ${profile.profile_index}`}</span>
            <small class="gate-caption">{#if busyIndex === profile.profile_index}<LoaderCircle size={14} class="spin" /> Opening…{:else if profile.profile_index === highlightIndex}{highlightLabel.toUpperCase()}{/if}</small>
          </button>
        {/each}
      </div>
      {#if validating && !error}<p class="gate-status" role="status"><LoaderCircle size={16} class="spin" /> Checking your profiles…</p>{/if}
      {#if error}
        <p class="gate-error" role="alert">{error}</p>
        <div class="gate-actions"><button class="gate-outline" type="button" onclick={onRetry}><RefreshCw size={16} /> Retry</button><button class="gate-text" type="button" onclick={onClose}>Not now</button></div>
      {/if}
      <p class="gate-manage">Add, edit or lock profiles in the Nuvio app.</p>
    {/if}
  </div>

  {#if !pinProfile}
    <footer class="gate-footer">{#if email}<span>Nuvio · {email}</span><span aria-hidden="true">·</span>{/if}<button type="button" onclick={onSignOut}>Use another account</button></footer>
  {/if}
</div>

<style>
  .profile-gate { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; overflow: auto; padding: 26px clamp(18px, 5vw, 76px) 28px; background: #090b0f; color: #f7f7f7; outline: none; }
  .gate-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .gate-brand { display: flex; align-items: center; gap: 11px; }
  .gate-mark { display: grid; place-items: center; width: 37px; height: 37px; border-radius: 11px; background: #f4f5f4; color: #101114; }
  .gate-close { display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 50%; background: #ffffff12; color: #eceeef; }
  .gate-close:hover { background: #ffffff2a; color: #fff; }
  .gate-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 0; }
  h1 { margin: 0; font-family: Georgia, serif; font-size: clamp(38px, 5vw, 60px); font-weight: 700; letter-spacing: -.01em; text-align: center; }
  .gate-return { display: flex; align-items: center; gap: 7px; margin: 18px 0 0; padding: 8px 14px; border: 1px solid #ffffff1f; border-radius: 999px; background: #14181d; color: #c9cdd2; font-size: 13px; }
  .gate-return strong { color: #fff; }
  .gate-note { max-width: 520px; margin: 18px 0 0; color: #c9cdd2; font-size: 14px; line-height: 1.6; text-align: center; }
  .gate-profiles { display: flex; flex-wrap: wrap; justify-content: center; gap: 28px; margin-top: 48px; }
  .gate-profile { display: flex; flex-direction: column; align-items: center; gap: 14px; width: 168px; padding: 10px 0; border: 0; border-radius: 18px; background: none; color: #c9cdd2; }
  .gate-profile:hover:not(:disabled) { color: #fff; }
  .gate-profile:hover:not(:disabled) :global(.face) { transform: scale(1.04); }
  .gate-profile:disabled { opacity: 1; cursor: default; }
  .gate-name { font-family: Manrope, sans-serif; font-size: 17px; font-weight: 800; }
  .gate-caption { display: flex; align-items: center; gap: 6px; min-height: 16px; margin-top: -8px; color: #8fe9cc; font-size: 12px; font-weight: 800; letter-spacing: .04em; }
  .gate-status { display: flex; align-items: center; gap: 8px; margin: 26px 0 0; color: #b3b9c0; font-size: 13px; }
  .gate-error { max-width: 520px; margin: 26px 0 0; padding: 12px 14px; border: 1px solid #8a4a4b; border-radius: 10px; background: #3c2429; color: #ffb9ba; font-size: 13px; text-align: center; }
  .gate-actions { display: flex; align-items: center; gap: 14px; margin-top: 14px; }
  .gate-outline { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 18px; border: 1px solid #ffffff45; border-radius: 999px; background: #ffffff14; color: #f2f2f2; font-size: 14px; font-weight: 800; }
  .gate-outline:hover { background: #ffffff26; }
  .gate-text, .gate-footer button { min-height: 44px; border: 0; background: none; color: #7fe6c6; font-size: 13px; font-weight: 800; }
  .gate-text:hover, .gate-footer button:hover { color: #b1f7df; }
  .gate-manage { margin: 40px 0 0; color: #9aa1a9; font-size: 13px; text-align: center; }
  .gate-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px 10px; color: #9aa1a9; font-size: 13px; }
  @media (max-width: 640px) {
    .gate-profiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 12px; width: 100%; margin-top: 36px; }
    .gate-profile { width: auto; }
    .gate-profile :global(.profile-avatar) { --avatar-size: 104px !important; }
    .gate-body { justify-content: flex-start; padding-top: 48px; }
  }
</style>
