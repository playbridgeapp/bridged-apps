<script lang="ts">
  import {
    connectToJellyfinServer,
    loadDemoMode,
    isLoadingLibrary,
    serverError,
    savedAccounts,
    switchAccount,
    removeSavedAccount
  } from '../stores/appState';
  import { cleanServerUrl, pingServer } from '../api/jellyfin';
  import { bridgeStatus } from '../cast/playbridge';
  import {
    Server,
    User,
    Lock,
    Globe,
    Sparkles,
    AlertCircle,
    Loader2,
    Cast,
    ShieldCheck,
    ArrowRight,
    Plus,
    Trash2,
    Layers
  } from 'lucide-svelte';

  let serverUrl = '';
  let username = '';
  let password = '';
  let rememberMe = true;
  let currentStep: 'saved' | 'server' | 'auth' = $savedAccounts.length > 0 ? 'saved' : 'server';
  let serverInfo: { serverName: string; version: string } | null = null;
  let localLoading = false;
  let localError: string | null = null;

  $: if ($savedAccounts.length === 0 && currentStep === 'saved') {
    currentStep = 'server';
  }

  async function handleCheckServer() {
    if (!serverUrl.trim()) return;
    localLoading = true;
    localError = null;
    try {
      const cleanUrl = cleanServerUrl(serverUrl);
      serverUrl = cleanUrl;

      const ping = await pingServer(cleanUrl);
      serverInfo = ping;
      currentStep = 'auth';
    } catch (err: any) {
      localError = err.message || 'Could not connect to Jellyfin server at this address.';
    } finally {
      localLoading = false;
    }
  }

  async function handleLogin() {
    if (!username.trim()) return;
    localLoading = true;
    localError = null;
    try {
      await connectToJellyfinServer(serverUrl, username, password, rememberMe);
    } catch (err: any) {
      localError = err.message || 'Login failed. Please check your credentials.';
    } finally {
      localLoading = false;
    }
  }

  function handleQuickSwitch(acc: any) {
    switchAccount(acc);
  }
</script>

