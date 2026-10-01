import type { InstalledAddon } from './types';

export type AddonSource = 'local' | 'stremio' | 'nuvio';
export type AddonFeature = 'catalog' | 'meta' | 'stream' | 'subtitles';

const STORAGE_KEY = 'bridged-streams.addon-settings.v1';
const FEATURES: AddonFeature[] = ['catalog', 'meta', 'stream', 'subtitles'];

type Settings = { enabled?: boolean; disabledFeatures?: AddonFeature[] };

function allSettings(): Record<string, Settings> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Settings> : {};
  } catch { return {}; }
}

function key(source: AddonSource, url: string, scope = ''): string { return `${source}:${scope}:${url}`; }

export function addonSettings(source: AddonSource, url: string, scope = ''): Settings {
  const value = allSettings()[key(source, url, scope)] || {};
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
    disabledFeatures: Array.isArray(value.disabledFeatures)
      ? value.disabledFeatures.filter((feature): feature is AddonFeature => FEATURES.includes(feature)) : []
  };
}

export function saveAddonSettings(source: AddonSource, url: string, update: Settings, scope = ''): void {
  const values = allSettings();
  values[key(source, url, scope)] = { ...values[key(source, url, scope)], ...update };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
}

export function clearAddonSettings(source: AddonSource, url: string, scope = ''): void {
  const values = allSettings();
  delete values[key(source, url, scope)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
}

export function configuredAddon(addon: InstalledAddon, source: AddonSource, cloudEnabled?: boolean, scope = ''): InstalledAddon {
  const settings = addonSettings(source, addon.manifestUrl, scope);
  return { ...addon, enabled: cloudEnabled ?? settings.enabled ?? true, disabledFeatures: settings.disabledFeatures || [] };
}

export function unavailableAddon(url: string, name: string | undefined, error: unknown): InstalledAddon {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.endsWith('/manifest.json')) parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/manifest.json`;
    url = parsed.toString();
  } catch { /* keep the saved URL for repair */ }
  let title = name?.trim();
  if (!title) {
    try { title = new URL(url).hostname; } catch { title = url; }
  }
  return { manifestUrl: url, manifest: { id: url, name: title, version: '', types: [], resources: [], catalogs: [] },
    loadError: error instanceof Error ? error.message : 'Manifest could not be loaded.' };
}

export function supportedFeatures(addon: InstalledAddon): AddonFeature[] {
  const resources = new Set(addon.manifest.resources.map((resource) => typeof resource === 'string' ? resource : resource.name));
  if (resources.has('subtitle')) resources.add('subtitles');
  if (addon.manifest.catalogs?.length) resources.add('catalog');
  return FEATURES.filter((feature) => resources.has(feature));
}

export function configureUrl(manifestUrl: string): string {
  const url = new URL(manifestUrl);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.endsWith('/manifest.json')
    ? `${url.pathname.slice(0, -'/manifest.json'.length)}/configure`
    : `${url.pathname.replace(/\/+$/, '')}/configure`;
  return url.toString();
}
