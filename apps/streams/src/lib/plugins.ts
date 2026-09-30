import type { MediaType, PluginRepository, PluginScraper, Stream } from './types';
import ScraperWorker from './scraper-worker?worker';
import { resolveTmdbId } from './tmdb';
import { applyPluginPreferences, savedLocalPluginPreferences, objectValue } from './plugin-preferences';
import type { ScraperRequest } from './scraper-runtime';

const STORAGE_KEY = 'bridged-streams.plugins.v1';
const DISABLED_KEY = 'bridged-streams.disabled-scrapers.v1';
const TMDB_KEY = 'bridged-streams.tmdb-key.v1';

function disabledScrapers(): string[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]');
    return Array.isArray(data) ? data.filter((value): value is string => typeof value === 'string') : [];
  } catch { return []; }
}

function normalizedUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP or HTTPS plugin URL.');
  url.hash = '';
  if (!url.pathname.endsWith('/manifest.json')) url.pathname = `${url.pathname.replace(/\/+$/, '')}/manifest.json`;
  return url.toString();
}

export async function installPlugin(raw: string, useLocalPreferences = true): Promise<PluginRepository> {
  const manifestUrl = normalizedUrl(raw);
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`Plugin repository returned HTTP ${response.status}.`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') throw new Error('Invalid plugin manifest.');
  const manifest = data as { name?: string; scrapers?: PluginScraper[]; description?: string };
  if (!manifest.name || !Array.isArray(manifest.scrapers) || !manifest.scrapers.length) throw new Error('This is not a Nuvio plugin repository.');
  const disabled = new Set(useLocalPreferences ? disabledScrapers() : []);
  const repo = { manifestUrl, name: manifest.name, description: manifest.description, scrapers: manifest.scrapers
    .filter((scraper) => scraper.id && scraper.filename)
    .map((scraper) => ({ ...scraper, manifestEnabled: scraper.enabled !== false, enabled: scraper.enabled !== false && !disabled.has(`${manifestUrl}:${scraper.id}`) })) };
  return useLocalPreferences ? applyPluginPreferences([repo], savedLocalPluginPreferences())[0] : repo;
}

export function savedPluginUrls(): string[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

export function savePluginUrls(repos: PluginRepository[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(repos.map((repo) => repo.manifestUrl)));
}

export function toggleScraper(repos: PluginRepository[], repoUrl: string, scraperId: string, enabled: boolean): PluginRepository[] {
  const disabled = new Set(disabledScrapers());
  const key = `${repoUrl}:${scraperId}`;
  if (enabled) disabled.delete(key); else disabled.add(key);
  localStorage.setItem(DISABLED_KEY, JSON.stringify([...disabled]));
  return repos.map((repo) => repo.manifestUrl === repoUrl
    ? { ...repo, scrapers: repo.scrapers.map((scraper) => scraper.id === scraperId ? { ...scraper, enabled } : scraper) }
    : repo);
}

export function platformCompatible(scraper: PluginScraper): boolean {
  const allowed = scraper.supportedPlatforms?.map((platform) => platform.toLowerCase()) || [];
  const denied = scraper.disabledPlatforms?.map((platform) => platform.toLowerCase()) || [];
  return scraper.manifestEnabled !== false && !denied.includes('web') && (!allowed.length || allowed.includes('web'));
}

export function savedTmdbKey(): string { return localStorage.getItem(TMDB_KEY) || ''; }
export function saveTmdbKey(key: string): void {
  if (key.trim()) localStorage.setItem(TMDB_KEY, key.trim());
  else localStorage.removeItem(TMDB_KEY);
}

export function browserCompatible(scraper: PluginScraper): boolean {
  return scraper.enabled !== false && platformCompatible(scraper);
}

async function tmdbId(id: string, type: MediaType, key: string): Promise<string | null> {
  return (await resolveTmdbId(id, type, key))?.toString() || null;
}

function runWorker(code: string, args: Omit<ScraperRequest, 'code'>): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const worker = new ScraperWorker();
    const timer = window.setTimeout(() => { worker.terminate(); reject(new Error('Scraper timed out.')); }, 30_000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; streams?: unknown[]; error?: string }>) => {
      clearTimeout(timer); worker.terminate();
      if (event.data.ok) resolve(event.data.streams || []);
      else reject(new Error(event.data.error || 'Scraper failed.'));
    };
    worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message || 'Scraper failed.')); };
    worker.postMessage({ code, ...args });
  });
}

