<script lang="ts">
  import { bridgeStatus, playbackDestination, destinationBusy, playbackError, queueError, choosePlaybackDestination, retryQueue } from '../cast/playbridge';
  import { playbackBusy, browserRecoveryAvailable, recoverBrowserPlayback, localPlaybackMode } from '../stores/appState';
  export let compact = false;
</script>

<div class="destination-row" class:compact>
  {#if $bridgeStatus.playback}
    <button class="btn-secondary" on:click={() => choosePlaybackDestination()} disabled={$destinationBusy || $playbackBusy}
      aria-label="Change playback destination">
      {#if $destinationBusy}Choosing device…{:else if !$playbackDestination}Choose playback device{:else}
        Plays on {$playbackDestination.kind === 'local' ? 'This device' : $playbackDestination.name}
        {#if !$playbackDestination.connected} · Disconnected{/if}
      {/if}
    </button>
    {#if $playbackDestination?.kind === 'local'}
      <label>Player
        <select aria-label="This device player" bind:value={$localPlaybackMode} disabled={$destinationBusy || $playbackBusy}>
          <option value="browser">Browser player (default)</option>
          <option value="native">PlayBridge player</option>
        </select>
      </label>
    {/if}
  {:else}
    <span>Plays in this browser{#if $bridgeStatus.available} · Legacy PlayBridge casting available{/if}</span>
  {/if}
  {#if $playbackBusy}<span role="status">Preparing playback…</span>{/if}
  {#if $playbackError}
    <p role="alert">{$playbackError}</p>
    {#if $browserRecoveryAvailable}<button class="btn-secondary" on:click={recoverBrowserPlayback} disabled={$playbackBusy}>Play in browser</button>{/if}
    {#if $bridgeStatus.playback}
      <button class="btn-secondary" on:click={() => choosePlaybackDestination(true)} disabled={$destinationBusy || $playbackBusy}>Choose This device</button>
    {/if}
  {/if}
  {#if $queueError}<p role="alert">{$queueError}</p><button class="btn-secondary" on:click={retryQueue}>Retry queue</button>{/if}
</div>

<style>
  .destination-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 12px 36px; font-size: 13px; color: var(--text-secondary); }
  @media (max-width: 768px) { .destination-row { margin: 12px 14px; } }
  .destination-row.compact { margin: 12px 0; }
  p { flex-basis: 100%; margin: 0; color: #f0b0a8; }
  button { padding: 8px 12px; font-size: 13px; }
  label { display: flex; align-items: center; gap: 8px; }
  select { padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-surface); color: var(--text-primary); font-size: 13px; }
</style>
