import * as cheerio from 'cheerio/slim';
import CryptoJS from 'crypto-js';

export type ScraperRequest = {
  code: string;
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  tmdbKey: string;
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

export function loadScraper(code: string, tmdbKey: string): (...args: unknown[]) => unknown {
  // Match Nuvio's runtime aliases inside the isolated worker. `window` here is
  // the worker global, with no access to the application's window or DOM.
  const bindings = globalThis as unknown as Record<string, unknown>;
  for (const name of ['global', 'window', 'self']) {
    if (bindings[name] === undefined) bindings[name] = globalThis;
  }
  // Nuvio exposes these as globals. Function parameters would collide with common
  // plugin declarations such as `const cheerio = require('cheerio')`.
  Object.assign(globalThis, { cheerio, CryptoJS, TMDB_API_KEY: tmdbKey, SCRAPER_SETTINGS: {} });
  const module = { exports: {} as { getStreams?: (...args: unknown[]) => unknown } };
  const run = new Function(
    'module', 'exports', 'require',
    `${code}\nreturn module.exports.getStreams ? module.exports : typeof getStreams === 'function' ? { getStreams } : module.exports;`,
  );
  const result = run(module, module.exports, pluginRequire);
  const getStreams = result?.getStreams || module.exports.getStreams ||
    (globalThis as typeof globalThis & { getStreams?: unknown }).getStreams;
  if (typeof getStreams !== 'function') throw new Error('No getStreams export. This scraper may require Nuvio native APIs.');
  return getStreams;
}

export async function executeScraper(request: ScraperRequest): Promise<unknown[]> {
  const { code, tmdbId, mediaType, season, episode, tmdbKey } = request;
  const getStreams = loadScraper(code, tmdbKey);
  const streams = await getStreams(tmdbId, mediaType, season, episode);
  return Array.isArray(streams) ? streams : [];
}
