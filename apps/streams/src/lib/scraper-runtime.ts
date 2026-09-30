import * as cheerio from 'cheerio/slim';
import CryptoJS from 'crypto-js';

export type ScraperRequest = {
  code: string;
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  tmdbKey: string;
  settings?: Record<string, unknown>;
  scraperId?: string;
  operation?: 'streams' | 'settings';
};

// Match Nuvio's supported CommonJS modules. Use the slim HTML parser so this
// worker never imports Cheerio's Node networking / stream implementations.
function pluginRequire(name: string): unknown {
  switch (name) {
    case 'cheerio':
    case 'cheerio-without-node-native':
    case 'react-native-cheerio':
      return cheerio;
    case 'crypto-js':
      return CryptoJS;
    default:
      throw new Error(`Module "${name}" is not available in browser plugins. Supported modules: cheerio and crypto-js. This scraper may need a native runtime.`);
  }
}

function loadPlugin(code: string, tmdbKey: string, settings: Record<string, unknown>, scraperId: string) {
  // Match Nuvio's runtime aliases inside the isolated worker. `window` here is
  // the worker global, with no access to the application's window or DOM.
  const bindings = globalThis as unknown as Record<string, unknown>;
  for (const name of ['global', 'window', 'self']) {
    if (bindings[name] === undefined) bindings[name] = globalThis;
  }
  // Nuvio exposes these as globals. Function parameters would collide with common
  // plugin declarations such as `const cheerio = require('cheerio')`.
  Object.assign(globalThis, { cheerio, CryptoJS, TMDB_API_KEY: tmdbKey, SCRAPER_SETTINGS: settings, SCRAPER_ID: scraperId });
  const module = { exports: {} };
  const run = new Function(
    'module', 'exports', 'require',
    `${code}\nreturn {
      getStreams: module.exports.getStreams || (typeof getStreams === 'function' ? getStreams : globalThis.getStreams),
      onSettings: module.exports.onSettings || (typeof onSettings === 'function' ? onSettings : globalThis.onSettings)
    };`,
  );
  const result = run(module, module.exports, pluginRequire);
  return result;
}

export function loadScraper(code: string, tmdbKey: string, settings: Record<string, unknown> = {}, scraperId = ''): (...args: unknown[]) => unknown {
  const { getStreams } = loadPlugin(code, tmdbKey, settings, scraperId);
  if (typeof getStreams !== 'function') throw new Error('No getStreams export. This scraper may require Nuvio native APIs.');
  return getStreams;
}

export async function executeScraper(request: ScraperRequest): Promise<unknown[]> {
  const { code, tmdbId, mediaType, season, episode, tmdbKey } = request;
  const getStreams = loadScraper(code, tmdbKey, request.settings, request.scraperId);
  const streams = await getStreams(tmdbId, mediaType, season, episode);
  return Array.isArray(streams) ? streams : [];
}

export async function executeScraperSettings(request: ScraperRequest): Promise<unknown[]> {
  const { onSettings } = loadPlugin(request.code, request.tmdbKey, request.settings || {}, request.scraperId || '');
  if (typeof onSettings !== 'function') throw new Error('This scraper does not export onSettings.');
  const layout = await onSettings();
  if (!Array.isArray(layout)) throw new Error('The scraper returned an invalid settings layout.');
  return layout;
}
