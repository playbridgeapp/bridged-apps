import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getNativePluginsBridge,
  isNativePluginsSupported,
  fetchNativePluginsStatus,
  resolveNativePluginStreams,
  manageDevicePlugins,
  cancelNativeResolution,
  hasNativePluginsApi,
  clearNativeStatusCache
} from '../src/lib/native-plugins.ts';
import { fetchPluginStreams } from '../src/lib/plugins.ts';
import { fetchStreams } from '../src/lib/addons.ts';

function createMockBridge(overrides = {}) {
  const calls = {
    status: 0,
    resolve: [],
    manage: 0,
    cancel: 0
  };

  const bridge = {
    async status() {
      calls.status += 1;
      return overrides.statusResult || {
        available: true,
        enabled: true,
        providers: [
          {
            repoUrl: 'https://native-repo.test/manifest.json',
            scraperId: 'native-cinema',
            name: 'Native Cinema',
            enabled: true,
            requiresApproval: false
          }
        ]
      };
    },
    async resolve(request) {
      calls.resolve.push(request);
      if (overrides.resolveError) throw overrides.resolveError;
      return overrides.resolveResult || {
        streams: [
          {
            addonName: 'Native Cinema',
            addonUrl: `${request.repoUrl}:${request.scraperIds[0]}`,
            url: 'https://media.test/stream.mp4',
            title: '1080p Stream',
            headers: {
              'User-Agent': 'NativePlayer/1.0',
              Connection: 'close',
              'Accept-Encoding': 'gzip',
              Referer: 'https://provider.test/'
            }
          }
        ],
        warnings: overrides.resolveWarnings || []
      };
    },
    async manage() {
      calls.manage += 1;
      if (overrides.manageError) throw overrides.manageError;
      return overrides.manageResult || { opened: true };
    },
    cancel() {
      calls.cancel += 1;
    }
  };

  return { bridge, calls };
}

test('bridge capability detection distinguishes supported, explicitly unavailable, and missing states', () => {
  // Direct bridge injection
  const { bridge } = createMockBridge();
  assert.equal(isNativePluginsSupported(bridge), true);
  assert.equal(getNativePluginsBridge(bridge), bridge);
  assert.equal(hasNativePluginsApi(bridge), true);

  // Global window mock handling with supported capability
  globalThis.window = {
    playbridge: {
      capabilities: { nativePlugins: 1 },
      plugins: bridge
    }
  };
  assert.equal(isNativePluginsSupported(), true);
  assert.equal(getNativePluginsBridge(), bridge);
  assert.equal(hasNativePluginsApi(), true);

  // Explicitly unavailable store build: capabilities.nativePlugins === 0 without plugins API
  globalThis.window.playbridge = {
    capabilities: { nativePlugins: 0 }
  };
  assert.equal(isNativePluginsSupported(), false);
  assert.equal(getNativePluginsBridge(), null);
  assert.equal(hasNativePluginsApi(), false);

  // Missing capability on standard browser / host without plugins API
  globalThis.window.playbridge = {};
  assert.equal(isNativePluginsSupported(), false);
  assert.equal(getNativePluginsBridge(), null);
  assert.equal(hasNativePluginsApi(), false);

  // Delayed readiness: capabilities.nativePlugins === 0 initially, but plugins API is present
  globalThis.window.playbridge = {
    capabilities: { nativePlugins: 0 },
    plugins: bridge
  };
  assert.equal(hasNativePluginsApi(), true);
  assert.equal(getNativePluginsBridge(), bridge);
  assert.equal(isNativePluginsSupported(), true);

  // Allowed __bridgedTest hook without modifying window.playbridge
  globalThis.window.playbridge = { cast: () => {} };
  globalThis.window.__bridgedTest = {
    playbridge: {
      capabilities: { nativePlugins: 1 },
      plugins: bridge
    }
  };
  assert.equal(isNativePluginsSupported(), true);
  assert.equal(getNativePluginsBridge(), bridge);
  assert.equal(hasNativePluginsApi(), true);

  delete globalThis.window;
});

