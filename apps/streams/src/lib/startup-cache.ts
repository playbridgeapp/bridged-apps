import type { NuvioLibraryItem, NuvioProgress } from './nuvio';
import type { StremioLibraryItem } from './stremio';
import type { InstalledAddon, PluginRepository } from './types';

type CacheName = 'local-addons' | 'stremio-addons' | 'stremio-library'
  | 'nuvio-addons' | 'nuvio-plugins' | 'nuvio-library' | 'nuvio-progress';
type CacheEntry = { scope: string; value: unknown };
const key = (name: CacheName) => `bridged-streams.startup-cache.v1.${name}`;

function readArray<T>(name: CacheName, scope: string, valid: (item: unknown) => item is T): T[] | null {
  try {
    const entry = JSON.parse(localStorage.getItem(key(name)) || 'null') as CacheEntry | null;
    return entry?.scope === scope && Array.isArray(entry.value) && entry.value.every(valid) ? entry.value : null;
  } catch { return null; }
}

function writeArray<T>(name: CacheName, scope: string, value: T[]): void {
  try { localStorage.setItem(key(name), JSON.stringify({ scope, value })); }
  catch { /* A full or unavailable cache must never interrupt browsing. */ }
}

export function clearStartupCache(names: CacheName[]): void {
  for (const name of names) {
    try { localStorage.removeItem(key(name)); } catch { /* storage unavailable */ }
  }
}

function isAddon(value: unknown): value is InstalledAddon {
  if (!value || typeof value !== 'object') return false;
  const addon = value as Partial<InstalledAddon>;
  return typeof addon.manifestUrl === 'string' && !!addon.manifestUrl
    && typeof addon.manifest?.name === 'string' && Array.isArray(addon.manifest?.resources)
    && Array.isArray(addon.manifest?.types) && (!addon.manifest.catalogs || Array.isArray(addon.manifest.catalogs));
}

export function cachedAddons(name: 'local-addons' | 'stremio-addons' | 'nuvio-addons', scope: string): InstalledAddon[] | null {
  return readArray(name, scope, isAddon);
}

export function saveAddons(name: 'local-addons' | 'stremio-addons' | 'nuvio-addons', scope: string, addons: InstalledAddon[]): void {
  writeArray(name, scope, addons);
}

function isLibraryItem(value: unknown): value is StremioLibraryItem | NuvioLibraryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StremioLibraryItem>;
  return typeof item.id === 'string' && typeof item.name === 'string'
    && (item.type === 'movie' || item.type === 'series') && typeof item.progress === 'number';
}

export function cachedStremioLibrary(scope: string): StremioLibraryItem[] | null {
  return readArray('stremio-library', scope, (item): item is StremioLibraryItem => isLibraryItem(item));
}

export function saveStremioLibrary(scope: string, library: StremioLibraryItem[]): void {
  writeArray('stremio-library', scope, library);
}

export function cachedNuvioLibrary(scope: string): NuvioLibraryItem[] | null {
  return readArray('nuvio-library', scope, (item): item is NuvioLibraryItem => isLibraryItem(item));
}

export function saveNuvioLibrary(scope: string, library: NuvioLibraryItem[]): void {
  writeArray('nuvio-library', scope, library);
}

function isPlugin(value: unknown): value is PluginRepository {
  if (!value || typeof value !== 'object') return false;
  const plugin = value as Partial<PluginRepository>;
  return typeof plugin.manifestUrl === 'string' && typeof plugin.name === 'string' && Array.isArray(plugin.scrapers);
}

export function cachedNuvioPlugins(scope: string): PluginRepository[] | null {
  return readArray('nuvio-plugins', scope, isPlugin);
}

export function saveNuvioPlugins(scope: string, plugins: PluginRepository[]): void {
  writeArray('nuvio-plugins', scope, plugins);
}

export function cachedNuvioProgress(scope: string): NuvioProgress[] | null {
  return readArray('nuvio-progress', scope, (value): value is NuvioProgress => {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<NuvioProgress>;
    return typeof item.progress_key === 'string' && typeof item.content_id === 'string'
      && typeof item.position === 'number' && typeof item.duration === 'number';
  });
}

export function saveNuvioProgress(scope: string, progress: NuvioProgress[]): void {
  writeArray('nuvio-progress', scope, progress);
}
