<script lang="ts">
  import { ChevronDown } from 'lucide-svelte';
  import { RELEASE_TYPES } from './stream-selection';
  import type { ReleaseType, StreamSelectionPreferences } from './stream-selection';
  export let preferences: StreamSelectionPreferences;
  export let providers: { id: string; name: string }[] = [];
  export let onChange: (preferences: StreamSelectionPreferences) => void;

  function toggleRelease(type: ReleaseType) {
    onChange({ ...preferences, releaseTypes: preferences.releaseTypes.includes(type)
      ? preferences.releaseTypes.filter((value) => value !== type) : [...preferences.releaseTypes, type] });
  }
</script>

<section class="selection-settings" aria-label="Stream selection settings">
  <label class="playback-fallback-control"><span><strong>Auto-select stream</strong><small>Play or Resume starts a matching stream. If none match, choose one from the stream list.</small></span><input type="checkbox" role="switch" checked={preferences.enabled} onchange={(event) => onChange({ ...preferences, enabled: event.currentTarget.checked })} aria-label="Auto-select stream" /></label>
  <div class="selection-fields">
    <label><span>Preferred resolution</span><div class="select-wrap"><select aria-label="Preferred resolution" value={preferences.resolution} onchange={(event) => onChange({ ...preferences, resolution: event.currentTarget.value as StreamSelectionPreferences['resolution'] })}><option value="any">Any resolution</option><option value="2160p">4K</option><option value="1080p">1080p</option><option value="720p">720p</option></select><ChevronDown size={16} /></div></label>
    <label><span>Preferred provider</span><div class="select-wrap"><select aria-label="Preferred provider" value={preferences.provider} onchange={(event) => onChange({ ...preferences, provider: event.currentTarget.value })}><option value="">Any provider</option>{#if preferences.provider && !providers.some((provider) => provider.id === preferences.provider)}<option value={preferences.provider}>Unavailable provider</option>{/if}{#each providers as provider (provider.id)}<option value={provider.id}>{provider.name}</option>{/each}</select><ChevronDown size={16} /></div></label>
  </div>
  <fieldset><legend>Release types</legend><div class="release-chips">{#each RELEASE_TYPES as type}<button type="button" class:chosen={preferences.releaseTypes.includes(type.key)} aria-pressed={preferences.releaseTypes.includes(type.key)} onclick={() => toggleRelease(type.key)}>{type.label}</button>{/each}</div><p>{preferences.releaseTypes.length ? 'Use any selected release type. Resolution and release type must match; the provider is a preference.' : 'Any release type. Select one or more to limit automatic selection.'}</p></fieldset>
  <p class="selection-hint">Unknown quality or release information cannot match a specific filter. You can always choose a stream manually.</p>
</section>

<style>
  .selection-settings{padding:14px 0 22px;border-bottom:1px solid #ffffff1b;margin-bottom:22px}
  .selection-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:18px 0}
  .selection-fields label{min-width:0;display:grid;gap:9px;font-size:12px;color:#bac8ce}
  .select-wrap{position:relative;display:flex;align-items:center}
  select{appearance:none;width:100%;min-width:0;border:1px solid #ffffff30;border-radius:12px;background:#ffffff09;color:#eef5f2;padding:12px 34px 12px 12px;font:inherit;font-size:13px;cursor:pointer}
  option{color:#eef5f2;background:#171d23}
  .select-wrap :global(svg){position:absolute;right:12px;pointer-events:none;color:#b6c6c7}
  fieldset{border:0;padding:0;margin:20px 0 0;min-width:0}
  legend{font-size:12px;color:#bac8ce;margin-bottom:11px}
  .release-chips{display:flex;flex-wrap:wrap;gap:8px}
  .release-chips button{border:1px solid #ffffff25;border-radius:999px;background:#ffffff08;color:#b4c2c9;padding:9px 13px;font:inherit;font-size:12px;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
  .release-chips button.chosen{background:#9debd21d;border-color:#9debd275;color:#b4f3df}
  p{font-size:11px;line-height:1.6;color:#8ea0ab;margin:12px 0 0}
  .selection-hint{margin-top:6px}
  select:focus-visible,button:focus-visible{outline:2px solid #9debd2;outline-offset:3px}
  @media(max-width:480px){.selection-fields{grid-template-columns:1fr}}
  @media(prefers-reduced-motion:reduce){.release-chips button{transition:none}}
</style>