test('prefers native resolution for device providers without running web worker', async () => {
  const { bridge, calls } = createMockBridge();
  const warnings = [];

  const repo = {
    manifestUrl: 'https://native-repo.test/manifest.json',
    name: 'Native Repo',
    scrapers: [
      {
        id: 'native-cinema',
        name: 'Native Cinema',
        filename: 'native-cinema.js',
        supportedTypes: ['movie', 'tv'],
        enabled: true
      }
    ]
  };

  // tmdb:12345 resolves directly without external TMDB lookup
  const streams = await fetchPluginStreams([repo], 'movie', 'tmdb:12345', '', undefined, undefined, (w) => warnings.push(w), bridge);

  assert.equal(calls.resolve.length, 1);
  assert.equal(calls.resolve[0].repoUrl, 'https://native-repo.test/manifest.json');
  assert.deepEqual(calls.resolve[0].scraperIds, ['native-cinema']);
  assert.equal(calls.resolve[0].tmdbId, '12345');
  assert.equal(calls.resolve[0].mediaType, 'movie');
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://media.test/stream.mp4');
  // Headers normalized with Castle-style client header removal
  assert.deepEqual(streams[0].headers, {
    'User-Agent': 'NativePlayer/1.0',
    Referer: 'https://provider.test/'
  });
  assert.equal(streams[0].headers.Connection, undefined);
  assert.equal(streams[0].headers['Accept-Encoding'], undefined);
});

test('never falls back to web worker code execution when native resolution fails', async () => {
  const { bridge, calls } = createMockBridge({
    resolveError: new Error('Native resolver failed')
  });
  const warnings = [];

  const repo = {
    manifestUrl: 'https://native-repo.test/manifest.json',
    name: 'Native Repo',
    scrapers: [
      {
        id: 'native-cinema',
        name: 'Native Cinema',
        // Invalid or non-existent file: if worker ran, it would fail to fetch or execute
        filename: 'unreachable://worker.js',
        supportedTypes: ['movie', 'tv'],
        enabled: true
      }
    ]
  };

  const streams = await fetchPluginStreams([repo], 'movie', 'tmdb:12345', '', undefined, undefined, (w) => warnings.push(w), bridge);

  assert.equal(calls.resolve.length, 1);
  assert.equal(streams.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Native resolver failed/);
});

test('never falls back to web worker when native provider requires approval or is disabled on device', async () => {
  // Provider requires approval
  const unapproved = createMockBridge({
    statusResult: {
      available: true,
      enabled: true,
      providers: [
        {
          repoUrl: 'https://native-repo.test/manifest.json',
          scraperId: 'native-cinema',
          name: 'Native Cinema',
          enabled: true,
          requiresApproval: true
        }
      ]
    }
  });

  const warnings1 = [];
  const repo = {
    manifestUrl: 'https://native-repo.test/manifest.json',
    name: 'Native Repo',
    scrapers: [{ id: 'native-cinema', name: 'Native Cinema', filename: 'unreachable://worker.js', supportedTypes: ['movie'], enabled: true }]
  };

  const streams1 = await fetchPluginStreams([repo], 'movie', 'tmdb:12345', '', undefined, undefined, (w) => warnings1.push(w), unapproved.bridge);
  assert.equal(streams1.length, 0);
  assert.equal(unapproved.calls.resolve.length, 0);
  assert.match(warnings1[0], /requires approval in device settings/);

  // Provider disabled on device
  const disabled = createMockBridge({
    statusResult: {
      available: true,
      enabled: true,
      providers: [
        {
          repoUrl: 'https://native-repo.test/manifest.json',
          scraperId: 'native-cinema',
          name: 'Native Cinema',
          enabled: false,
          requiresApproval: false
        }
      ]
    }
  });

  const warnings2 = [];
  const streams2 = await fetchPluginStreams([repo], 'movie', 'tmdb:12345', '', undefined, undefined, (w) => warnings2.push(w), disabled.bridge);
  assert.equal(streams2.length, 0);
  assert.equal(disabled.calls.resolve.length, 0);
  assert.match(warnings2[0], /disabled on this device/);
});

