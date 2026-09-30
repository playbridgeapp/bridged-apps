<script lang="ts">
  import { onMount } from 'svelte';
  import { LoaderCircle, X } from 'lucide-svelte';
  import { fetchPluginSettingsLayout, type PluginSettingsField } from './plugins';
  import type { PluginRepository, PluginScraper } from './types';

  export let repo: PluginRepository;
  export let scraper: PluginScraper;
  export let tmdbKey: string;
  export let synced = false;
  export let onClose: () => void;
  export let onSave: (settings: Record<string, unknown>) => Promise<void>;
  let layout: PluginSettingsField[] = [];
  let draft = { ...scraper.settings };
  let loading = true;
  let saving = false;
  let error = '';
  let closeButton: HTMLButtonElement;

  onMount(() => {
    let active = true;
    closeButton?.focus();
    void fetchPluginSettingsLayout(repo, scraper, tmdbKey).then((fields) => {
      if (!active) return;
      layout = fields;
      for (const field of fields) {
        if (field.key && draft[field.key] === undefined && field.defaultValue !== undefined) {
          draft = { ...draft, [field.key]: field.defaultValue };
        }
      }
    }).catch((cause) => { if (active) error = cause instanceof Error ? cause.message : 'Could not load scraper settings.'; })
      .finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });

  async function save() {
    saving = true;
    error = '';
    try { await onSave(draft); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save settings. Try again.'; }
    finally { saving = false; }
  }
</script>

<div class="overlay plugin-settings-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
  <div class="manage-panel plugin-settings-panel" role="dialog" aria-modal="true" aria-label={`${scraper.name} settings`}>
  <form onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <div class="panel-header"><div><div class="eyebrow">SCRAPER SETTINGS</div><h2>{scraper.name}</h2></div><button bind:this={closeButton} type="button" class="icon-button" aria-label="Close scraper settings" onclick={onClose} disabled={saving}><X size={20} /></button></div>
    <p class="panel-copy">{synced ? 'Saved to this Nuvio profile and synced between Bridged Streams devices.' : 'Saved in this browser.'}</p>
    {#if loading}<p class="loading-layout"><LoaderCircle size={18} class="spin" /> Loading settings…</p>{:else}
      {#each layout as field}
        {#if field.type === 'header'}<h3>{field.label}</h3>
        {:else if field.type === 'info'}<p class="panel-copy">{field.label}</p>
        {:else if field.key && field.type === 'toggle'}
          <label class="toggle-field"><span>{field.label}{#if field.description}<small>{field.description}</small>{/if}</span><input type="checkbox" checked={draft[field.key] === true} onchange={(event) => { draft = { ...draft, [field.key!]: event.currentTarget.checked }; }} disabled={saving} /></label>
        {:else if field.key && field.type === 'select'}
          <label>{field.label}<select value={String(draft[field.key] ?? '')} onchange={(event) => { draft = { ...draft, [field.key!]: event.currentTarget.value }; }} disabled={saving}>
            {#if !field.options?.some((option) => option.value === String(draft[field.key!] ?? ''))}<option value={String(draft[field.key] ?? '')}>{String(draft[field.key] ?? '') || 'Select an option'}</option>{/if}
            {#each field.options || [] as option}<option value={option.value}>{option.label}</option>{/each}
          </select>{#if field.description}<small>{field.description}</small>{/if}</label>
        {:else if field.key && (field.type === 'text' || field.type === 'number')}
          <label>{field.label}<input type={field.isPassword ? 'password' : field.type === 'number' ? 'number' : 'text'} value={String(draft[field.key] ?? '')} placeholder={field.placeholder || ''} autocomplete="off" oninput={(event) => { draft = { ...draft, [field.key!]: field.type === 'number' ? Number(event.currentTarget.value) : event.currentTarget.value }; }} disabled={saving} />{#if field.description}<small>{field.description}</small>{/if}</label>
        {:else}<p class="panel-copy">{field.label} — this control is not supported in the browser.</p>{/if}
      {/each}
      {#if !layout.length && !error}<p class="panel-copy">This scraper has no configurable settings.</p>{/if}
    {/if}
    {#if error}<p class="error-message" role="alert">{error}</p>{/if}
    <div class="settings-actions"><button type="button" class="sync-button" onclick={onClose} disabled={saving}>Cancel</button><button type="submit" class="sync-button save-button" disabled={loading || saving || !layout.length}>{#if saving}<LoaderCircle size={16} class="spin" /> Saving…{:else}Save{/if}</button></div>
  </form>
  </div>
</div>

<style>
  .plugin-settings-overlay { z-index: 150; }
  .plugin-settings-panel { max-width: 540px; }
  label { display: flex; flex-direction: column; gap: 8px; margin: 18px 0; font-size: .9rem; }
  input:not([type="checkbox"]), select { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #ffffff22; border-radius: 12px; background: #ffffff09; color: inherit; font: inherit; }
  select option { background: #171923; }
  small { display: block; color: #a4a8b5; font-size: .8rem; line-height: 1.5; }
  .toggle-field { flex-direction: row; align-items: center; justify-content: space-between; }
  .toggle-field input { width: 20px; height: 20px; }
  h3 { margin-top: 24px; font-size: 1rem; }
  .loading-layout, .settings-actions { display: flex; align-items: center; gap: 10px; }
  .settings-actions { justify-content: flex-end; margin-top: 24px; }
  .save-button { background: #fff; color: #111; }
</style>
