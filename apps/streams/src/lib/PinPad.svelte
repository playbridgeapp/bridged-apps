<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ArrowLeft, Delete } from 'lucide-svelte';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import type { NuvioProfile } from './nuvio';
  import type { PinResult } from './profile-launch';

  export let profile: NuvioProfile;
  export let image: string | null = null;
  export let onSubmit: (pin: string) => Promise<PinResult>;
  export let onBack: () => void;

  const LENGTH = 4;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'];
  let pin = '';
  let checking = false;
  let error = '';
  let shake = false;
  let waitUntil = 0;
  let now = Date.now();
  let timer: number | undefined;
  let input: HTMLInputElement;

  $: waitSeconds = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  $: blocked = checking || waitSeconds > 0;
  $: message = waitSeconds > 0 ? `Too many attempts. Try again in ${waitSeconds}s.` : checking ? 'Checking…' : error;

  onMount(() => { if (window.matchMedia('(pointer: fine)').matches) input?.focus(); });
  onDestroy(() => window.clearInterval(timer));

  function update(next: string) {
    if (blocked) return;
    pin = next.replace(/\D/g, '').slice(0, LENGTH);
    if (pin) { error = ''; shake = false; }
    if (pin.length === LENGTH) void submit();
  }

  async function submit() {
    checking = true;
    const result = await onSubmit(pin);
    checking = false;
    if (result.ok) return;
    pin = '';
    error = result.message;
    shake = false;
    requestAnimationFrame(() => { shake = true; });
    if (result.retryAfterSeconds && result.retryAfterSeconds > 0) {
      waitUntil = Date.now() + result.retryAfterSeconds * 1000;
      now = Date.now();
      window.clearInterval(timer);
      timer = window.setInterval(() => { now = Date.now(); if (now >= waitUntil) window.clearInterval(timer); }, 500);
    }
  }

  function press(key: string) {
    update(key === 'delete' ? pin.slice(0, -1) : pin + key);
    if (window.matchMedia('(pointer: fine)').matches) input?.focus();
  }
</script>

<div class="pin-pad">
  <button class="pin-back" type="button" onclick={onBack}><ArrowLeft size={20} /> Profiles</button>
  <div class="pin-head">
    <ProfileAvatar {profile} {image} size={92} locked />
    <h2>Enter PIN for {profile.name || `Profile ${profile.profile_index}`}</h2>
    <label class="pin-dots" class:shake class:error={!!error && !checking}>
      <span class="visually-hidden">Profile PIN</span>
      <input bind:this={input} type="password" inputmode="numeric" autocomplete="off" maxlength={LENGTH} value={pin} disabled={blocked}
        aria-describedby="pin-message" oninput={(event) => update(event.currentTarget.value)} />
      {#each Array(LENGTH) as _, index}<span class="dot" class:filled={index < pin.length} aria-hidden="true"></span>{/each}
    </label>
    <p id="pin-message" class="pin-message" class:error={!!error && !checking} role="status">{message}</p>
  </div>
  <div class="pin-keys">
    {#each keys as key}
      {#if key === ''}<span></span>
      {:else if key === 'delete'}<button class="pin-key quiet" type="button" aria-label="Delete last digit" disabled={blocked || !pin} onclick={() => press(key)}><Delete size={26} /></button>
      {:else}<button class="pin-key" type="button" disabled={blocked} onclick={() => press(key)}>{key}</button>{/if}
    {/each}
  </div>
  <p class="pin-help">Forgot the PIN? Reset it in the Nuvio app. Nuvio checks the PIN; it isn't stored here.</p>
</div>

<style>
  .pin-pad { display: flex; flex-direction: column; align-items: center; width: min(100%, 360px); margin: 0 auto; }
  .pin-back { align-self: flex-start; display: flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 12px 0 6px; margin-left: -6px; border: 0; border-radius: 999px; background: none; color: #d6dadf; font-size: 14px; font-weight: 700; }
  .pin-back:hover { background: #ffffff12; color: #fff; }
  .pin-head { display: flex; flex-direction: column; align-items: center; margin-top: 18px; }
  h2 { margin: 18px 0 0; font-size: 22px; letter-spacing: -.02em; text-align: center; }
  .pin-dots { position: relative; display: flex; gap: 18px; margin: 28px 0 14px; padding: 10px 14px; border-radius: 999px; cursor: text; }
  .pin-dots:focus-within { outline: 2px solid #66e9c4; outline-offset: 2px; }
  .pin-dots input { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; color: transparent; caret-color: transparent; font-size: 16px; opacity: 0.01; }
  .pin-dots input:focus-visible { outline: none; }
  .dot { width: 16px; height: 16px; box-sizing: border-box; border: 2px solid #6b737d; border-radius: 50%; transition: background .12s, border-color .12s; }
  .dot.filled { border-color: #f4f5f4; background: #f4f5f4; }
  .pin-dots.error .dot { border-color: #ff9b9b; }
  .pin-message { min-height: 20px; margin: 0; color: #c9cdd2; font-size: 14px; font-weight: 700; text-align: center; }
  .pin-message.error { color: #ff9b9b; }
  .pin-keys { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 18px; width: 100%; margin-top: 26px; }
  .pin-key { height: 64px; border: 0; border-radius: 999px; background: #161a20; color: #f7f7f7; font-family: Manrope, sans-serif; font-size: 26px; font-weight: 700; }
  .pin-key:hover:not(:disabled) { background: #222831; }
  .pin-key:active:not(:disabled) { background: #2c333d; }
  .pin-key.quiet { display: grid; place-items: center; background: transparent; }
  .pin-key:disabled { opacity: .35; cursor: not-allowed; }
  .pin-help { margin: 26px 0 0; color: #9aa1a9; font-size: 12px; line-height: 1.6; text-align: center; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .shake { animation: shake .36s; }
  @keyframes shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-10px); } 40% { transform: translateX(9px); } 60% { transform: translateX(-6px); } 80% { transform: translateX(4px); } }
  @media (prefers-reduced-motion: reduce) { .shake { animation: none; } }
</style>
