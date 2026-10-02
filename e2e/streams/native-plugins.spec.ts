import { expect, test } from '@playwright/test';

test('device plugin management button opens native settings and lists installed device providers', async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeCalls: Array<{ method: string; payload?: any }> = [];
    (window as any).__testCalls = bridgeCalls;
    (window as any).__bridgedTest = {
      playbridge: {
        capabilities: { nativePlugins: 1 },
        plugins: {
          status: async () => {
            bridgeCalls.push({ method: 'status' });
            return {
              available: true,
              enabled: !(window as any).__deviceDisabled,
              providers: [
                {
                  repoUrl: 'https://native-nuvio.test/manifest.json',
                  scraperId: 'native-cinema',
                  name: 'Nuvio Device Cinema',
                  enabled: true,
                  requiresApproval: false
                }
              ]
            };
          },
          resolve: async (request: any) => {
            bridgeCalls.push({ method: 'resolve', payload: request });
            return { streams: [], warnings: [] };
          },
          manage: async () => {
            bridgeCalls.push({ method: 'manage' });
            return { opened: true };
          }
        }
      }
    };
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Add an addon' }).click();
  const manager = page.getByRole('dialog', { name: 'Manage addons' });

  // Manage device plugins button must be visible
  const manageButton = manager.getByRole('button', { name: 'Manage device plugins' });
  await expect(manageButton).toBeVisible();

  // Device plugins section should list the installed provider
  await expect(manager.getByText('DEVICE PLUGINS · 1')).toBeVisible();
  await expect(manager.locator('.scraper-row').getByText('Nuvio Device Cinema')).toBeVisible();
  await expect(manager.getByText('Active on device')).toBeVisible();

  // Clicking button invokes bridge.manage()
  await manageButton.click();
  const calls = await page.evaluate(() => (window as any).__testCalls);
  expect(calls.some((c: any) => c.method === 'manage')).toBe(true);
  await page.evaluate(() => {
    (window as any).__deviceDisabled = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(manager.getByText('Disabled on device', { exact: true })).toBeVisible();
  await expect(manager.getByText('Device plugins are turned off.', { exact: false })).toBeVisible();
  await expect(manager.locator('.scraper-row').getByText('Nuvio Device Cinema')).toBeVisible();
});

test('empty web plugin list uses installed device providers and preserves Castle header normalization', async ({ page }) => {
  const addon = 'https://native-catalog.test';
  const show = { id: 'tt2861424', type: 'series', name: 'Rick and Morty' };
  const headers = {
    'User-Agent': 'DevicePlayer/2.0',
    Accept: 'video/*',
    'Accept-Language': 'en-US',
    'Accept-Encoding': 'gzip, deflate',
    Connection: 'keep-alive',
    'Sec-Fetch-Dest': 'video',
    Referer: 'https://device-media.test/',
    Authorization: 'Bearer native-device-token'
  };

  await page.addInitScript((headersArg) => {
    const bridgeCalls: Array<{ method: string; payload?: any }> = [];
    (window as any).__testCalls = bridgeCalls;
    (window as any).__bridgedTest = {
      playbridge: {
        capabilities: { nativePlugins: 1 },
        plugins: {
          status: async () => ({
            available: true,
            enabled: true,
            providers: [
              {
                repoUrl: 'https://device-provider.test/manifest.json',
                scraperId: 'device-cinema',
                name: 'Device Cinema',
                enabled: true,
                requiresApproval: false
              },
              { repoUrl: 'https://device-provider.test/manifest.json', scraperId: 'second-cinema', name: 'Second Cinema', enabled: true, requiresApproval: false }
            ]
          }),
          resolve: async (request: any) => {
            bridgeCalls.push({ method: 'resolve', payload: request });
            return {
              streams: [
                {
                  addonName: request.scraperIds[0] === 'device-cinema' ? 'Device Cinema' : 'Second Cinema',
                  addonUrl: request.repoUrl + ':' + request.scraperIds[0],
                  url: 'https://device-media.test/' + request.scraperIds[0] + '.mp4',
                  name: request.scraperIds[0] + ' [Native] - 1080P',
                  title: 'Rick and Morty S08E02',
                  headers: headersArg
                }
              ],
              warnings: []
            };
          },
          manage: async () => ({ opened: true })
        }
      }
    };
  }, headers);

  await page.route(`${addon}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === '/manifest.json'
      ? { id: 'native-catalog', name: 'Native Catalog', version: '1.0.0', types: ['series'], resources: ['catalog', 'meta', 'stream'], catalogs: [{ id: 'shows', type: 'series', name: 'Native Shows' }] }
      : path.startsWith('/catalog/') ? { metas: [show] }
      : path.startsWith('/stream/') ? { streams: [{ url: 'https://ordinary-media.test/stream.mp4', name: 'Ordinary addon stream' }] }
      : { meta: { ...show, videos: [{ id: 'tt2861424:8:2', season: 8, episode: 2, title: 'Valkyrick' }] } };
    return route.fulfill({ json });
  });

  await page.route('https://api.themoviedb.org/**', (route) => route.fulfill({ json: { tv_results: [{ id: 60625 }] } }));
  await page.route('https://device-media.test/**', (route) => route.abort());

  await page.goto('/');
  await page.getByRole('button', { name: 'Add an addon' }).click();
  const manager = page.getByRole('dialog', { name: 'Manage addons' });
  await manager.getByLabel('Addon manifest URL').fill(`${addon}/manifest.json`);
  await manager.getByRole('button', { name: 'Install', exact: true }).first().click();
  await expect(manager.locator('.addon-management-card').getByText('Native Catalog', { exact: true })).toBeVisible();

  // Enter TMDB API key but DO NOT install any web plugins
  await manager.getByLabel('TMDB API key', { exact: true }).fill('test-tmdb-key');
  await manager.getByRole('button', { name: 'Close', exact: true }).click();

  // Navigate to show and episode
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'View details for Rick and Morty', exact: true }).first().click();
  await page.locator('.episode-row').click();

  // Device provider stream should be resolved and displayed
  await expect(page.locator('.stream-result')).toHaveCount(3);
  await expect(page.locator('.stream-result').filter({ hasText: 'Ordinary addon stream' })).toHaveCount(1);
  await expect(page.locator('.stream-result-copy p')).toHaveText(['device-cinema [Native] - 1080P', 'second-cinema [Native] - 1080P']);

  // Verify resolve arguments received correct TMDB ID, season, episode, and mediaType
  const calls = await page.evaluate(() => (window as any).__testCalls);
  const resolves = calls.filter((c: any) => c.method === 'resolve');
  expect(resolves).toHaveLength(2);
  expect(resolves.map((c: any) => c.payload.scraperIds)).toEqual([['device-cinema'], ['second-cinema']]);
  const resolveCall = resolves[0];
  expect(resolveCall).toBeDefined();
  expect(resolveCall.payload).toMatchObject({
    repoUrl: 'https://device-provider.test/manifest.json',
    scraperIds: ['device-cinema'],
    tmdbId: '60625',
    mediaType: 'tv',
    season: 8,
    episode: 2
  });
  // Credentials must not be passed to native resolve
  expect(resolveCall.payload.tmdbKey).toBeUndefined();

  // Play stream and verify Castle header normalization in player
  await page.locator('.stream-result').filter({ hasText: 'device-cinema [Native]' }).getByRole('button', { name: 'Play', exact: true }).click();
  const player = page.locator('movi-player');
  await expect(player).toHaveAttribute('src', 'https://device-media.test/device-cinema.mp4');
  await expect(player).toHaveJSProperty('headers', {
    'User-Agent': 'DevicePlayer/2.0',
    Accept: 'video/*',
    'Accept-Language': 'en-US',
    Referer: 'https://device-media.test/',
    Authorization: 'Bearer native-device-token'
  });
});

test('prefers native resolution and avoids web worker fallback on native resolution failure', async ({ page }) => {
  const addon = 'https://fallback-catalog.test';
  const plugin = 'https://fallback-plugin.test';
  const show = { id: 'tt2861424', type: 'series', name: 'Rick and Morty' };
  let workerScriptFetched = false;

  await page.addInitScript(() => {
    (window as any).__bridgedTest = {
      playbridge: {
        capabilities: { nativePlugins: 1 },
        plugins: {
          status: async () => ({
            available: true,
            enabled: true,
            providers: [
              {
                repoUrl: 'https://fallback-plugin.test/manifest.json',
                scraperId: 'shared-scraper',
                name: 'Shared Scraper',
                enabled: true,
                requiresApproval: false
              }
            ]
          }),
          resolve: async () => {
            throw new Error('Native device resolver returned an error');
          },
          manage: async () => ({ opened: true })
        }
      }
    };
  });

  await page.route(`${addon}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === '/manifest.json'
      ? { id: 'fallback-catalog', name: 'Fallback Catalog', version: '1.0.0', types: ['series'], resources: ['catalog', 'meta'], catalogs: [{ id: 'shows', type: 'series', name: 'Fallback Shows' }] }
      : path.startsWith('/catalog/') ? { metas: [show] }
      : { meta: { ...show, videos: [{ id: 'tt2861424:8:2', season: 8, episode: 2, title: 'Valkyrick' }] } };
    return route.fulfill({ json });
  });

  await page.route('https://api.themoviedb.org/**', (route) => route.fulfill({ json: { tv_results: [{ id: 60625 }] } }));

  await page.route(`${plugin}/**`, (route) => {
    if (route.request().url().endsWith('/manifest.json')) {
      return route.fulfill({ json: { name: 'Shared Plugin Repo', scrapers: [
        { id: 'shared-scraper', name: 'Shared Scraper', filename: 'shared-scraper.js', supportedTypes: ['movie', 'tv'], enabled: true }
      ] } });
    }
    // Worker script should never be fetched for a device provider!
    workerScriptFetched = true;
    return route.abort();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Add an addon' }).click();
  const manager = page.getByRole('dialog', { name: 'Manage addons' });
  await manager.getByLabel('Addon manifest URL').fill(`${addon}/manifest.json`);
  await manager.getByRole('button', { name: 'Install', exact: true }).first().click();
  await expect(manager.locator('.addon-management-card').getByText('Fallback Catalog', { exact: true })).toBeVisible();

  await manager.getByLabel('Nuvio plugin repository URL').fill(`${plugin}/manifest.json`);
  await manager.getByRole('button', { name: 'Install', exact: true }).last().click();
  await expect(manager.getByText('Shared Plugin Repo', { exact: true })).toBeVisible();

  await manager.getByLabel('TMDB API key', { exact: true }).fill('test-tmdb-key');
  await manager.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'View details for Rick and Morty', exact: true }).first().click();
  await page.locator('.episode-row').click();

  // Warning is surfaced for the native failure
  await expect(page.locator('.stream-source-warning')).toContainText('Native device resolver returned an error');

  // Verify worker script was NEVER fetched
  expect(workerScriptFetched).toBe(false);
});

test('host reporting native plugins unavailable does not offer privileged native features', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__bridgedTest = {
      playbridge: {
        capabilities: { nativePlugins: 0 } // explicitly unavailable
      }
    };
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Add an addon' }).click();
  const manager = page.getByRole('dialog', { name: 'Manage addons' });

  // Manage device plugins button must NOT be present
  await expect(manager.getByRole('button', { name: 'Manage device plugins' })).toHaveCount(0);
  await expect(manager.getByText('DEVICE PLUGINS')).toHaveCount(0);
});

test('Play Store stub exposing plugins API with capability 0 and available false hides device plugin management', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__bridgedTest = {
      playbridge: {
        capabilities: { nativePlugins: 0 },
        plugins: {
          status: async () => ({
            available: false,
            enabled: false,
            providers: []
          }),
          resolve: async () => ({ streams: [], warnings: [] }),
          manage: async () => ({ opened: false })
        }
      }
    };
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Add an addon' }).click();
  const manager = page.getByRole('dialog', { name: 'Manage addons' });

  // Manage device plugins button must NOT be present
  await expect(manager.getByRole('button', { name: 'Manage device plugins' })).toHaveCount(0);
  await expect(manager.getByText('DEVICE PLUGINS')).toHaveCount(0);
});

