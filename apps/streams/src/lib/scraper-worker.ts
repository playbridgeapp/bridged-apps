/// <reference lib="webworker" />

type ScraperRequest = { code: string; tmdbId: string; mediaType: 'movie' | 'tv'; season?: number; episode?: number; tmdbKey: string };

self.onmessage = async (event: MessageEvent<ScraperRequest>) => {
  const { code, tmdbId, mediaType, season, episode, tmdbKey } = event.data;
  try {
    // A worker keeps third-party plugin code away from the app DOM and local storage.
    // Browser networking still obeys CORS. Native-only Nuvio host functions are absent.
    const module = { exports: {} as { getStreams?: (...args: unknown[]) => unknown } };
    const exports = module.exports;
    const run = new Function('module', 'exports', 'TMDB_API_KEY', 'SCRAPER_SETTINGS', `${code}\nreturn module.exports;`);
    const result = run(module, exports, tmdbKey, {});
    const getStreams = result?.getStreams || module.exports.getStreams;
    if (typeof getStreams !== 'function') throw new Error('No getStreams export. This scraper may require Nuvio native APIs.');
    const streams = await getStreams(tmdbId, mediaType, season, episode);
    self.postMessage({ ok: true, streams: Array.isArray(streams) ? streams : [] });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Scraper failed.' });
  }
};