<div class="login-wrapper">
  <div class="login-background">
    <div class="glow-sphere sphere-1"></div>
    <div class="glow-sphere sphere-2"></div>
  </div>

  <div class="login-card glass-card">
    <div class="brand-header">
      <div class="logo-box">
        <svg viewBox="0 0 100 100" fill="none" class="brand-svg">
          <path d="M50 16 L84 76 L66 76 L50 46 L34 76 L16 76 Z" fill="url(#login-brand-cine-grad)"/>
          <defs>
            <linearGradient id="login-brand-cine-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#95FF50"/>
              <stop offset="100%" stop-color="#43861E"/>
            </linearGradient>
          </defs>
        </svg>
      </div>

      <h1 class="login-title">PlayBridge Jellyfin</h1>
      <div class="bridge-tag">
        <Cast size={13} />
        <span>Multi-Server Casting Suite</span>
      </div>
    </div>

    <!-- Status Banner for Bridge -->
    <div class="bridge-banner" class:bridge-active={$bridgeStatus.available}>
      <span class={$bridgeStatus.available ? 'pulsing-dot' : 'static-dot'}></span>
      <span>
        {$bridgeStatus.available
          ? 'PlayBridge Native Bridge Connected — Ready for Direct TV Casting'
          : 'PlayBridge Bridge Ready (In-browser playback + Cast payload inspector)'}
      </span>
    </div>

    {#if localError || $serverError}
      <div class="error-box">
        <AlertCircle size={16} />
        <span>{localError || $serverError}</span>
      </div>
    {/if}

    {#if currentStep === 'saved' && $savedAccounts.length > 0}
      <!-- Screen 0: Saved Profiles & Servers Picker -->
      <div class="saved-profiles-section">
        <h3 class="section-title">Select Server & Profile</h3>
        <p class="section-sub">Choose a saved server account to sign in instantly</p>

        <div class="profiles-grid">
          {#each $savedAccounts as acc (acc.id)}
            <div class="profile-card" on:click={() => handleQuickSwitch(acc)}>
              <button
                class="del-profile-btn"
                on:click|stopPropagation={() => removeSavedAccount(acc.id)}
                title="Remove saved account"
              >
                <Trash2 size={13} />
              </button>

              <div class="profile-avatar">
                {acc.username.slice(0, 2).toUpperCase()}
              </div>

              <div class="profile-meta">
                <span class="profile-name">{acc.username}</span>
                <span class="profile-server">{acc.serverName}</span>
                <span class="profile-url">{acc.url}</span>
              </div>
            </div>
          {/each}
        </div>

        <button class="btn-secondary add-server-btn" on:click={() => (currentStep = 'server')}>
          <Plus size={16} />
          <span>Connect Another Server / Account</span>
        </button>
      </div>
    {:else if currentStep === 'server'}
      <!-- Step 1: Server URL -->
      <form class="login-form" on:submit|preventDefault={handleCheckServer}>
        {#if $savedAccounts.length > 0}
          <button type="button" class="back-to-profiles" on:click={() => (currentStep = 'saved')}>
            &larr; Back to Saved Profiles
          </button>
        {/if}

        <div class="input-group">
          <label for="server-address">Jellyfin Server URL</label>
          <div class="input-field">
            <Globe size={18} class="input-icon" />
            <input
              id="server-address"
              type="text"
            placeholder="http://your-server:8096"
              bind:value={serverUrl}
              required
              autofocus
            />
          </div>
          <span class="input-hint">Enter your local LAN IP or public domain.</span>
        </div>

        <button type="submit" class="btn-primary submit-btn" disabled={localLoading || !serverUrl}>
          {#if localLoading}
            <Loader2 size={18} class="spinner" />
            <span>Checking Server...</span>
          {:else}
            <span>Next</span>
            <ArrowRight size={18} />
          {/if}
        </button>
      </form>
    {:else}
      <!-- Step 2: User Login -->
      <form class="login-form" on:submit|preventDefault={handleLogin}>
        <div class="server-pill-row">
          <div class="server-connected-pill">
            <ShieldCheck size={14} class="pill-check" />
            <span>{serverInfo?.serverName || 'Jellyfin Server'}</span>
          </div>
          <button type="button" class="change-server-btn" on:click={() => (currentStep = 'server')}>
            Change Server
          </button>
        </div>

        <div class="input-group">
          <label for="user-name">Username</label>
          <div class="input-field">
            <User size={18} class="input-icon" />
            <input
              id="user-name"
              type="text"
              placeholder="Enter username"
              bind:value={username}
              required
              autofocus
            />
          </div>
        </div>

        <div class="input-group">
          <label for="user-pass">Password</label>
          <div class="input-field">
            <Lock size={18} class="input-icon" />
            <input
              id="user-pass"
              type="password"
              placeholder="Password (if set)"
              bind:value={password}
            />
          </div>
        </div>

        <label class="remember-row">
          <input type="checkbox" bind:checked={rememberMe} />
          <span>Save this account for fast multi-server switching</span>
        </label>

        <button type="submit" class="btn-accent submit-btn" disabled={localLoading || !username}>
          {#if localLoading}
            <Loader2 size={18} class="spinner" />
            <span>Signing in & loading library...</span>
          {:else}
            <span>Sign In to Jellyfin</span>
          {/if}
        </button>
      </form>
    {/if}

    <div class="demo-fallback">
      <div class="or-divider"><span>or</span></div>
      <button class="btn-secondary demo-btn" on:click={loadDemoMode}>
        <Sparkles size={16} />
        <span>Explore with Demo Library</span>
      </button>
    </div>
  </div>
</div>

<style>
  .login-wrapper {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    position: relative;
    background-color: var(--theme-root-bg);
    overflow: hidden;
  }

  .login-background {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .glow-sphere {
    position: absolute;
    border-radius: 50%;
    filter: blur(90px);
    opacity: 0.22;
  }

  .sphere-1 {
    width: 420px;
    height: 420px;
    background: var(--theme-primary-accent);
    top: -100px;
    right: -60px;
  }

  .sphere-2 {
    width: 480px;
    height: 480px;
    background: var(--theme-global-accent-b);
    bottom: -150px;
    left: -100px;
  }

  .login-card {
    position: relative;
    z-index: 10;
    width: 100%;
    max-width: 480px;
    border-radius: var(--radius-xl);
    padding: 44px 38px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85);
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .brand-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    margin-bottom: 24px;
  }

  .logo-box {
    width: 58px;
    height: 58px;
    margin-bottom: 12px;
    filter: drop-shadow(0 0 14px rgba(149, 255, 80, 0.4));
  }

  .brand-svg {
    width: 100%;
    height: 100%;
  }

  .login-title {
    font-size: 1.65rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #ffffff;
  }

  .bridge-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--theme-primary-accent);
    background-color: rgba(149, 255, 80, 0.12);
    border: 1px solid rgba(149, 255, 80, 0.3);
    padding: 3px 12px;
    border-radius: var(--radius-full);
    margin-top: 6px;
  }

  .bridge-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background-color: rgba(30, 23, 40, 0.7);
    border: 1px solid rgba(122, 107, 174, 0.25);
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-bottom: 24px;
    line-height: 1.35;
  }

  .bridge-banner.bridge-active {
    background-color: rgba(149, 255, 80, 0.08);
    border-color: rgba(149, 255, 80, 0.3);
    color: #ffffff;
  }

  .static-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--text-muted);
    flex-shrink: 0;
  }

  .pulsing-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--theme-primary-accent);
    box-shadow: 0 0 8px var(--theme-primary-accent);
    animation: pulse 1.8s infinite;
    flex-shrink: 0;
  }

  @keyframes pulse {
    0% { transform: scale(0.9); opacity: 0.8; }
    50% { transform: scale(1.3); opacity: 1; }
    100% { transform: scale(0.9); opacity: 0.8; }
  }

  .error-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: rgba(248, 81, 73, 0.15);
    border: 1px solid rgba(248, 81, 73, 0.35);
    color: var(--status-error);
    padding: 10px 14px;
    border-radius: var(--radius-md);
    font-size: 0.82rem;
    margin-bottom: 20px;
  }

  /* Saved Profiles Grid */
  .saved-profiles-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 12px;
  }

  .section-title {
    font-size: 1.15rem;
    font-weight: 800;
    color: #fff;
    text-align: center;
  }

  .section-sub {
    font-size: 0.78rem;
    color: var(--theme-type-muted);
    text-align: center;
    margin-top: -10px;
  }

  .profiles-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    max-height: 260px;
    overflow-y: auto;
  }

  .profile-card {
    position: relative;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    background: rgba(30, 23, 40, 0.7);
    border: 1px solid rgba(122, 107, 174, 0.25);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .profile-card:hover {
    background: rgba(48, 39, 65, 0.85);
    border-color: var(--theme-primary-accent);
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.6);
  }

  .profile-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--accent-gradient);
    color: #050505;
    font-weight: 800;
    font-size: 1.05rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .profile-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .profile-name {
    font-size: 0.95rem;
    font-weight: 700;
    color: #fff;
  }

  .profile-server {
    font-size: 0.78rem;
    color: var(--theme-primary-accent-hover);
    font-weight: 500;
  }

  .profile-url {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .del-profile-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 6px;
    border-radius: 50%;
    color: var(--text-muted);
    opacity: 0;
    transition: all 0.15s ease;
  }

  .profile-card:hover .del-profile-btn {
    opacity: 1;
  }

  .del-profile-btn:hover {
    color: var(--status-error);
    background: rgba(248, 81, 73, 0.15);
  }

  .add-server-btn {
    width: 100%;
    padding: 11px;
    font-size: 0.88rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: var(--radius-full);
  }

  .back-to-profiles {
    background: transparent;
    color: var(--theme-primary-accent);
    font-size: 0.82rem;
    font-weight: 700;
    text-align: left;
    margin-bottom: 6px;
    cursor: pointer;
  }

  .back-to-profiles:hover {
    text-decoration: underline;
  }

  .login-form {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .input-group label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .input-field {
    position: relative;
    display: flex;
    align-items: center;
  }

  :global(.input-icon) {
    position: absolute;
    left: 14px;
    color: var(--theme-type-muted);
    pointer-events: none;
  }

  .input-field input {
    width: 100%;
    height: 44px;
    padding: 0 16px 0 42px;
    background-color: rgba(30, 23, 40, 0.7);
    border: 1px solid rgba(122, 107, 174, 0.25);
    border-radius: var(--radius-md);
    color: #ffffff;
    font-size: 0.9rem;
    transition: all 0.2s ease;
  }

  .input-field input:focus {
    outline: none;
    border-color: var(--theme-primary-accent);
    background-color: rgba(44, 34, 60, 0.9);
    box-shadow: 0 0 14px rgba(149, 255, 80, 0.25);
  }

  .input-hint {
    font-size: 0.72rem;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .server-pill-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background-color: rgba(30, 23, 40, 0.7);
    border: 1px solid rgba(122, 107, 174, 0.25);
    border-radius: var(--radius-md);
  }

  .server-connected-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    color: #ffffff;
  }

  :global(.pill-check) {
    color: var(--status-ok);
  }

  .change-server-btn {
    font-size: 0.78rem;
    color: var(--theme-primary-accent);
    font-weight: 700;
  }

  .change-server-btn:hover {
    text-decoration: underline;
  }

  .remember-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .submit-btn {
    width: 100%;
    height: 46px;
    font-size: 0.94rem;
    border-radius: var(--radius-full);
    margin-top: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .demo-fallback {
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .or-divider {
    display: flex;
    align-items: center;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
  }

  .or-divider::before,
  .or-divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid rgba(122, 107, 174, 0.2);
  }

  .or-divider span {
    padding: 0 10px;
  }

  .demo-btn {
    width: 100%;
    height: 42px;
    font-size: 0.88rem;
    border-radius: var(--radius-full);
  }

  @media (max-width: 480px) {
    .login-card {
      padding: 28px 20px;
    }
  }
</style>
