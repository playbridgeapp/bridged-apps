<script lang="ts">
  import { AUTO_PLAY_MODES, LAST_LINK_HOURS, REGEX_PRESETS, RELEASE_TYPES, TIMEOUT_SECONDS, compileStreamRegex, sourceAllowed, streamSource } from './stream-selection';
  import type { ReleaseType, StreamSelectionPreferences } from './stream-selection';
  import type { Stream } from './types';
  export let preferences: StreamSelectionPreferences;
  export let providers: { id: string; name: string; kind: 'addon' | 'plugin' }[] = [];
  export let streams: Stream[] = [];
  export let onChange: (preferences: StreamSelectionPreferences) => void;
  const modes = {
    manual: ['Manual', 'Choose a stream each time. Saved link or binge-group reuse can still start playback.'],
    first: ['First stream', 'Play the first eligible stream in provider order.'],
    regex: ['Regular expression', 'Play the first eligible stream matching your pattern.'],
    preferences: ['Preferences', 'Match resolution and release type, preferring your chosen provider.']
  };
  $: compiled = compileStreamRegex(preferences.regex);
  $: eligible = streams.filter((stream) => sourceAllowed(streamSource(stream), preferences));
  $: matches = eligible.filter(compiled.matches).length;
  $: timeoutIndex = TIMEOUT_SECONDS.indexOf(preferences.timeoutSeconds);
  $: timeoutLabel = preferences.timeoutSeconds === 'unlimited' ? 'Unlimited' : preferences.timeoutSeconds === 0 ? 'Instant' : `${preferences.timeoutSeconds} seconds`;
  function change(patch: Partial<StreamSelectionPreferences>) { onChange({ ...preferences, ...patch }); }
  function toggleRelease(type: ReleaseType) {
    change({ releaseTypes: preferences.releaseTypes.includes(type)
      ? preferences.releaseTypes.filter((value) => value !== type) : [...preferences.releaseTypes, type] });
  }
  function toggleSource(key: 'allowedAddons' | 'allowedPlugins', id: string) {
    change({ [key]: preferences[key].includes(id) ? preferences[key].filter((value) => value !== id) : [...preferences[key], id] });
  }
  const detailSwitches = [
    ['prefetchStreamsOnDetail', 'Prefetch streams on detail', 'Prepare sources in the background while viewing details, when automatic selection is on.'],
    ['resumeDirectlyFromContinueWatching', 'Resume directly from Continue Watching', 'Open playback directly when tapping a watching card. Its options menu still offers details.']
  ] as const;
  const switches = [
    ['nextEpisodeAutoPlay', 'Auto-play next episode', 'Continue automatically when an episode ends.'],
    ['preferBingeGroup', 'Prefer binge group', 'Continue the current release group, name, or quality before using mode rules.'],
    ['bingeFallback', 'Allow continuation fallback', 'When the current release is unavailable, use the selection mode; Manual uses the first eligible stream. Turn off to choose the next stream yourself.'],
    ['reuseBingeGroup', 'Reuse binge group', 'Remember the last played group for Play or Resume of this series in this profile.']
  ] as const;
</script>

