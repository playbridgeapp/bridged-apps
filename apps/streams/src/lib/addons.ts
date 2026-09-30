import type { AddonCatalog, AddonManifest, AddonResource, InstalledAddon, MediaType, Meta, MetaPreview, PluginRepository, Stream } from './types';
import { browserCompatible, fetchPluginStreams } from './plugins';
import { cachedStreamLookup } from './stream-cache';

const STORAGE_KEY = 'bridged-streams.addons.v1';

function httpUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter an HTTP or HTTPS addon URL without embedded credentials.');
  }
  return url;
}

export function manifestUrl(raw: string): string {
  const url = httpUrl(raw.trim());
  url.hash = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${url.pathname.endsWith('/manifest.json') ? '' : '/manifest.json'}`;
  return url.toString();
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function resourceUrl(addon: InstalledAddon, resource: string, type: string, id: string, extra?: Record<string, string>): string {
  const manifest = new URL(addon.manifestUrl);
  const basePath = manifest.pathname.replace(/\/manifest\.json$/, '').replace(/\/+$/, '');
  const extras = extra && Object.entries(extra).length
    ? `/${Object.entries(extra).map(([key, value]) => `${segment(key)}=${segment(value)}`).join('&')}`
    : '';
  manifest.pathname = `${basePath}/${segment(resource)}/${segment(type)}/${segment(id)}${extras}.json`;
  return manifest.toString();
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Could not reach the addon. Check its URL and browser CORS support.');
  }
  if (!response.ok) throw new Error(`Addon returned HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function installAddon(raw: string): Promise<InstalledAddon> {
  const url = manifestUrl(raw);
  const manifest = await getJson<AddonManifest>(url);
  if (!manifest.id || !manifest.name || !manifest.version || !Array.isArray(manifest.resources)) {
    throw new Error('This URL did not return a Stremio-compatible addon manifest.');
  }
  return { manifestUrl: url, manifest };
}

export function savedAddonUrls(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export function saveAddonUrls(addons: InstalledAddon[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(addons.map((addon) => addon.manifestUrl)));
}

function resources(manifest: AddonManifest): AddonResource[] {
  return manifest.resources.map((resource) => typeof resource === 'string'
    ? { name: resource, types: manifest.types || [], idPrefixes: manifest.idPrefixes || [] }
    : { name: resource.name, types: resource.types || manifest.types || [], idPrefixes: resource.idPrefixes || manifest.idPrefixes || [] });
}

export function supports(addon: InstalledAddon, name: string, type: string, id?: string): boolean {
  return addon.enabled !== false && !addon.disabledFeatures?.includes(name as 'catalog' | 'meta' | 'stream' | 'subtitles')
    && (resources(addon.manifest).some((resource) => resource.name === name
    && (resource.types.length === 0 || resource.types.includes(type))
    && (!id || resource.idPrefixes.length === 0 || resource.idPrefixes.some((prefix) => id.startsWith(prefix))))
    || (name === 'catalog' && addon.manifest.catalogs?.some((catalog) => catalog.type === type) === true));
}

export function catalogs(addons: InstalledAddon[], type?: MediaType): Array<{ addon: InstalledAddon; catalog: AddonCatalog }> {
  return addons.flatMap((addon) => (addon.manifest.catalogs || [])
    .filter((catalog) => (!type || catalog.type === type) && supports(addon, 'catalog', catalog.type))
    .map((catalog) => ({ addon, catalog })));
}

export function requiredCatalogExtras(catalog: AddonCatalog, search?: string): Record<string, string> | null {
  const extras: Record<string, string> = {};
  for (const extra of catalog.extra || []) {
    if (extra.name === 'search' && search) extras.search = search;
    else if (extra.isRequired) {
      if (extra.name === 'search' || !extra.options?.length) return null;
      extras[extra.name] = extra.options[0];
    }
  }
  return extras;
}

export async function fetchCatalogPage(addon: InstalledAddon, catalog: AddonCatalog, extras: Record<string, string> = {}, signal?: AbortSignal): Promise<{ items: MetaPreview[]; rawItemCount: number }> {
  const data = await getJson<{ metas?: MetaPreview[] }>(resourceUrl(addon, 'catalog', catalog.type, catalog.id, extras), signal);
  const metas = Array.isArray(data.metas) ? data.metas : [];
  return { items: metas.filter((meta) => meta.id && ['movie', 'series', 'sport', 'library'].includes(meta.type)), rawItemCount: metas.length };
}

export async function fetchCatalog(addon: InstalledAddon, catalog: AddonCatalog, extras: Record<string, string> = {}, signal?: AbortSignal): Promise<MetaPreview[]> {
  return (await fetchCatalogPage(addon, catalog, extras, signal)).items;
}

export async function fetchMeta(addons: InstalledAddon[], preview: MetaPreview, signal?: AbortSignal): Promise<Meta> {
  const candidates = addons.filter((addon) => supports(addon, 'meta', preview.type, preview.id));
  for (const addon of candidates) {
    try {
      const data = await getJson<{ meta?: Meta }>(resourceUrl(addon, 'meta', preview.type, preview.id), signal);
      if (data.meta) return { ...preview, ...data.meta, videos: (data.meta.videos || []).map((video) => ({
        ...video, title: video.title || video.name, description: video.description || video.overview
      })) };
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return { ...preview, videos: [] };
}

export async function fetchStreams(addons: InstalledAddon[], type: MediaType, id: string, plugins: PluginRepository[] = [], tmdbKey = '', onWarning?: (message: string) => void, signal?: AbortSignal, forceRefresh = false): Promise<Stream[]> {
  const candidates = addons.filter((addon) => supports(addon, 'stream', type, id));
  const results = await Promise.allSettled(candidates.map((addon) => {
    const url = resourceUrl(addon, 'stream', type, id);
    return cachedStreamLookup(`addon:${url}:${addon.manifest.version}`, async () => {
      const data = await getJson<{ streams?: Omit<Stream, 'addonName' | 'addonUrl'>[] }>(url, signal);
      return (data.streams || []).map((stream) => ({ ...stream, addonName: addon.manifest.name, addonUrl: addon.manifestUrl }));
    }, forceRefresh || !!signal);
  }));
  results.forEach((result, index) => {
    if (result.status === 'rejected' && !signal?.aborted) {
      onWarning?.(`${candidates[index].manifest.name}: ${result.reason instanceof Error ? result.reason.message : 'Stream lookup failed.'}`);
    }
  });
  const addonStreams = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const parts = id.match(/^(tt\d+|tmdb:\d+):(\d+):(\d+)$/);
  const pluginId = parts?.[1] || id;
  const scrapers = type === 'movie' || type === 'series' ? plugins.flatMap((repo) => repo.scrapers
    .filter((scraper) => browserCompatible(scraper) &&
      scraper.supportedTypes?.some((value) => value === (type === 'series' ? 'tv' : 'movie') || value === type))
    .map((scraper) => ({ repo, scraper }))) : [];
  const pluginResults = await Promise.allSettled(scrapers.map(({ repo, scraper }) => {
    let warned = false;
    return cachedStreamLookup(
      JSON.stringify(['plugin', repo.manifestUrl, scraper.id, scraper.filename, scraper.enabled, scraper.supportedPlatforms,
        type, pluginId, parts?.[2], parts?.[3], tmdbKey, scraper.settings]),
      () => fetchPluginStreams([{ ...repo, scrapers: [scraper] }], type, pluginId, tmdbKey,
        parts ? Number(parts[2]) : undefined, parts ? Number(parts[3]) : undefined,
        (warning) => { warned = true; onWarning?.(warning); }), forceRefresh || !!signal, () => !warned);
  }));
  const pluginStreams = pluginResults.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  return [...addonStreams, ...pluginStreams];
}

export function playableStream(stream: Stream): stream is Stream & { url: string } {
  // notWebReady is an advisory from the addon. A direct HTTP stream may still work
  // in a browser when the media server allows CORS, so let the viewer try it.
  if (!stream.url || stream.behaviorHints?.proxyHeaders) return false;
  if (stream.headers && Object.entries(stream.headers).some(([name, value]) =>
    !['authorization', 'cookie', 'referer', 'origin', 'user-agent', 'accept', 'accept-language'].includes(name.toLowerCase()) || /[\u0000-\u001f\u007f]/.test(value))) return false;
  try {
    return ['http:', 'https:'].includes(httpUrl(stream.url).protocol);
  } catch {
    return false;
  }
}
