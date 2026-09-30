import type { PluginRepository } from './types';

export type ScraperPreference = { id: string; enabled?: boolean; settings?: Record<string, unknown> };
export type PluginPreferences = { url: string; scrapers: ScraperPreference[] }[];
const LOCAL_KEY = 'bridged-streams.scraper-settings.v1';

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function pluginPreferences(value: unknown): PluginPreferences {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const repo = objectValue(entry);
    if (typeof repo.url !== 'string' || !Array.isArray(repo.scrapers)) return [];
    return [{ url: repo.url, scrapers: repo.scrapers.flatMap((entry) => {
      const scraper = objectValue(entry);
      if (typeof scraper.id !== 'string') return [];
      return [{ id: scraper.id, ...(typeof scraper.enabled === 'boolean' ? { enabled: scraper.enabled } : {}),
        ...(scraper.settings && typeof scraper.settings === 'object' && !Array.isArray(scraper.settings)
          ? { settings: objectValue(scraper.settings) } : {}) }];
    }) }];
  });
}

export function applyPluginPreferences(repos: PluginRepository[], preferences: PluginPreferences): PluginRepository[] {
  return repos.map((repo) => {
    const saved = preferences.find((item) => item.url === repo.manifestUrl);
    return { ...repo, scrapers: repo.scrapers.map((scraper) => {
      const pref = saved?.scrapers.find((item) => item.id === scraper.id);
      return { ...scraper, enabled: scraper.manifestEnabled !== false && (pref?.enabled ?? scraper.enabled) !== false,
        settings: pref?.settings ?? scraper.settings ?? {} };
    }) };
  });
}

export function savedLocalPluginPreferences(): PluginPreferences {
  try { return pluginPreferences(JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')); }
  catch { return []; }
}

export function saveLocalScraperSettings(url: string, id: string, settings: Record<string, unknown>): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(updatePluginPreference(savedLocalPluginPreferences(), url, id, { settings })));
}

export function updatePluginPreference(preferences: PluginPreferences, url: string, id: string,
  patch: Omit<ScraperPreference, 'id'>): PluginPreferences {
  const repo = preferences.find((item) => item.url === url) || { url, scrapers: [] };
  const scraper = repo.scrapers.find((item) => item.id === id) || { id };
  const updated = { ...repo, scrapers: [...repo.scrapers.filter((item) => item.id !== id), { ...scraper, ...patch }] };
  return [...preferences.filter((item) => item.url !== url), updated];
}
