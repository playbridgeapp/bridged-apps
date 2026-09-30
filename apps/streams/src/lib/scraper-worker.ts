/// <reference lib="webworker" />

import { executeScraper, type ScraperRequest } from './scraper-runtime';

self.onmessage = async (event: MessageEvent<ScraperRequest>) => {
  try {
    // A worker keeps third-party plugin code away from the app DOM and local storage.
    // Browser networking still obeys CORS; Node/native host APIs remain unavailable.
    const streams = await executeScraper(event.data);
    self.postMessage({ ok: true, streams });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Scraper failed.' });
  }
};