<section class="selection-settings" aria-label="Stream selection settings">
  <div class="selection-fields">
    <label><span>Stream selection mode</span><select aria-label="Stream selection mode" value={preferences.mode} onchange={(event) => change({ mode: event.currentTarget.value as StreamSelectionPreferences['mode'] })}>{#each AUTO_PLAY_MODES as mode}<option value={mode}>{modes[mode][0]}</option>{/each}</select><small>{modes[preferences.mode][1]}</small></label>
  </div>
  {#if preferences.mode === 'regex'}
    <label class="pattern-field"><span>Regular expression</span><input type="text" aria-label="Regular expression" value={preferences.regex} aria-invalid={!!compiled.error} oninput={(event) => change({ regex: event.currentTarget.value })} spellcheck={false} autocomplete="off" /></label>
    {#if compiled.error}<p role="alert">{compiled.error}</p>{/if}
    {#if streams.length}<p aria-live="polite">Matches {matches} of {eligible.length} streams</p>{/if}
    <label class="pattern-field"><span>Regex preset</span><select aria-label="Regex preset" value="" onchange={(event) => { if (event.currentTarget.value) change({ regex: event.currentTarget.value }); }}><option value="">Choose a preset…</option>{#each REGEX_PRESETS as [name, pattern]}<option value={pattern}>{name}</option>{/each}</select></label>
  {/if}
  <label class="pattern-field"><span>Selection timeout: {timeoutLabel}</span><input type="range" aria-label="Selection timeout" min="0" max={TIMEOUT_SECONDS.length - 1} step="1" value={timeoutIndex} aria-valuetext={timeoutLabel} oninput={(event) => change({ timeoutSeconds: TIMEOUT_SECONDS[Number(event.currentTarget.value)] })} /></label>
  <p>Instant uses arriving results. A timed selection waits for eligible sources, up to the selected limit. Unlimited waits for every eligible source, with a 60-second limit. You can always choose manually.</p>
  <div class="selection-fields"><label><span>Source scope</span><select aria-label="Source scope" value={preferences.scope} onchange={(event) => change({ scope: event.currentTarget.value as StreamSelectionPreferences['scope'] })}><option value="all">All sources</option><option value="addons">Add-ons only</option><option value="plugins">Plugins only</option></select></label></div>
  {#each ['addon', 'plugin'] as kind}
    {@const key = kind === 'addon' ? 'allowedAddons' : 'allowedPlugins'}
    {@const available = providers.filter((provider) => provider.kind === kind)}
    <fieldset><legend>Allowed {kind === 'addon' ? 'add-ons' : 'plugins'}</legend><button type="button" class="all-sources" onclick={() => change({ [key]: [] })}>Use all {kind === 'addon' ? 'add-ons' : 'plugins'}</button>
      <div class="source-options">{#each available as provider (provider.id)}<label><input type="checkbox" checked={preferences[key].includes(provider.id)} onchange={() => toggleSource(key, provider.id)} />{provider.name}</label>{/each}
      {#each preferences[key].filter((id) => !available.some((provider) => provider.id === id)) as id, index}<label><input type="checkbox" checked onchange={() => toggleSource(key, id)} />Unavailable {kind === 'addon' ? 'add-on' : 'plugin'} {index + 1}</label>{/each}</div><p>No individual selections means all sources of this kind.</p>
    </fieldset>
  {/each}
  <label class="playback-fallback-control"><span><strong>Reuse last link</strong><small>Re-fetch sources and prefer the last successfully played link for this title in this profile.</small></span><input type="checkbox" role="switch" checked={preferences.reuseLastLink} onchange={(event) => change({ reuseLastLink: event.currentTarget.checked })} aria-label="Reuse last link" /></label>
  {#if preferences.reuseLastLink}<label class="pattern-field"><span>Last link duration</span><select aria-label="Last link duration" value={preferences.lastLinkHours} onchange={(event) => change({ lastLinkHours: Number(event.currentTarget.value) })}>{#each LAST_LINK_HOURS as hours}<option value={hours}>{hours} {hours === 1 ? 'hour' : 'hours'}</option>{/each}</select></label>{/if}
  <label class="playback-fallback-control"><span><strong>Sort streams by preference</strong><small>Show streams matching your saved resolution, release type, and provider first, independently of selection mode.</small></span><input type="checkbox" role="switch" checked={preferences.sortByPreference} onchange={(event) => change({ sortByPreference: event.currentTarget.checked })} aria-label="Sort streams by preference" /></label>
  {#if preferences.mode === 'preferences'}
    <div class="selection-fields">
      <label><span>Preferred resolution</span><select aria-label="Preferred resolution" value={preferences.resolution} onchange={(event) => change({ resolution: event.currentTarget.value as StreamSelectionPreferences['resolution'] })}><option value="any">Any resolution</option><option value="2160p">4K</option><option value="1080p">1080p</option><option value="720p">720p</option></select></label>
      <label><span>Preferred provider</span><select aria-label="Preferred provider" value={preferences.provider} onchange={(event) => change({ provider: event.currentTarget.value })}><option value="">Any provider</option>{#if preferences.provider && !providers.some((provider) => provider.id === preferences.provider)}<option value={preferences.provider}>Unavailable provider</option>{/if}{#each providers as provider (provider.id)}<option value={provider.id}>{provider.name}</option>{/each}</select></label>
    </div>
    <fieldset><legend>Release types</legend><div class="release-chips">{#each RELEASE_TYPES as type}<button type="button" class:chosen={preferences.releaseTypes.includes(type.key)} aria-pressed={preferences.releaseTypes.includes(type.key)} onclick={() => toggleRelease(type.key)}>{type.label}</button>{/each}</div><p>{preferences.releaseTypes.length ? 'Use any selected release type. Resolution and release type must match; the provider is a preference.' : 'Any release type. Select one or more to filter automatic selection and rank the list.'}</p></fieldset>
    <p>Unknown quality or release information cannot match a specific filter.</p>
  {/if}
  {#each detailSwitches as [key, title, description]}<label class="playback-fallback-control"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" role="switch" checked={preferences[key]} onchange={(event) => change({ [key]: event.currentTarget.checked })} aria-label={title} /></label>{/each}
  <h3>Next episode</h3>
  {#each switches as [key, title, description]}<label class="playback-fallback-control"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" role="switch" checked={preferences[key]} onchange={(event) => change({ [key]: event.currentTarget.checked })} aria-label={title} /></label>{/each}
</section>

<style>
  .pattern-field{display:grid;gap:9px;margin:18px 0;font-size:12px;color:#bac8ce}
  input[type="text"]{width:100%;box-sizing:border-box;background:#ffffff09;border:1px solid #ffffff30;border-radius:12px;padding:12px;color:#eef5f2;font:inherit}
  input[type="range"]{width:100%;accent-color:#9debd2}
  input:focus-visible{outline:2px solid #9debd2;outline-offset:3px}
  .source-options{display:grid;gap:10px;margin-top:12px}.source-options label{display:flex;align-items:center;gap:8px;font-size:12px;color:#bac8ce;overflow-wrap:anywhere}
  .all-sources{background:#ffffff09;border:1px solid #ffffff30;color:#eef5f2;border-radius:10px;padding:9px;font:inherit;font-size:12px;cursor:pointer}
  h3{font-size:15px;margin-top:28px}small{line-height:1.6;color:#8ea0ab}
  .selection-settings{padding:14px 0 22px;border-bottom:1px solid #ffffff1b;margin-bottom:22px}
  .selection-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:18px 0}
  .selection-fields label{min-width:0;display:grid;gap:9px;font-size:12px;color:#bac8ce}
  select{appearance:none;width:100%;min-width:0;border:1px solid #ffffff30;border-radius:12px;background:#ffffff09;color:#eef5f2;padding:12px 34px 12px 12px;font:inherit;font-size:13px;cursor:pointer}
  option{color:#eef5f2;background:#171d23}
  fieldset{border:0;padding:0;margin:20px 0 0;min-width:0}
  legend{font-size:12px;color:#bac8ce;margin-bottom:11px}
  .release-chips{display:flex;flex-wrap:wrap;gap:8px}
  .release-chips button{border:1px solid #ffffff25;border-radius:999px;background:#ffffff08;color:#b4c2c9;padding:9px 13px;font:inherit;font-size:12px;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
  .release-chips button.chosen{background:#9debd21d;border-color:#9debd275;color:#b4f3df}
  p{font-size:11px;line-height:1.6;color:#8ea0ab;margin:12px 0 0}
  select:focus-visible,button:focus-visible{outline:2px solid #9debd2;outline-offset:3px}
  @media(max-width:480px){.selection-fields{grid-template-columns:1fr}}
  @media(prefers-reduced-motion:reduce){.release-chips button{transition:none}}
</style>
