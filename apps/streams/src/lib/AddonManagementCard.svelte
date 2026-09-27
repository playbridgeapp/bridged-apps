<script lang="ts">
  import { ArrowDown, ArrowUp, Copy, ExternalLink, RefreshCw, Settings2, Trash2 } from 'lucide-svelte';
  import { configureUrl, supportedFeatures } from './addon-settings';
  import type { AddonFeature } from './addon-settings';
  import type { InstalledAddon } from './types';

  export let addon: InstalledAddon;
  export let source: 'local' | 'stremio' | 'nuvio';
  export let index: number;
  export let total: number;
  export let busy = false;
  export let readOnly = false;
  export let onToggle: (enabled: boolean) => void;
  export let onFeature: (feature: AddonFeature, enabled: boolean) => void;
  export let onMove: (direction: -1 | 1) => void;
  export let onRefresh: () => void;
  export let onCopy: () => void;
  export let onDelete: () => void;

  let expanded = false;
  const labels: Record<AddonFeature, string> = { catalog: 'Catalogs', meta: 'Metadata', stream: 'Streams', subtitles: 'Subtitles' };
  const descriptions: Record<AddonFeature, string> = {
    catalog: 'Browse rows and discovery', meta: 'Titles, posters, and episodes',
    stream: 'Playable source lookup', subtitles: 'Subtitle lookup'
  };
  $: features = supportedFeatures(addon);
  $: enabled = addon.enabled !== false;
</script>

<div class:disabled={!enabled} class="addon-management-card">
  <div class="addon-management-head">
    <div class="addon-logo">{source === 'stremio' ? 'S' : source === 'nuvio' ? 'N' : 'A'}</div>
    <div class="addon-info"><strong>{addon.manifest.name}</strong><small>{addon.manifest.version ? `v${addon.manifest.version} · ` : ''}{features.length ? features.map((feature) => labels[feature]).join(' · ') : 'Manifest unavailable'}</small></div>
    <label class="addon-master"><span>{enabled ? 'On' : 'Off'}</span><input type="checkbox" checked={enabled} disabled={busy || readOnly} onchange={(event) => onToggle(event.currentTarget.checked)} aria-label={`${enabled ? 'Disable' : 'Enable'} ${addon.manifest.name}`} /></label>
  </div>
  {#if addon.manifest.description}<p class="addon-management-description">{addon.manifest.description}</p>{/if}
  {#if addon.loadError}<p class="addon-management-error">{addon.loadError}</p>{/if}
  <div class="addon-management-actions">
    <button type="button" onclick={() => onMove(-1)} disabled={busy || readOnly || index === 0} aria-label={`Move ${addon.manifest.name} up`} title="Move up"><ArrowUp size={16} /></button>
    <button type="button" onclick={() => onMove(1)} disabled={busy || readOnly || index === total - 1} aria-label={`Move ${addon.manifest.name} down`} title="Move down"><ArrowDown size={16} /></button>
    <button type="button" onclick={onRefresh} disabled={busy} aria-label={`Refresh ${addon.manifest.name}`} title="Refresh manifest"><RefreshCw size={16} /></button>
    <button type="button" onclick={onCopy} aria-label={`Copy ${addon.manifest.name} URL`} title="Copy manifest URL"><Copy size={16} /></button>
    {#if addon.manifest.behaviorHints?.configurable}<a href={configureUrl(addon.manifestUrl)} target="_blank" rel="noopener noreferrer" aria-label={`Configure ${addon.manifest.name}`} title="Open configuration page"><ExternalLink size={16} /></a>{:else}<a href={addon.manifestUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${addon.manifest.name} manifest`} title="Open manifest"><ExternalLink size={16} /></a>{/if}
    <button type="button" onclick={() => expanded = !expanded} class:active={expanded} aria-expanded={expanded} aria-label={`Features for ${addon.manifest.name}`} title="Feature controls"><Settings2 size={16} /></button>
    {#if !(source === 'stremio' && addon.flags?.protected)}<button type="button" class="danger" onclick={onDelete} disabled={busy || readOnly} aria-label={`Remove ${addon.manifest.name}`} title="Remove addon"><Trash2 size={16} /></button>{/if}
  </div>
  {#if expanded}
    <div class="addon-features"><div class="addon-features-heading">Addon features <small>These switches apply in this browser.</small></div>
      {#if features.length}
        {#each features as feature}<label class="addon-feature"><span><strong>{labels[feature]}</strong><small>{descriptions[feature]}</small></span><input type="checkbox" checked={!addon.disabledFeatures?.includes(feature)} disabled={busy || !enabled} onchange={(event) => onFeature(feature, event.currentTarget.checked)} /></label>{/each}
      {:else}<p class="row-empty">This manifest declares no supported features.</p>{/if}
      {#if source === 'nuvio'}<p class="addon-feature-note">The main On/Off switch and order sync to Nuvio. Feature switches stay in this browser.</p>{:else if source === 'stremio'}<p class="addon-feature-note">Stremio keeps the addon installed; these switches stay in this browser.</p>{/if}
    </div>
  {/if}
</div>
