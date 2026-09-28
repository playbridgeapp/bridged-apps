import { expect, test, type Page } from '@playwright/test';

const addon = 'https://addon.test';
const movie = { id: 'tt100', type: 'movie', name: 'Sample Film', poster: '' };
const series = { id: 'tt200', type: 'series', name: 'Sample Series', poster: '' };

async function goTab(page: Page, name: 'Home' | 'Search' | 'Library' | 'Settings') {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name }).click();
}

async function openAccounts(page: Page) {
  await goTab(page, 'Settings');
  await page.getByRole('button', { name: /Accounts and profiles/ }).click();
}

async function openAddons(page: Page) {
  await goTab(page, 'Settings');
  await page.getByRole('button', { name: /Addons and playback/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ method: string; payload: any }> = [];
    const session = new EventTarget() as EventTarget & {
      sessionId: string;
      provideItems: (requestId: string, result: any) => Promise<void>;
      unlink: () => Promise<void>;
    };
    session.sessionId = 'test-session';
    session.provideItems = async (requestId, result) => { calls.push({ method: 'provideItems', payload: { requestId, ...result } }); };
    session.unlink = async () => { calls.push({ method: 'unlink', payload: {} }); };
    (window as any).__streamTest = { calls, session };
    (window as any).playbridge = {
      cast: (payload: any) => calls.push({ method: 'cast', payload }),
      linkCast: async (payload: any) => { calls.push({ method: 'linkCast', payload }); return session; },
      capabilities: { linkedCast: true }
    };
  });
  await page.route(`${addon}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === '/manifest.json') data = {
      id: 'test', name: 'Test Catalog', version: '1.0.0', types: ['movie', 'series'],
      resources: ['catalog', 'meta', 'stream'],
      catalogs: [
        { type: 'movie', id: 'top', name: 'Films', extra: [{ name: 'search' }] },
        { type: 'series', id: 'top', name: 'Shows', extra: [{ name: 'search' }] }
      ]
    };
    else if (path.startsWith('/catalog/movie')) data = { metas: [movie] };
    else if (path.startsWith('/catalog/series')) data = { metas: [series] };
    else if (path === '/meta/movie/tt100.json') data = { meta: movie };
    else if (path === '/meta/series/tt200.json') data = { meta: { ...series, videos: [
      { id: 'tt200:1:1', season: 1, episode: 1, title: 'Pilot' },
      { id: 'tt200:1:2', season: 1, episode: 2, title: 'Next Episode' }
    ] } };
    else if (path.startsWith('/stream/movie')) data = { streams: [{ name: 'Film Source', url: 'https://media.test/movie.mp4' }] };
    else if (path === '/stream/series/tt200%3A1%3A1.json') data = { streams: [{ name: 'Episode Source', url: 'https://media.test/ep1.mp4' }] };
    else if (path === '/stream/series/tt200%3A1%3A2.json') data = { streams: [{ name: 'Episode Source', url: 'https://media.test/ep2.mp4' }] };
    await route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add an addon' }).click();
  await page.getByLabel('Addon manifest URL').fill(`${addon}/manifest.json`);
  await page.getByRole('button', { name: 'Install' }).first().click();
  const manager = page.getByRole('dialog', { name: 'Manage addons' });
  await expect(manager.getByText('Test Catalog', { exact: true })).toBeVisible();
  await manager.getByRole('button', { name: 'Close' }).click();
});

test('casts a selected movie as one direct item', async ({ page }) => {
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await expect(page.getByText('Film Source')).toBeVisible();
  await page.getByRole('button', { name: 'Cast' }).click();
  const calls = await page.evaluate(() => (window as any).__streamTest.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('cast');
  expect(calls[0].payload.url).toBe('https://media.test/movie.mp4');
});

test('opens a movie in MoviPlayer without starting a cast', async ({ page }) => {
  await page.getByRole('button', { name: 'View details for Sample Film' }).click();
  await expect(page.getByText('Film Source')).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Now playing Sample Film' })).toBeVisible();
  await expect(page.locator('movi-player')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__streamTest.calls)).toEqual([]);
  await page.getByRole('button', { name: 'Close player' }).click();
  await expect(page.locator('movi-player')).toHaveCount(0);
});

test('resolves the next episode only after PlayBridge requests it', async ({ page }) => {
  await page.getByRole('button', { name: 'View details for Sample Series' }).first().click();
  await page.getByRole('button', { name: /Pilot/ }).click();
  await expect(page.getByText('Episode Source')).toBeVisible();
  await page.getByRole('button', { name: 'Cast' }).click();
  let calls = await page.evaluate(() => (window as any).__streamTest.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('linkCast');
  expect(calls[0].payload.items[0].url).toBe('https://media.test/ep1.mp4');
  await page.evaluate(() => (window as any).__streamTest.session.dispatchEvent(new CustomEvent('needitems', { detail: { requestId: 'request-1', count: 1 } })));
  await expect.poll(async () => page.evaluate(() => (window as any).__streamTest.calls.length)).toBe(2);
  calls = await page.evaluate(() => (window as any).__streamTest.calls);
  expect(calls[1].method).toBe('provideItems');
  expect(calls[1].payload.items[0].url).toBe('https://media.test/ep2.mp4');
  expect(calls[1].payload.endOfList).toBe(true);
  await page.evaluate(() => (window as any).__streamTest.session.dispatchEvent(new CustomEvent('needitems', { detail: { requestId: 'request-1', count: 1 } })));
  expect(await page.evaluate(() => (window as any).__streamTest.calls.length)).toBe(2);
});

test('continues to the next episode in browser playback', async ({ page }) => {
  await page.getByRole('button', { name: 'View details for Sample Series' }).click();
  await page.getByRole('button', { name: /Pilot/ }).click();
  await expect(page.getByText('Episode Source')).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const player = page.locator('movi-player');
  await expect(player).toHaveAttribute('src', 'https://media.test/ep1.mp4');
  await player.evaluate((element) => element.dispatchEvent(new Event('ended')));
  await expect(player).toHaveAttribute('src', 'https://media.test/ep2.mp4');
  expect(await page.evaluate(() => (window as any).__streamTest.calls)).toEqual([]);
});

test('loads required year catalogs and browses and casts sport titles', async ({ page }) => {
  const manifest = {
    id: 'expanded', name: 'Expanded Catalogs', version: '1.0.0',
    types: ['movie', 'series', 'sport'], resources: ['catalog', 'meta', 'stream'],
    catalogs: [
      { type: 'movie', id: 'year', name: 'New Films', extra: [{ name: 'genre', isRequired: true, options: ['2026', '2025'] }] },
      { type: 'series', id: 'year', name: 'New Shows', extra: [{ name: 'genre', isRequired: true, options: ['2026', '2025'] }] },
      { type: 'sport', id: 'live', name: 'Live Now' }
    ]
  };
  const sport = { id: 'sport:1', type: 'sport', name: 'Live Match', poster: '' };
  await page.route('https://expanded.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === '/manifest.json') data = manifest;
    else if (path === '/catalog/movie/year/genre=2026.json') data = { metas: [{ id: 'tt400', type: 'movie', name: 'New Film' }] };
    else if (path === '/catalog/series/year/genre=2026.json') data = { metas: [{ id: 'tt500', type: 'series', name: 'New Show' }] };
    else if (path === '/catalog/sport/live.json') data = { metas: [sport] };
    else if (path === '/meta/sport/sport%3A1.json') data = { meta: sport };
    else if (path === '/stream/sport/sport%3A1.json') data = { streams: [{ name: 'Live Feed', url: 'https://media.test/live.m3u8' }] };
    await route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
  });
  await openAddons(page);
  await page.getByLabel('Addon manifest URL').fill('https://expanded.test/manifest.json');
  await page.getByRole('button', { name: 'Install' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Manage addons' }).getByText('Expanded Catalogs', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close' }).click();
  await goTab(page, 'Home');
  await expect(page.getByRole('heading', { name: 'New Films' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View details for New Film' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New Shows' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live Now' })).toBeVisible();
  await page.getByRole('button', { name: 'View details for Live Match' }).click();
  await expect(page.getByText('Live Feed')).toBeVisible();
  await page.getByRole('button', { name: 'Cast' }).click();
  const calls = await page.evaluate(() => (window as any).__streamTest.calls);
  expect(calls.at(-1)).toMatchObject({ method: 'cast', payload: { url: 'https://media.test/live.m3u8' } });
});

test('uses a browser-compatible Nuvio scraper for an IMDb movie', async ({ page }) => {
  await page.route('https://api.themoviedb.org/**', (route) => route.fulfill({ json: { movie_results: [{ id: 321 }] }, headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://plugins.test/**', (route) => {
    if (route.request().url().endsWith('/manifest.json')) {
      return route.fulfill({ json: { name: 'Test Plugins', version: '1.0.0', scrapers: [{ id: 'simple', name: 'Simple Scraper', filename: 'simple.js', supportedTypes: ['movie'] }] }, headers: { 'access-control-allow-origin': '*' } });
    }
    return route.fulfill({ body: 'module.exports.getStreams = async (id) => [{ name: "Plugin Source " + id, url: "https://media.test/plugin.mp4" }];', contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await openAddons(page);
  await page.getByLabel('Nuvio plugin repository URL').fill('https://plugins.test/manifest.json');
  await page.getByRole('button', { name: 'Install' }).last().click();
  await expect(page.getByText('Test Plugins')).toBeVisible();
  await page.getByLabel('TMDB API key').fill('test-key');
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close' }).click();
  await goTab(page, 'Home');
  await page.getByRole('button', { name: 'View details for Sample Film' }).click();
  await expect(page.getByText('Plugin Source 321')).toBeVisible();
});

test('imports Stremio account addons, library, and progress without removing local addons', async ({ page }) => {
  const accountManifest = {
    id: 'account-addon', name: 'Account Catalog', version: '1.0.0', types: ['movie'],
    resources: ['catalog', 'meta', 'stream'], catalogs: [{ id: 'saved', type: 'movie', name: 'Saved Picks' }]
  };
  let syncCount = 0;
  await page.route('https://api.strem.io/api/**', async (route) => {
    const method = route.request().url().split('/').pop();
    const body = route.request().postDataJSON();
    let result: unknown;
    if (method === 'login') {
      expect(body.email).toBe('viewer@example.com');
      expect(body.password).toBe('test-password');
      result = { authKey: 'test-auth-key', user: { _id: 'user-1', email: 'viewer@example.com' } };
    } else if (method === 'getUser') {
      result = { _id: 'user-1', email: 'viewer@example.com' };
    } else if (method === 'addonCollectionGet') {
      expect(body.authKey).toBe('test-auth-key');
      syncCount += 1;
      result = { addons: [{ transportUrl: 'https://account-addon.test/manifest.json', manifest: accountManifest }] };
    } else if (method === 'datastoreGet') {
      expect(body.collection).toBe('libraryItem');
      result = [{ _id: 'tt300', type: 'movie', name: 'Saved Movie', poster: '', removed: false,
        state: { timeOffset: 30_000, duration: 100_000, video_id: 'tt300', lastWatched: '2026-09-27T00:00:00.000Z' } }];
    } else throw new Error(`Unexpected Stremio endpoint ${method}`);
    await route.fulfill({ json: { result }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://account-addon.test/**', async (route) => {
    await route.fulfill({ json: { metas: [{ id: 'tt300', type: 'movie', name: 'Saved Movie' }] }, headers: { 'access-control-allow-origin': '*' } });
  });
  await openAccounts(page);
  await page.getByRole('dialog', { name: 'Accounts' }).getByLabel('Email', { exact: true }).first().fill('viewer@example.com');
  await page.getByRole('dialog', { name: 'Accounts' }).getByLabel('Password', { exact: true }).first().fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status').getByText('Synced 1 addons and 1 library titles.')).toBeVisible();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect.poll(() => syncCount).toBe(2);
  await page.getByRole('button', { name: 'Close account' }).click();
  await goTab(page, 'Home');
  await expect(page.getByRole('heading', { name: 'Saved Picks' })).toBeVisible();
  await goTab(page, 'Library');
  await expect(page.getByRole('button', { name: 'View details for Saved Movie' })).toContainText('30% watched');
  await openAccounts(page);
  await page.getByRole('button', { name: 'Disconnect this account' }).click();
  await page.getByRole('button', { name: 'Close account' }).click();
  await goTab(page, 'Home');
  await expect(page.getByRole('heading', { name: 'Films' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saved Picks' })).toHaveCount(0);
});

test('writes account addon changes, library membership, and linked TV progress to Stremio', async ({ page }) => {
  const accountManifest = {
    id: 'account-addon', name: 'Account Catalog', version: '1.0.0', types: ['movie'],
    resources: ['catalog', 'meta', 'stream'], catalogs: [{ id: 'saved', type: 'movie', name: 'Saved Picks' }]
  };
  let remoteAddons: Array<{ transportUrl: string; manifest: typeof accountManifest }> = [
    { transportUrl: 'https://account-addon.test/manifest.json', manifest: accountManifest }
  ];
  const remoteLibrary = new Map<string, any>();
  const addonWrites: typeof remoteAddons[] = [];
  const libraryWrites: any[] = [];
  await page.route('https://api.strem.io/api/**', async (route) => {
    const method = route.request().url().split('/').pop();
    const body = route.request().postDataJSON();
    let result: unknown;
    if (method === 'login') result = { authKey: 'test-auth-key', user: { _id: 'user-1', email: 'viewer@example.com' } };
    else if (method === 'addonCollectionGet') result = { addons: remoteAddons };
    else if (method === 'addonCollectionSet') {
      remoteAddons = body.addons;
      addonWrites.push(body.addons);
      result = { success: true };
    } else if (method === 'datastoreGet') result = [...remoteLibrary.values()];
    else if (method === 'datastorePut') {
      expect(body.collection).toBe('libraryItem');
      for (const record of body.changes) {
        remoteLibrary.set(record._id, record);
        libraryWrites.push(record);
      }
      result = { success: true };
    } else throw new Error(`Unexpected Stremio endpoint ${method}`);
    await route.fulfill({ json: { result }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://account-addon.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path === '/manifest.json' ? accountManifest : { metas: [movie] };
    await route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
  });

  await openAccounts(page);
  await page.getByRole('dialog', { name: 'Accounts' }).getByLabel('Email', { exact: true }).first().fill('viewer@example.com');
  await page.getByRole('dialog', { name: 'Accounts' }).getByLabel('Password', { exact: true }).first().fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status').getByText('Synced 1 addons and 0 library titles.')).toBeVisible();
  await page.getByRole('button', { name: 'Close account' }).click();

  await openAddons(page);
  await page.getByRole('button', { name: 'Remove Account Catalog' }).click();
  await page.getByRole('dialog', { name: 'Remove addon' }).getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => addonWrites.length).toBe(1);
  expect(addonWrites[0]).toEqual([]);
  await page.getByLabel('Addon manifest URL').fill('https://account-addon.test/manifest.json');
  await page.getByRole('button', { name: 'Install' }).first().click();
  await expect.poll(() => addonWrites.length).toBe(2);
  expect(addonWrites[1].map((addon) => addon.transportUrl)).toEqual(['https://account-addon.test/manifest.json']);
  await page.getByRole('button', { name: 'Close' }).click();

  await goTab(page, 'Home');
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await page.getByRole('button', { name: 'Add to Stremio library' }).click();
  await expect.poll(() => libraryWrites.length).toBe(1);
  expect(libraryWrites[0]).toMatchObject({ _id: 'tt100', removed: false, temp: false });
  await page.getByRole('button', { name: 'Remove from Stremio library' }).click();
  await expect.poll(() => libraryWrites.length).toBe(2);
  expect(libraryWrites[1]).toMatchObject({ _id: 'tt100', removed: true, temp: false });
  await page.getByRole('button', { name: 'Back to browsing' }).click();

  await page.getByRole('button', { name: 'View details for Sample Series' }).first().click();
  await page.getByRole('button', { name: /Pilot/ }).click();
  await expect(page.getByText('Episode Source')).toBeVisible();
  await page.getByRole('button', { name: 'Cast' }).click();
  await page.evaluate(() => (window as any).__streamTest.session.dispatchEvent(new CustomEvent('statechange', {
    detail: { state: 'playing', positionMs: 30_000, durationMs: 100_000,
      currentIndex: 0, items: [{ id: 'tt200:1:1' }] }
  })));
  await expect.poll(() => libraryWrites.length).toBe(3);
  expect(libraryWrites[2]).toMatchObject({
    _id: 'tt200', state: { video_id: 'tt200:1:1', timeOffset: 30_000, duration: 100_000 }
  });
});