test('respects both applicable enabled toggles without duplicate results', async () => {
  const { bridge, calls } = createMockBridge();
  const warnings = [];

  // Scraper disabled in web repo settings even though enabled on device
  const repo = {
    manifestUrl: 'https://native-repo.test/manifest.json',
    name: 'Native Repo',
    scrapers: [
      {
        id: 'native-cinema',
        name: 'Native Cinema',
        filename: 'unreachable://worker.js',
        supportedTypes: ['movie'],
        enabled: false // web toggle off!
      }
    ]
  };

  const streams = await fetchPluginStreams([repo], 'movie', 'tmdb:12345', '', undefined, undefined, (w) => warnings.push(w), bridge);
  assert.equal(streams.length, 0);
  assert.equal(calls.resolve.length, 0);
});

test('resolves installed native providers when web plugin list is empty', async () => {
  const { bridge, calls } = createMockBridge();
  const warnings = [];

  // fetchStreams called with empty plugins list (plugins = [])
  const streams = await fetchStreams([], 'movie', 'tmdb:54321', [], '', (w) => warnings.push(w), undefined, false, bridge);

  assert.equal(calls.resolve.length, 1);
  assert.equal(calls.resolve[0].tmdbId, '54321');
  assert.equal(calls.resolve[0].mediaType, 'movie');
  assert.equal(calls.resolve[0].repoUrl, 'https://native-repo.test/manifest.json');
  assert.deepEqual(calls.resolve[0].scraperIds, ['native-cinema']);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://media.test/stream.mp4');
  assert.equal(streams[0].addonName, 'Native Cinema');
});

test('passes correct TV coordinates (season, episode, mediaType tv) and never leaks web secrets', async () => {
  const { bridge, calls } = createMockBridge();

  const streams = await fetchStreams([], 'series', 'tmdb:60625:8:2', [], 'secret-tmdb-key', undefined, undefined, false, bridge);

  assert.equal(calls.resolve.length, 1);
  const req = calls.resolve[0];
  assert.equal(req.mediaType, 'tv');
  assert.equal(req.tmdbId, '60625');
  assert.equal(req.season, 8);
  assert.equal(req.episode, 2);
  // Must NOT include tmdbKey, settings, credentials or code
  assert.equal(req.tmdbKey, undefined);
  assert.equal(req.settings, undefined);
  assert.equal(req.code, undefined);
  assert.equal(req.credentials, undefined);
  assert.equal(streams.length, 1);
});

test('manageDevicePlugins opens native settings directly', async () => {
  const { bridge, calls } = createMockBridge({
    manageResult: { opened: true }
  });

  const opened = await manageDevicePlugins(bridge);
  assert.equal(opened, true);
  assert.equal(calls.manage, 1);
});

test('manageDevicePlugins throws clear user-facing error when unavailable', async () => {
  await assert.rejects(
    () => manageDevicePlugins(null),
    { message: 'Device plugin settings are not available on this device.' }
  );
});

test('cancelNativeResolution invokes bridge.cancel', () => {
  const { bridge, calls } = createMockBridge();
  cancelNativeResolution(bridge);
  assert.equal(calls.cancel, 1);
});

test('batches scraper IDs into chunks of at most 32 per bridge call', async () => {
  const { bridge, calls } = createMockBridge();
  const ids = Array.from({ length: 40 }, (_, i) => `scraper-${i}`);
  const result = await resolveNativePluginStreams({
    repoUrl: 'https://test.repo/manifest.json',
    scraperIds: ids,
    tmdbId: '1234',
    mediaType: 'movie'
  }, bridge);

  assert.equal(calls.resolve.length, 2);
  assert.equal(calls.resolve[0].scraperIds.length, 32);
  assert.equal(calls.resolve[1].scraperIds.length, 8);
  assert.equal(result.streams.length, 2);
});