export type PluginSettingsField = {
  type: string; key?: string; label: string; description?: string; placeholder?: string;
  isPassword?: boolean; defaultValue?: string | boolean | number;
  options?: { label: string; value: string }[];
};
export async function fetchPluginSettingsLayout(repo: PluginRepository, scraper: PluginScraper, tmdbKey: string): Promise<PluginSettingsField[]> {
  const url = new URL(scraper.filename, repo.manifestUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid scraper URL.');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Scraper code returned HTTP ${response.status}.`);
  const layout = await runWorker(await response.text(), { tmdbId: '', mediaType: 'movie', tmdbKey,
    settings: scraper.settings || {}, scraperId: scraper.id, operation: 'settings' });
  return layout.flatMap((value) => {
    const field = objectValue(value);
    if (typeof field.type !== 'string' || typeof field.label !== 'string') return [];
    const result: PluginSettingsField = { type: field.type, label: field.label };
    for (const name of ['key', 'description', 'placeholder'] as const) {
      if (typeof field[name] === 'string') result[name] = field[name];
    }
    result.isPassword = field.isPassword === true;
    if (['string', 'number', 'boolean'].includes(typeof field.defaultValue)) result.defaultValue = field.defaultValue as string | number | boolean;
    result.options = Array.isArray(field.options) ? field.options.flatMap((value) => {
      const option = objectValue(value);
      return typeof option.label === 'string' && ['string', 'number'].includes(typeof option.value)
        ? [{ label: option.label, value: String(option.value) }] : [];
    }) : [];
    return [result];
  });
}

export async function fetchPluginStreams(repos: PluginRepository[], type: MediaType, id: string, key: string, season?: number, episode?: number, onWarning?: (message: string) => void): Promise<Stream[]> {
  if (!repos.length) return [];
  if (/^tt\d+$/.test(id) && !key) {
    onWarning?.('Enter a TMDB API key in Addons to use Nuvio scrapers with IMDb titles.');
    return [];
  }
  const candidateId = await tmdbId(id, type, key).catch(() => {
    onWarning?.('TMDB ID lookup failed. Check your key and network connection.');
    return null;
  });
  if (!candidateId) return [];
  const targets = repos.flatMap((repo) => repo.scrapers
    .filter((scraper) => browserCompatible(scraper) && scraper.supportedTypes?.some((value) => value === (type === 'series' ? 'tv' : 'movie') || value === type))
    .map((scraper) => ({ repo, scraper })));
  const results = await Promise.allSettled(targets.map(async ({ repo, scraper }) => {
    const codeUrl = new URL(scraper.filename, repo.manifestUrl);
    if (!['http:', 'https:'].includes(codeUrl.protocol)) throw new Error('Invalid scraper URL.');
    const response = await fetch(codeUrl);
    if (!response.ok) throw new Error(`Scraper code returned HTTP ${response.status}.`);
    const output = await runWorker(await response.text(), { tmdbId: candidateId, mediaType: type === 'series' ? 'tv' : 'movie', season, episode, tmdbKey: key,
      settings: scraper.settings || {}, scraperId: scraper.id });
    return output.flatMap((value): Stream[] => {
      if (!value || typeof value !== 'object') return [];
      const item = value as { url?: string | { url?: string }; title?: string; name?: string; headers?: Record<string, string> };
      const url = typeof item.url === 'string' ? item.url : item.url?.url;
      return url ? [{ addonName: scraper.name, addonUrl: `${repo.manifestUrl}:${scraper.id}`, url, title: item.title, name: item.name, headers: item.headers }] : [];
    });
  }));
  results.forEach((result, index) => {
    if (result.status === 'rejected') onWarning?.(`${targets[index].scraper.name}: ${result.reason instanceof Error ? result.reason.message : 'Scraper failed in this browser.'}`);
  });
  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
}
