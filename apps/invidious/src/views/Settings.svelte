<script lang="ts">
  import { LogIn, LogOut } from 'lucide-svelte';
  import { authorizeUrl } from '../lib/auth.ts';
  import { normalizeInstance } from '../lib/instance.ts';
  import { app } from '../lib/state.svelte.ts';

  let draft = $state(app.instance);
  let error = $state('');
  let signingOut = $state(false);

  function saveInstance(event: SubmitEvent) {
    event.preventDefault();
    const origin = normalizeInstance(draft);
    if (!origin) { error = 'Enter the instance address, like http://192.168.1.10:3000.'; return; }
    error = '';
    draft = origin;
    if (origin !== app.instance) { app.useInstance(origin); app.showToast('Instance saved.'); }
  }

  function signIn() {
    const callback = `${location.origin}${location.pathname}`;
    location.href = authorizeUrl(app.instance, callback);
  }

  async function signOut() {
    signingOut = true;
    await app.signOut();
    signingOut = false;
    app.showToast('Signed out.');
  }
</script>

<div class="page">
  <h1 class="page-title">Settings</h1>
  <div class="settings">
    <form class="panel" onsubmit={saveInstance}>
      <h2>Invidious instance</h2>
      <p>The server this app browses and plays from. Videos stream through it, so your devices never contact YouTube directly.</p>
      <div class="field">
        <label for="instance">Address</label>
        <input id="instance" bind:value={draft} inputmode="url" autocomplete="off" spellcheck="false" />
      </div>
      {#if error}<p class="notice error" style="margin-top:12px">{error}</p>{/if}
      <div class="actions"><button class="btn primary small" type="submit">Save</button></div>
    </form>

    <section class="panel">
      <h2>Playback</h2>
      <label class="toggle">
        <input type="checkbox" checked={app.autoplay} onchange={(event) => app.setAutoplay(event.currentTarget.checked)} />
        <span>
          <strong>Autoplay</strong>
          <small>Play a related video when one ends, and keep the TV’s Up next filled. Playlists always continue to their end.</small>
        </span>
      </label>
    </section>

    <section class="panel">
      <h2>Account</h2>
      {#if app.signedIn}
        <p>Signed in to your Invidious account. Subscriptions, history and playlists come from the instance.</p>
        <div class="actions">
          <button class="btn small" onclick={signOut} disabled={signingOut}><LogOut size={16} />Sign out</button>
        </div>
      {:else}
        <p>Sign in on your instance’s own page; this app never sees your password. You’ll approve access to your subscription feed, subscriptions, watch history and playlists.</p>
        <div class="actions">
          <button class="btn primary small" onclick={signIn} disabled={!app.instance}><LogIn size={16} />Sign in with Invidious</button>
        </div>
      {/if}
    </section>
  </div>
</div>
