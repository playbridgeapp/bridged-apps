export type MediaType = 'movie' | 'series' | 'sport' | 'library';

export interface AddonResource {
  name: string;
  types: string[];
  idPrefixes: string[];
}

export interface AddonCatalog {
  id: string;
  type: string;
  name: string;
  extra?: Array<{ name: string; isRequired?: boolean; options?: string[] }>;
}

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  logo?: string;
  types: string[];
  idPrefixes?: string[];
  resources: Array<string | { name: string; types?: string[]; idPrefixes?: string[] }>;
  catalogs?: AddonCatalog[];
  behaviorHints?: { configurable?: boolean; configurationRequired?: boolean };
}

export interface InstalledAddon {
  manifestUrl: string;
  manifest: AddonManifest;
  flags?: { official?: boolean; protected?: boolean };
  enabled?: boolean;
  disabledFeatures?: Array<'catalog' | 'meta' | 'stream' | 'subtitles'>;
  loadError?: string;
}

export interface MetaPreview {
  id: string;
  type: MediaType;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
}

export interface Video {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  overview?: string;
  season?: number;
  episode?: number;
  released?: string;
  thumbnail?: string;
}

export interface Meta extends MetaPreview {
  videos?: Video[];
  runtime?: string;
  released?: string;
  country?: string;
  status?: string;
  cast?: string[];
  director?: string[] | string;
  writer?: string[] | string;
}

export interface Stream {
  addonName: string;
  addonUrl: string;
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  externalUrl?: string;
  headers?: Record<string, string>;
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
    proxyHeaders?: { request?: Record<string, string> };
  };
}

export interface CastItem {
  id: string;
  url: string;
  title: string;
  contentType: string;
  metadata: Record<string, unknown>;
  headers?: Record<string, string>;
  startPositionMs?: number;
}

export interface PluginScraper {
  id: string;
  name: string;
  filename: string;
  supportedTypes: string[];
  enabled?: boolean;
  manifestEnabled?: boolean;
  supportedPlatforms?: string[];
  disabledPlatforms?: string[];
}

export interface PluginRepository {
  manifestUrl: string;
  name: string;
  description?: string;
  scrapers: PluginScraper[];
}

export interface LinkedSession {
  sessionId: string;
  addEventListener(type: 'needitems' | 'statechange' | 'ended', listener: (event: CustomEvent) => void): void;
  unlink(): Promise<void>;
  provideItems(requestId: string, result: { items: CastItem[]; endOfList: boolean }): Promise<void>;
}

declare global {
  interface Window {
    playbridge?: {
      cast(payload: CastItem | Record<string, unknown>): void;
      linkCast?(payload: Record<string, unknown>): Promise<LinkedSession>;
      capabilities?: { linkedCast?: boolean };
    };
  }
}
