<script lang="ts">
  import { normalizeInstance } from '../lib/instance.ts';
  import { app, RELAY_TARGET } from '../lib/state.svelte.ts';

  let draft = $state(RELAY_TARGET);
  let error = $state('');
  let checking = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const origin = normalizeInstance(draft);
    if (!origin) { error = 'Enter the instance address, like http://192.168.1.10:3000.'; return; }
    error = '';
    checking = true;
    try {
      const response = await fetch(`${origin}/api/v1/stats`, { signal: AbortSignal.timeout(10_000) });
      const stats = await response.json().catch(() => null);
      if (stats?.software?.name !== 'invidious') throw new Error();
      app.useInstance(origin);
    } catch {
      error = 'That address didn’t answer like an Invidious instance. Check it and try again.';
    } finally {
      checking = false;
    }
  }
</script>

<div class="setup">
  <form class="setup-card" onsubmit={submit}>
    <img src="/bridged-invidious.svg" alt="" />
    <h1>Connect your instance</h1>
    <p>Enter the address of your Invidious server. Browsing, sign-in and playback all go through it.</p>
    <div class="field">
      <label for="setup-instance">Instance address</label>
      <input id="setup-instance" bind:value={draft} placeholder="http://192.168.1.10:3000" inputmode="url" autocomplete="off" spellcheck="false" />
    </div>
    {#if error}<p class="notice error" style="margin-top:12px">{error}</p>{/if}
    <div class="actions" style="margin-top:18px"><button class="btn primary" type="submit" disabled={checking}>{checking ? 'Checking…' : 'Connect'}</button></div>
  </form>
</div>
