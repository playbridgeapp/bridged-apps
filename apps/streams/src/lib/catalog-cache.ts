import type { MetaPreview } from './types';

const CACHE_KEY = 'bridged-streams.catalog-cache.v1';
const SETTINGS_KEY = 'bridged-streams.catalog-refresh.v1';
const MAX_ROWS = 24;
const MAX_ITEMS = 24;

type CachedRow = { items: MetaPreview[]; savedAt: number };
type Cache = Record<string, CachedRow>;

const WRITE_DELAY_MS = 500;

let memory: Cache | undefined;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

function readCache(): Cache {
  if (memory) return memory;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    memory = value && typeof value === 'object' && !Array.isArray(value) ? value as Cache : {};
  } catch { memory = {}; }
  return memory;
}

/** Writes any pending catalog cache to storage immediately. */
export function flushCatalogCache(): void {
  if (writeTimer === undefined) return;
  clearTimeout(writeTimer);
  writeTimer = undefined;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(readCache())); }
  catch { /* catalog display must work even when browser storage is full */ }
}

function listenForExit(): void {
  if (listening || typeof window === 'undefined' || typeof document === 'undefined') return;
  listening = true;
  window.addEventListener('pagehide', flushCatalogCache);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushCatalogCache(); });
}

export function cachedCatalog(key: string): MetaPreview[] {
  const row = readCache()[key];
  return Array.isArray(row?.items) ? row.items.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string') : [];
}

export function saveCatalogCache(key: string, items: MetaPreview[]): void {
  const cache = readCache();
  cache[key] = { items: items.slice(0, MAX_ITEMS), savedAt: Date.now() };
  const kept = Object.entries(cache).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, MAX_ROWS);
  memory = Object.fromEntries(kept);
  listenForExit();
  if (writeTimer === undefined) writeTimer = setTimeout(flushCatalogCache, WRITE_DELAY_MS);
}

export function clearCatalogCache(): void {
  memory = {};
  if (writeTimer !== undefined) { clearTimeout(writeTimer); writeTimer = undefined; }
  try { localStorage.removeItem(CACHE_KEY); } catch { /* storage unavailable */ }
}

export function savedCatalogRefresh(): { auto: boolean; intervalMinutes: 15 | 30 | 60 } {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as { auto?: boolean; intervalMinutes?: number };
    return { auto: value.auto !== false, intervalMinutes: value.intervalMinutes === 15 || value.intervalMinutes === 60 ? value.intervalMinutes : 30 };
  } catch { return { auto: true, intervalMinutes: 30 }; }
}

export function saveCatalogRefresh(auto: boolean, intervalMinutes: 15 | 30 | 60): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ auto, intervalMinutes }));
}
