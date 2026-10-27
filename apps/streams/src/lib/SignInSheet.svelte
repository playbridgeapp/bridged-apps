<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowLeft, Eye, EyeOff, LoaderCircle, Server } from 'lucide-svelte';

  export let provider: 'nuvio' | 'stremio';
  export let email = '';
  export let password = '';
  export let busy = false;
  export let error = '';
  export let message = '';
  export let onSubmit: () => void;
  export let onClose: () => void;
  /** The provider this sign-in replaces; Streams uses one account at a time. */
  export let replacing = '';
  // Stremio
  export let loginMode: 'password' | 'key' = 'password';
  export let authKey = '';
  // Nuvio
  export let backend = '';
  export let publishableKey = '';
  export let defaultBackend = '';
  export let onDiscover: () => void = () => {};
  export let onUseCloud: () => void = () => {};

  let showPassword = false;
  let serverOpen = false;
  let first: HTMLInputElement;
  $: name = provider === 'nuvio' ? 'Nuvio' : 'Stremio';
  $: customServer = provider === 'nuvio' && backend.replace(/\/+$/, '') !== defaultBackend.replace(/\/+$/, '');
  $: serverLabel = customServer ? hostname(backend) : 'Nuvio Cloud';

  onMount(() => { if (window.matchMedia('(pointer: fine)').matches) first?.focus(); });

  function hostname(value: string): string {
    try { return new URL(value).host || value; } catch { return value || 'Custom server'; }
  }
</script>

