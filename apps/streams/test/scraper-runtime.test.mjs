import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeScraper, executeScraperSettings } from '../src/lib/scraper-runtime.ts';

const args = { tmdbId: '321', mediaType: 'tv', season: 2, episode: 3, tmdbKey: 'test-key' };

for (const name of ['cheerio', 'cheerio-without-node-native', 'react-native-cheerio']) {
  test(`supports ${name} selectors and CommonJS exports`, async () => {
    const streams = await executeScraper({ ...args, code: `
      const cheerio = require('${name}');
      module.exports.getStreams = async (id, type, season, episode) => {
        const $ = cheerio.load('<ul><li><a href="https://media.test/first.m3u8">First</a></li><li><a href="https://media.test/next.m3u8">Next &amp; best</a></li></ul>');
        return $('li').map((i, el) => ({url: $(el).find('a').attr('href'), name: $(el).text(), id, type, season, episode})).get();
      };
    ` });
    assert.deepEqual(streams[1], { url: 'https://media.test/next.m3u8', name: 'Next & best', id: '321', type: 'tv', season: 2, episode: 3 });
  });
}

test('supports crypto-js hashes and AES encrypted scraper data', async () => {
  const streams = await executeScraper({ ...args, code: `
    const CryptoJS = require('crypto-js');
    exports.getStreams = () => {
      const encrypted = CryptoJS.AES.encrypt('https://media.test/secret.mp4', 'test-passphrase');
      return [{url: CryptoJS.AES.decrypt(encrypted.toString(), 'test-passphrase').toString(CryptoJS.enc.Utf8), name: CryptoJS.SHA256('hello').toString()}];
    };
  ` });
  assert.equal(streams[0].url, 'https://media.test/secret.mp4');
  assert.equal(streams[0].name, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('globals and top-level getStreams match Nuvio bindings', async () => {
  const streams = await executeScraper({ ...args, code: `
    async function getStreams() {
      return [{url: cheerio.load('<a href="https://media.test/global.mp4">Test</a>')('a').attr('href'), name: CryptoJS.enc.Utf8.parse(TMDB_API_KEY).toString(CryptoJS.enc.Utf8), settings: SCRAPER_SETTINGS}];
    }
  ` });
  assert.deepEqual(streams[0], { url: 'https://media.test/global.mp4', name: 'test-key', settings: {} });
});

test('reports unsupported native modules with a useful error', async () => {
  await assert.rejects(executeScraper({ ...args, code: "const fs = require('fs');" }), /Module "fs" is not available in browser plugins/);
});

test('global exports and runtime aliases share settings and helpers', async () => {
  const previousGetStreams = globalThis.getStreams;
  try {
    const streams = await executeScraper({ ...args, code: `
      global.URL_VALIDATION_ENABLED = true;
      global.getStreams = () => [{
        url: 'https://media.test/global-export.mp4',
        name: global.TMDB_API_KEY,
        aliases: global === globalThis && window === globalThis && self === globalThis,
        settings: global.SCRAPER_SETTINGS === SCRAPER_SETTINGS,
      }];
    ` });
    assert.deepEqual(streams[0], { url: 'https://media.test/global-export.mp4', name: 'test-key', aliases: true, settings: true });
  } finally {
    if (previousGetStreams === undefined) delete globalThis.getStreams;
    else globalThis.getStreams = previousGetStreams;
    delete globalThis.URL_VALIDATION_ENABLED;
  }
});

test('passes scraper configuration and ID to playback and async onSettings', async () => {
  const request = { ...args, scraperId: 'configured', settings: { token: 'test-token', audio: 'dub', enabled: true }, code: `
    module.exports = {
      getStreams: () => [{ url: 'https://media.test/configured.mp4', settings: global.SCRAPER_SETTINGS, id: SCRAPER_ID }],
      onSettings: async () => [{ type: 'select', label: 'Audio', key: 'audio', defaultValue: SCRAPER_SETTINGS.audio }]
    };
  ` };
  assert.deepEqual(await executeScraper(request), [{ url: 'https://media.test/configured.mp4', settings: request.settings, id: 'configured' }]);
  assert.deepEqual(await executeScraperSettings(request), [{ type: 'select', label: 'Audio', key: 'audio', defaultValue: 'dub' }]);
});