test('limits simultaneous native resolution calls to at most 4 per document', async () => {
  let active = 0;
  let maxActive = 0;
  const customBridge = {
    async status() { return { available: true, enabled: true, providers: [] }; },
    async resolve(request) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return { streams: [], warnings: [] };
    },
    async manage() { return { opened: true }; }
  };

  const promises = Array.from({ length: 10 }, (_, i) =>
    resolveNativePluginStreams({
      repoUrl: 'https://test.repo/manifest.json',
      scraperIds: [`s-${i}`],
      tmdbId: '123',
      mediaType: 'movie'
    }, customBridge)
  );

  await Promise.all(promises);
  assert.ok(maxActive <= 4, `Max active calls was ${maxActive}, expected <= 4`);
});

test('avoids calling resolve when native enabled is false and displays safe warning', async () => {
  const { bridge, calls } = createMockBridge({
    statusResult: {
      available: true,
      enabled: false,
      providers: [
        {
          repoUrl: 'https://native-repo.test/manifest.json',
          scraperId: 'native-cinema',
          name: 'Native Cinema',
          enabled: true,
          requiresApproval: false
        }
      ]
    }
  });

  const warnings = [];
  const repo = {
    manifestUrl: 'https://native-repo.test/manifest.json',
    name: 'Native Repo',
    scrapers: [{ id: 'native-cinema', name: 'Native Cinema', filename: '', supportedTypes: ['movie'], enabled: true }]
  };

  const streams = await fetchPluginStreams([repo], 'movie', 'tmdb:12345', '', undefined, undefined, (w) => warnings.push(w), bridge);
  assert.equal(calls.resolve.length, 0);
  assert.equal(streams.length, 0);
  assert.match(warnings[0], /disabled on this device/);
});

test('displays safe warning when native scraper is not installed on device', async () => {
  const { bridge, calls } = createMockBridge({
    statusResult: {
      available: true,
      enabled: true,
      providers: [] // empty: scraper is not installed
    }
  });

  const warnings = [];
  const repo = {
    manifestUrl: 'https://native-repo.test/manifest.json',
    name: 'Native Repo',
    scrapers: [{ id: 'missing-scraper', name: 'Missing Scraper', filename: '', supportedPlatforms: ['android'], supportedTypes: ['movie'], enabled: true }]
  };

  const streams = await fetchPluginStreams([repo], 'movie', 'tmdb:12345', '', undefined, undefined, (w) => warnings.push(w), bridge);
  assert.equal(calls.resolve.length, 0);
  assert.equal(streams.length, 0);
  assert.match(warnings[0], /is not installed on this device/);
});

test('route cancellation with >4 queued calls prevents queued calls from resolving native streams', async () => {
  let resolveCalls = 0;
  const bridge = {
    async status() {
      return { available: true, enabled: true, providers: [] };
    },
    async resolve() {
      resolveCalls += 1;
      // Delay to ensure subsequent calls queue up
      await new Promise((r) => setTimeout(r, 60));
      return { streams: [], warnings: [] };
    },
    cancel() {}
  };

  const promises = [];
  // Launch 8 calls: 4 should become active, 4 should wait in queue
  for (let i = 0; i < 8; i++) {
    promises.push(resolveNativePluginStreams({
      repoUrl: 'https://native-repo.test/manifest.json',
      scraperIds: [`scraper-${i}`],
      tmdbId: 'tmdb:100',
      mediaType: 'movie'
    }, bridge));
  }

  // Allow the first 4 calls to acquire slots and enter bridge.resolve
  await new Promise((r) => setTimeout(r, 10));

  // Trigger cancellation as if user changed route
  cancelNativeResolution(bridge);

  const results = await Promise.all(promises);
  assert.equal(results.length, 8);
  // Only the initial active calls could have called bridge.resolve; none of the queued calls (calls 5-8) did
  assert.ok(resolveCalls <= 4, `Expected <= 4 calls reached bridge.resolve, got ${resolveCalls}`);
});