<div class="signin-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
  <div class="signin-sheet" role="dialog" aria-modal="true" aria-label={`Sign in to ${name}`}>
    <button class="signin-back" type="button" onclick={onClose}><ArrowLeft size={20} /> Back</button>
    <span class="signin-mark" class:stremio={provider === 'stremio'} aria-hidden="true">{name[0]}</span>
    <h2>Sign in to {name}</h2>
    <p class="signin-copy">{provider === 'nuvio' ? "Use the account from the Nuvio app. You'll pick a profile next." : 'Imports your addons, library and Continue Watching.'}</p>

    {#if replacing}<p class="signin-replacing" role="note">Signing in will sign out of {replacing} in this browser. Its watching changes sync first.</p>{/if}

    {#if provider === 'stremio'}
      <div class="signin-switch" role="group" aria-label="Sign-in method">
        <button type="button" class:active={loginMode === 'password'} aria-pressed={loginMode === 'password'} onclick={() => loginMode = 'password'}>Email</button>
        <button type="button" class:active={loginMode === 'key'} aria-pressed={loginMode === 'key'} onclick={() => loginMode = 'key'}>Auth key</button>
      </div>
    {/if}

    <form class="signin-form" onsubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      {#if provider === 'stremio' && loginMode === 'key'}
        <label>Stremio auth key<input bind:this={first} type="password" bind:value={authKey} autocomplete="off" required placeholder="Paste your auth key" /></label>
        <p class="signin-hint">For accounts that sign in with Facebook or Apple. Copy the auth key from Stremio's settings.</p>
      {:else}
        <label>Email<input bind:this={first} type="email" bind:value={email} autocomplete="username" required placeholder="you@example.com" /></label>
        <div class="signin-field">
          <label for={`signin-password-${provider}`}>Password</label>
          <span class="signin-password">
            <input id={`signin-password-${provider}`} type={showPassword ? 'text' : 'password'} bind:value={password} autocomplete="current-password" required placeholder={`Your ${name} password`} />
            <button type="button" onclick={() => showPassword = !showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'}>{#if showPassword}<EyeOff size={19} />{:else}<Eye size={19} />{/if}</button>
          </span>
        </div>
        {#if provider === 'stremio'}<a class="signin-link" href={`https://www.strem.io/reset-password/${encodeURIComponent(email.trim())}`} target="_blank" rel="noopener noreferrer">Forgot password?</a>{/if}
      {/if}

      {#if provider === 'nuvio'}
        <button class="signin-server" type="button" aria-expanded={serverOpen} onclick={() => serverOpen = !serverOpen}>
          <Server size={18} />
          <span><small>SERVER</small>{serverLabel}</span>
          <strong>{serverOpen ? 'Done' : 'Change'}</strong>
        </button>
        {#if serverOpen}
          <div class="signin-advanced">
            <label>Backend URL<input type="url" bind:value={backend} required placeholder="https://nuvio.example.com" /></label>
            <button class="signin-small" type="button" onclick={onDiscover} disabled={busy}>Get public settings from backend</button>
            <label>Public publishable key<input type="text" bind:value={publishableKey} autocomplete="off" required placeholder="Nuvio public client key" /></label>
            {#if customServer}<button class="signin-small" type="button" onclick={onUseCloud}>Use Nuvio Cloud</button>{/if}
          </div>
        {/if}
      {/if}

      <button class="signin-submit" type="submit" disabled={busy}>{#if busy}<LoaderCircle size={18} class="spin" />{/if} Sign in</button>
    </form>
    {#if message}<p class="sync-message" role="status">{message}</p>{/if}
    {#if error}<p class="error-message" role="alert">{error}</p>{/if}
    {#if provider === 'stremio'}<p class="signin-new">New to Stremio? <a href="https://web.stremio.com/#/intro?form=signup" target="_blank" rel="noopener noreferrer">Create an account</a></p>{/if}
    <p class="signin-hint signin-privacy">{provider === 'nuvio' ? "Your password goes to the selected Nuvio server and isn't saved. The session stays in this browser until you sign out." : "Your password goes straight to Stremio over HTTPS and isn't saved. The session stays in this browser until you sign out."}</p>
  </div>
</div>

<style>
  .signin-overlay { position: fixed; inset: 0; z-index: 55; display: grid; place-items: center; overflow: auto; padding: 24px 16px; background: #02060bd9; backdrop-filter: blur(8px); }
  .signin-sheet { width: min(100%, 440px); box-sizing: border-box; padding: 22px 26px 26px; border: 1px solid #ffffff1f; border-radius: 22px; background: #0f1216; color: #f7f7f7; }
  .signin-back { display: flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 12px 0 6px; margin-left: -6px; border: 0; border-radius: 999px; background: none; color: #d6dadf; font-size: 14px; font-weight: 700; }
  .signin-back:hover { background: #ffffff12; color: #fff; }
  .signin-mark { display: grid; place-items: center; width: 52px; height: 52px; margin-top: 18px; border-radius: 14px; background: #23324a; color: #cfe0ff; font-family: Manrope, sans-serif; font-size: 22px; font-weight: 800; }
  .signin-mark.stremio { background: #2f2846; color: #ddd3ff; }
  h2 { margin: 18px 0 8px; font-family: Georgia, serif; font-size: 32px; line-height: 1.05; letter-spacing: 0; }
  .signin-copy { margin: 0 0 22px; color: #b3b9c0; font-size: 14px; line-height: 1.6; }
  .signin-replacing { margin: -8px 0 20px; padding: 10px 12px; border: 1px solid #6b5a2c; border-radius: 10px; background: #2b2615; color: #f3e2b0; font-size: 13px; line-height: 1.5; }
  .signin-switch { display: flex; gap: 4px; padding: 4px; margin-bottom: 20px; border: 1px solid #ffffff1f; border-radius: 999px; background: #12161b; }
  .signin-switch button { flex: 1; height: 40px; border: 0; border-radius: 999px; background: transparent; color: #b5b8bb; font-size: 13px; font-weight: 800; }
  .signin-switch button.active { background: #f4f5f4; color: #151719; }
  .signin-form { display: flex; flex-direction: column; gap: 16px; }
  .signin-form label, .signin-field { display: flex; flex-direction: column; gap: 7px; color: #d5dade; font-size: 12px; font-weight: 800; }
  .signin-form input { box-sizing: border-box; width: 100%; height: 50px; padding: 0 14px; border: 1px solid #ffffff26; border-radius: 12px; background: #12161b; color: #fff; font-size: 15px; font-weight: 400; }
  .signin-password { position: relative; display: block; }
  .signin-password input { padding-right: 54px; }
  .signin-password button { position: absolute; top: 3px; right: 3px; display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 10px; background: none; color: #b3b9c0; }
  .signin-password button:hover { color: #fff; }
  .signin-link { align-self: flex-end; margin-top: -6px; color: #7fe6c6; font-size: 13px; font-weight: 800; text-decoration: none; }
  .signin-link:hover, .signin-new a:hover { color: #b1f7df; }
  .signin-server { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 14px; border: 1px solid #ffffff1a; border-radius: 12px; background: #101317; color: #d6dadf; text-align: left; }
  .signin-server :global(svg) { flex: none; color: #9aa1a9; }
  .signin-server span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 700; }
  .signin-server small { display: block; color: #9aa1a9; font-size: 11px; font-weight: 800; letter-spacing: .12em; }
  .signin-server strong { color: #7fe6c6; font-size: 13px; }
  .signin-advanced { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid #ffffff1a; border-radius: 12px; background: #0b0e11; }
  .signin-small { align-self: flex-start; min-height: 40px; padding: 0 14px; border: 1px solid #ffffff38; border-radius: 999px; background: none; color: #e4e7ea; font-size: 13px; font-weight: 800; }
  .signin-small:hover { border-color: #ffffff80; }
  .signin-submit { display: flex; align-items: center; justify-content: center; gap: 9px; height: 52px; margin-top: 4px; border: 0; border-radius: 999px; background: #fff; color: #111; font-size: 15px; font-weight: 800; }
  .signin-submit:hover:not(:disabled) { background: #d8d8d8; }
  .signin-hint { margin: -4px 0 0; color: #9aa1a9; font-size: 12px; line-height: 1.55; }
  .signin-privacy { margin: 20px 0 0; text-align: center; }
  .signin-new { margin: 18px 0 0; color: #b3b9c0; font-size: 13px; text-align: center; }
  .signin-new a { color: #7fe6c6; font-weight: 800; text-decoration: none; }
  @media (max-width: 520px) {
    .signin-overlay { padding: 0; place-items: stretch; }
    .signin-sheet { width: 100%; min-height: 100%; border: 0; border-radius: 0; padding: 14px 20px 28px; }
  }
</style>
