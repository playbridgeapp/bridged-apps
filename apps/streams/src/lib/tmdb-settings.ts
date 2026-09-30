export const TMDB_MODULES = [
  { key: 'artwork', label: 'Artwork', description: 'Posters, backgrounds, and title logos.' },
  { key: 'basicInfo', label: 'Basic information', description: 'Localized title, overview, genres, and a rating when the addon has none.' },
  { key: 'details', label: 'Title details', description: 'Runtime, age rating, status, country, and original language.' },
  { key: 'credits', label: 'Cast and crew', description: 'Cast photos, character names, directors, and writers.' },
  { key: 'productions', label: 'Production companies', description: 'Studios and their logos.' },
  { key: 'networks', label: 'Networks', description: 'TV networks and their logos.' },
  { key: 'episodes', label: 'Episode details', description: 'Episode names, overviews, thumbnails, and runtimes for the selected season.' },
  { key: 'seasonPosters', label: 'Season posters', description: 'Artwork for the season picker.' },
  { key: 'trailers', label: 'Trailers', description: 'Links to trailers on YouTube.' },
  { key: 'moreLikeThis', label: 'More like this', description: 'Related movies and TV shows from TMDB.' },
  { key: 'collections', label: 'Movie collections', description: 'Other movies in the same collection.' }
] as const;
export type TmdbModule = typeof TMDB_MODULES[number]['key'];
export type TmdbSettings = { enabled: boolean; language: string } & Record<TmdbModule, boolean>;
const KEY = 'bridged-streams.tmdb-enrichment.v1';
export function defaultTmdbSettings(): TmdbSettings {
  return { enabled: false, language: 'en-US', ...Object.fromEntries(TMDB_MODULES.map(({ key }) => [key, true])) } as TmdbSettings;
}
export function savedTmdbSettings(): TmdbSettings {
  const settings = defaultTmdbSettings();
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}');
    settings.enabled = value?.enabled === true;
    if (typeof value?.language === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value.language)) settings.language = value.language;
    for (const { key } of TMDB_MODULES) if (typeof value?.[key] === 'boolean') settings[key] = value[key];
  } catch { /* Optional enrichment must not affect startup. */ }
  return settings;
}
export function saveTmdbSettings(settings: TmdbSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Keep settings in memory. */ }
}