test('delayed capability readiness allows status check and does not start worker fallback', async () => {
  const { bridge, calls } = createMockBridge({
    statusResult: {
      available: true,
      enabled: true,
      providers: [
        {
          repoUrl: 'https://native-repo.test/manifest.json',
          scraperId: 'delayed-scraper',
          name: 'Delayed Scraper',
          enabled: true,
          requiresApproval: false
        }
      ]
    },
    resolveResult: {
      streams: [{ url: 'https://cdn.test/stream.m3u8', addonName: 'Delayed Scraper' }],
      warnings: []
    }
  });

  // Host initially has capabilities.nativePlugins = 0 before native signals ready
  globalThis.window = {
    playbridge: {
      capabilities: { nativePlugins: 0 },
      plugins: bridge
    }
  };

  const repo = {
    manifestUrl: 'https://native-repo.test/manifest.json',
    name: 'Delayed Repo',
    scrapers: [{ id: 'delayed-scraper', name: 'Delayed Scraper', filename: 'scraper.js', supportedTypes: ['movie'], enabled: true }]
  };

  const streams = await fetchPluginStreams([repo], 'movie', 'tmdb:999', '', undefined, undefined, () => {});
  assert.equal(calls.status, 1, 'Native status should be queried despite capability initially 0');
  assert.equal(calls.resolve.length, 1, 'Native resolve should be called without worker fallback');
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.test/stream.m3u8');

  delete globalThis.window;
});

