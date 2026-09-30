<script lang="ts">
  import { TMDB_MODULES } from './tmdb-settings';
  import type { TmdbSettings } from './tmdb-settings';
  export let settings: TmdbSettings;
  export let apiKey: string;
  export let onChange: (settings: TmdbSettings) => void;
  export let onKeyChange: (key: string) => void;
  const languages = [['en-US', 'English'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'],
    ['pt-BR', 'Português (Brasil)'], ['pt-PT', 'Português'], ['it-IT', 'Italiano'], ['hi-IN', 'हिन्दी'],
    ['ar-SA', 'العربية'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['zh-CN', '中文'], ['tr-TR', 'Türkçe'], ['ru-RU', 'Русский']];
</script>

<section class="tmdb-settings" aria-label="TMDB enrichment settings">
  <label class="enrichment-toggle"><span><strong>TMDB enrichment</strong><small>Add extra details to movies and TV shows while addon details remain available.</small></span><input type="checkbox" role="switch" aria-label="TMDB enrichment" checked={settings.enabled} onchange={(event) => onChange({ ...settings, enabled: event.currentTarget.checked })} /></label>
  <label class="field">TMDB API key<input type="password" value={apiKey} oninput={(event) => onKeyChange(event.currentTarget.value)} placeholder="Your personal TMDB API key" autocomplete="off" /></label>
  <p class="hint">Uses the same key as Nuvio scraper lookups. Your key and preferences stay in this browser.</p>
  {#if settings.enabled && !apiKey.trim()}<p class="key-required" role="status">Enter your TMDB API key to enable extra details.</p>{/if}
  <label class="field">Preferred language<select value={settings.language} onchange={(event) => onChange({ ...settings, language: event.currentTarget.value })}>{#if !languages.some(([code]) => code === settings.language)}<option value={settings.language}>{settings.language}</option>{/if}{#each languages as [code, label]}<option value={code}>{label}</option>{/each}</select></label>
  <h3>Enrichment modules</h3>
  <div class="module-list">{#each TMDB_MODULES as module}<label class="module"><span><strong>{module.label}</strong><small>{module.description}</small></span><input type="checkbox" checked={settings[module.key]} disabled={!settings.enabled} onchange={(event) => onChange({ ...settings, [module.key]: event.currentTarget.checked })} /></label>{/each}</div>
  <footer><a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer"><img src="/tmdb-logo.png" alt="TMDB" />Metadata from TMDB</a><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p></footer>
</section>

<style>
  .enrichment-toggle,.module{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 0;border-bottom:1px solid #ffffff19;cursor:pointer}
  strong{display:block;color:#edf5f2;font-size:14px}small{display:block;color:#9bafb9;font-size:12px;line-height:1.6;margin-top:6px}
  input[type=checkbox]{flex:none;accent-color:#87e8c9;width:20px;height:20px;cursor:pointer}
  .field{display:grid;gap:10px;color:#c5d4d9;font-size:13px;margin:23px 0 12px}
  input[type=password],select{width:100%;box-sizing:border-box;border:1px solid #ffffff2b;border-radius:12px;background:#ffffff09;color:#ecf3ef;padding:13px;font:inherit;outline:none}
  option{background:#171d23}input:focus-visible,select:focus-visible{outline:2px solid #87e8c9;outline-offset:3px}
  .hint,footer p{font-size:12px;color:#8da1ac;line-height:1.7;margin:9px 0}.key-required{font-size:12px;color:#efcc8c}
  h3{font-size:15px;margin:30px 0 2px}.module strong{font-size:13px}.module:has(input:disabled){opacity:.5}
  footer{margin-top:27px}footer a{display:flex;align-items:center;gap:15px;font-size:12px;color:#88d9c4}footer img{width:55px;height:auto}
</style>