test('status failure or disconnection fails closed with safe warning and no worker fallback', async () => {
  let fetchWorkerJsCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('scraper.js')) {
      fetchWorkerJsCalled = true;
      return new Response('/* worker js */', { status: 200 });
    }
    return originalFetch ? originalFetch(url) : new Response('', { status: 404 });
  };

  try {
    const errorBridge = {
      async status() {
        throw new Error('Bridge disconnected');
      },
      async resolve() {
        return { streams: [], warnings: [] };
      }
    };

    const warnings = [];
    const repo = {
      manifestUrl: 'https://native-repo.test/manifest.json',
      name: 'Native Repo',
      scrapers: [
        {
          id: 'native-scraper',
          name: 'Native Scraper',
          filename: 'scraper.js',
          supportedPlatforms: ['android'], // Native target
          supportedTypes: ['movie'],
          enabled: true
        }
      ]
    };

    const streams = await fetchPluginStreams([repo], 'movie', 'tmdb:123', '', undefined, undefined, (w) => warnings.push(w), errorBridge);
    assert.equal(streams.length, 0);
    assert.equal(fetchWorkerJsCalled, false, 'Must NOT attempt to fetch or run worker JS on status error');
    assert.ok(warnings.some((w) => w.includes('Device plugin engine is unavailable.')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('addons does not filter out non-platformCompatible missing-native providers when native API is present and surfaces warning', async () => {
  const { bridge } = createMockBridge({
    statusResult: {
      available: true,
      enabled: true,
      providers: [] // Empty: missing from device
    }
  });

  const warnings = [];
  const repo = {
    manifestUrl: 'https://native-repo.test/manifest.json',
    name: 'Native Repo',
    scrapers: [
      {
        id: 'missing-android-scraper',
        name: 'Android Scraper',
        filename: 'scraper.js',
        supportedPlatforms: ['android'], // Not browser-compatible
        supportedTypes: ['movie'],
        enabled: true
      }
    ]
  };

  const streams = await fetchStreams(
    [], // no installed addons
    'movie',
    'tmdb:123',
    [repo], // plugins
    '', // tmdbKey
    (w) => warnings.push(w),
    undefined,
    false,
    bridge
  );

  assert.equal(streams.length, 0);
  assert.ok(
    warnings.some((w) => w.includes('Android Scraper is not installed on this device.')),
    `Expected missing device warning, got: ${JSON.stringify(warnings)}`
  );
});

test('Play Store stub with capability 0 and available: false hides native support once status is queried', async () => {
  const playStubBridge = {
    async status() {
      return {
        available: false,
        enabled: false,
        providers: []
      };
    },
    async resolve() {
      return { streams: [], warnings: [] };
    }
  };

  globalThis.window = {
    playbridge: {
      capabilities: { nativePlugins: 0 },
      plugins: playStubBridge
    }
  };

  const status = await fetchNativePluginsStatus();
  assert.equal(status?.available, false);
  // Once status reports available: false, isNativePluginsSupported must report false
  assert.equal(isNativePluginsSupported(), false);

  delete globalThis.window;
});

test('status failure in FOSS fails closed for all plugin resolution without worker fallback', async () => {
  let workerExecuted = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('browser-scraper.js')) {
      workerExecuted = true;
      return new Response('/* worker code */', { status: 200 });
    }
    return originalFetch ? originalFetch(url) : new Response('', { status: 404 });
  };

  try {
    const brokenBridge = {
      async status() {
        throw new Error('Native service disconnected');
      },
      async resolve() {
        return { streams: [], warnings: [] };
      }
    };

    const warnings = [];
    const repo = {
      manifestUrl: 'https://any-repo.test/manifest.json',
      name: 'Any Repo',
      scrapers: [
        {
          id: 'browser-scraper',
          name: 'Browser Scraper',
          filename: 'browser-scraper.js',
          supportedTypes: ['movie'],
          enabled: true
        }
      ]
    };

    const streams = await fetchPluginStreams([repo], 'movie', 'tmdb:456', '', undefined, undefined, (w) => warnings.push(w), brokenBridge);
    assert.equal(streams.length, 0);
    assert.equal(workerExecuted, false, 'Must not execute worker on native status failure');
    assert.ok(warnings.some((w) => w.includes('Device plugin engine is unavailable.')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('addons.fetchStreams preserves ordinary addon streams when native status rejects', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/stream/movie/tt1234567.json')) {
      return new Response(JSON.stringify({
        streams: [{ title: 'Ordinary 1080p Addon Stream', url: 'https://stream.test/video.mp4' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Not found', { status: 404 });
  };

  try {
    const brokenBridge = {
      async status() {
        throw new Error('Bridge crashed');
      },
      async resolve() {
        return { streams: [], warnings: [] };
      }
    };

    const addon = {
      manifestUrl: 'https://cinema-addon.test/manifest.json',
      manifest: {
        id: 'cinema.addon',
        name: 'Cinema Addon',
        version: '1.0.0',
        description: 'Test addon',
        resources: ['stream'],
        types: ['movie'],
        catalogs: []
      }
    };

    const warnings = [];
    const streams = await fetchStreams(
      [addon],
      'movie',
      'tt1234567',
      [],
      '',
      (w) => warnings.push(w),
      undefined,
      false,
      brokenBridge
    );

    assert.equal(streams.length, 1);
    assert.equal(streams[0].title, 'Ordinary 1080p Addon Stream');
    assert.equal(streams[0].url, 'https://stream.test/video.mp4');
    assert.ok(warnings.some((w) => w.includes('Device plugin engine is unavailable.')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('status cache is bridge identity-scoped and clearNativeStatusCache invalidates pending in-flight status', async () => {
  let bridge1StatusCalls = 0;
  const bridge1 = {
    async status() {
      bridge1StatusCalls += 1;
      return { available: true, enabled: true, providers: [{ repoUrl: 'https://b1.test/manifest.json', scraperId: 's1', name: 'B1' }] };
    },
    async resolve() { return { streams: [], warnings: [] }; }
  };

  let bridge2StatusCalls = 0;
  const bridge2 = {
    async status() {
      bridge2StatusCalls += 1;
      return { available: true, enabled: false, providers: [{ repoUrl: 'https://b2.test/manifest.json', scraperId: 's2', name: 'B2' }] };
    },
    async resolve() { return { streams: [], warnings: [] }; }
  };

  // Bridge 1 and Bridge 2 have independent caches
  const s1 = await fetchNativePluginsStatus(bridge1);
  const s2 = await fetchNativePluginsStatus(bridge2);
  assert.equal(s1?.enabled, true);
  assert.equal(s2?.enabled, false);

  // Calling again hits cache
  await fetchNativePluginsStatus(bridge1);
  await fetchNativePluginsStatus(bridge2);
  assert.equal(bridge1StatusCalls, 1);
  assert.equal(bridge2StatusCalls, 1);

  // Stale in-flight status does not overwrite newer cache when clearNativeStatusCache is called
  let slowBridgeCalls = 0;
  const slowBridge = {
    async status() {
      slowBridgeCalls += 1;
      await new Promise((r) => setTimeout(r, 40));
      return { available: true, enabled: true, providers: [{ repoUrl: 'https://slow.test/manifest.json', scraperId: 'slow-old', name: 'Slow Old' }] };
    },
    async resolve() { return { streams: [], warnings: [] }; }
  };

  // Launch in-flight status
  const pendingPromise = fetchNativePluginsStatus(slowBridge);
  // Clear cache while in-flight
  clearNativeStatusCache();
  await pendingPromise;

  // Next call must re-fetch rather than using the superseded in-flight result
  await fetchNativePluginsStatus(slowBridge);
  assert.equal(slowBridgeCalls, 2);
});




test('individual stream source never merges or resolves unrelated device providers', async () => {
  const { bridge, calls } = createMockBridge({ statusResult: {
    available: true, enabled: true, providers: ['one', 'two'].map(scraperId => ({
      repoUrl: 'https://native-repo.test/manifest.json', scraperId, name: scraperId,
      enabled: true, requiresApproval: false
    }))
  }});
  const repo = { manifestUrl: 'https://native-repo.test/manifest.json', name: 'Repo',
    scrapers: [{ id: 'one', name: 'one', filename: '', supportedTypes: ['movie'], enabled: true }] };
  await fetchStreams([], 'movie', 'tmdb:54321', [repo], '', undefined, undefined, false, bridge, false);
  assert.deepEqual(calls.resolve.map(call => call.scraperIds), [['one']]);
  await fetchStreams([], 'movie', 'tmdb:54321', [], '', undefined, undefined, false, bridge, false);
  assert.equal(calls.resolve.length, 1);
});

test('native stream results cannot bypass a newly disabled device provider through browser cache', async () => {
  const { bridge, calls } = createMockBridge();
  const repo = { manifestUrl: 'https://native-repo.test/manifest.json', name: 'Repo',
    scrapers: [{ id: 'native-cinema', name: 'Native Cinema', filename: '', supportedTypes: ['movie'], enabled: true }] };
  assert.equal((await fetchStreams([], 'movie', 'tmdb:76543', [repo], '', undefined, undefined, false, bridge, false)).length, 1);
  bridge.status = async () => ({ available: true, enabled: false, providers: [] });
  clearNativeStatusCache();
  assert.equal((await fetchStreams([], 'movie', 'tmdb:76543', [repo], '', undefined, undefined, false, bridge, false)).length, 0);
  assert.equal(calls.resolve.length, 1);
});

test('malformed device status fails closed rather than treating missing approval as approved', async () => {
  const { bridge } = createMockBridge({statusResult: { available: true, enabled: true,
    providers: [{ repoUrl: 'https://native-repo.test/manifest.json', scraperId: 'native-cinema' }] }});
  const status = await fetchNativePluginsStatus(bridge);
  assert.equal(status.providers[0].enabled, false);
  assert.equal(status.providers[0].requiresApproval, true);
});
