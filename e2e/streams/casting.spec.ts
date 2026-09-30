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

async function enableStreamSelection(page: Page) {
  await openAddons(page);
  await expect(page.getByRole('switch', { name: 'Auto-select stream', exact: true })).not.toBeChecked();
  await page.getByLabel('Preferred resolution', { exact: true }).selectOption('1080p');
  await page.getByRole('region', { name: 'Stream selection settings' }).getByRole('button', { name: 'WEB-DL', exact: true }).click();
  await page.getByRole('switch', { name: 'Auto-select stream', exact: true }).check();
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close', exact: true }).click();
  await goTab(page, 'Home');
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
  await expect(manager.locator('.addon-management-card').getByText('Test Catalog', { exact: true })).toBeVisible();
  await manager.getByRole('button', { name: 'Close' }).click();
});

test('automatically plays a matching release, saves preferences, and leaves Back and reload manual', async ({ page }) => {
  await page.route(`${addon}/stream/movie/tt100.json`, (route) => route.fulfill({ json: { streams: [
    { name: '720p WEB-DL', url: 'https://media.test/low.mp4' },
    { name: '1080p REMUX', url: 'https://media.test/remux.mp4' },
    { name: '1080p WEB-DL', url: 'https://media.test/matching.mp4' }
  ] }, headers: { 'access-control-allow-origin': '*' } }));
  await enableStreamSelection(page);
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await page.locator('.detail-play').click();
  await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/matching.mp4');
  await page.getByRole('button', { name: 'Choose another stream' }).click();
  await expect(page.locator('.stream-panel')).toBeVisible();
  await expect(page.locator('movi-player')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.stream-results .stream-result')).toHaveCount(3);
  await expect(page.locator('movi-player')).toHaveCount(0);
  await page.locator('.stream-result').filter({ hasText: '720p WEB-DL' }).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/low.mp4');
  await page.goto('/#/settings/addons');
  await expect(page.getByRole('switch', { name: 'Auto-select stream', exact: true })).toBeChecked();
  await expect(page.getByLabel('Preferred resolution', { exact: true })).toHaveValue('1080p');
  await expect(page.getByRole('region', { name: 'Stream selection settings' }).getByRole('button', { name: 'WEB-DL', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('falls back to the manual stream list when required filters have no match', async ({ page }) => {
  await enableStreamSelection(page);
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await page.locator('.detail-play').click();
  await expect(page.locator('.stream-panel').getByRole('alert')).toContainText('No stream matches your auto-selection settings');
  await expect(page.getByText('Film Source', { exact: true })).toBeVisible();
  await expect(page.locator('movi-player')).toHaveCount(0);
  await page.locator('.stream-result .watch-button').click();
  await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/movie.mp4');
});

test('waits for the preferred provider instead of starting a faster matching provider', async ({ page }) => {
  await page.route(`${addon}/stream/movie/tt100.json`, (route) => route.fulfill({ json: { streams: [
    { name: '1080p WEB-DL', url: 'https://media.test/fast.mp4' }
  ] }, headers: { 'access-control-allow-origin': '*' } }));
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
  await page.route('https://preferred.test/**', async (route) => {
    if (route.request().url().endsWith('/manifest.json')) {
      await route.fulfill({ json: { id: 'preferred', name: 'Preferred Provider', version: '1.0.0', types: ['movie'],
        resources: ['stream'], catalogs: [] }, headers: { 'access-control-allow-origin': '*' } });
    } else {
      requested();
      await gate;
      await route.fulfill({ json: { streams: [{ name: '1080p WEB-DL', url: 'https://media.test/preferred.mp4' }] },
        headers: { 'access-control-allow-origin': '*' } });
    }
  });
  await openAddons(page);
  await page.getByLabel('Addon manifest URL').fill('https://preferred.test/manifest.json');
  await page.getByRole('button', { name: 'Install', exact: true }).first().click();
  await expect(page.getByLabel('Preferred provider', { exact: true }).locator('option', { hasText: 'Preferred Provider' })).toHaveCount(1);
  await page.getByLabel('Preferred resolution', { exact: true }).selectOption('1080p');
  await page.getByLabel('Preferred provider', { exact: true }).selectOption('https://preferred.test/manifest.json');
  await page.getByRole('region', { name: 'Stream selection settings' }).getByRole('button', { name: 'WEB-DL', exact: true }).click();
  await page.getByRole('switch', { name: 'Auto-select stream', exact: true }).check();
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close', exact: true }).click();
  await goTab(page, 'Home');
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await page.locator('.detail-play').click();
  await requestStarted;
  try {
    await expect(page.locator('.stream-result')).toHaveCount(1);
    await expect(page.locator('movi-player')).toHaveCount(0);
  } finally { release(); }
  await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/preferred.mp4');
});

test('uses automatic selection only for an explicit cast action', async ({ page }) => {
  await page.route(`${addon}/stream/movie/tt100.json`, (route) => route.fulfill({ json: { streams: [
    { name: '720p WEB-DL', url: 'https://media.test/low.mp4' },
    { name: '1080p WEB-DL', url: 'https://media.test/matching.mp4' }
  ] }, headers: { 'access-control-allow-origin': '*' } }));
  await enableStreamSelection(page);
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await page.getByRole('button', { name: 'Cast with auto-selection' }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).__streamTest.calls.length)).toBe(1);
  const calls = await page.evaluate(() => (window as any).__streamTest.calls);
  expect(calls[0].payload.items[0].url).toBe('https://media.test/matching.mp4');
  await expect(page.locator('movi-player')).toHaveCount(0);
});

for (const target of ['browser', 'cast'] as const) {
  test(`preserves a manually selected release across episodes during ${target} playback`, async ({ page }) => {
    await page.route(`${addon}/stream/series/**`, (route) => {
      const next = route.request().url().includes('1%3A2');
      return route.fulfill({ json: { streams: [
        ...(next ? [{ name: '1080p WEB-DL', url: 'https://media.test/preferred-next.mp4', behaviorHints: { bingeGroup: 'other' } }] : []),
        { name: '720p WEBRip', url: `https://media.test/manual-${next ? '2' : '1'}.mp4`, behaviorHints: { bingeGroup: 'manual' } }
      ] }, headers: { 'access-control-allow-origin': '*' } });
    });
    await enableStreamSelection(page);
    await page.getByRole('button', { name: 'View details for Sample Series' }).first().click();
    await page.getByRole('button', { name: /Pilot/ }).click();
    await expect(page.locator('.stream-panel').getByRole('alert')).toContainText('No stream matches');
    if (target === 'browser') {
      await page.locator('.stream-result .watch-button').click();
      await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/manual-1.mp4');
      await page.locator('movi-player').evaluate((element) => element.dispatchEvent(new Event('ended')));
      await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/manual-2.mp4');
    } else {
      await page.locator('.stream-result .cast-button').click();
      await page.evaluate(() => (window as any).__streamTest.session.dispatchEvent(new CustomEvent('needitems', { detail: { requestId: 'manual-next', count: 1 } })));
      await expect.poll(async () => page.evaluate(() => (window as any).__streamTest.calls.length)).toBe(2);
      const calls = await page.evaluate(() => (window as any).__streamTest.calls);
      expect(calls[1].payload.items[0].url).toBe('https://media.test/manual-2.mp4');
    }
  });
}

test('keeps automatic cast continuation within the required quality and release filters', async ({ page }) => {
  await page.route(`${addon}/stream/series/**`, (route) => {
    const next = route.request().url().includes('1%3A2');
    return route.fulfill({ json: { streams: next ? [
      { name: '720p WEB-DL', url: 'https://media.test/wrong-next.mp4', behaviorHints: { bingeGroup: 'original' } },
      { name: '1080p WEB-DL', url: 'https://media.test/matching-next.mp4', behaviorHints: { bingeGroup: 'different' } }
    ] : [{ name: '1080p WEB-DL', url: 'https://media.test/matching-first.mp4', behaviorHints: { bingeGroup: 'original' } }] },
    headers: { 'access-control-allow-origin': '*' } });
  });
  await enableStreamSelection(page);
  await page.getByRole('button', { name: 'View details for Sample Series' }).first().click();
  await page.getByRole('button', { name: 'Cast with auto-selection' }).click();
  await expect(page.getByText('Choose an episode to cast.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Pilot/ }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).__streamTest.calls.length)).toBe(1);
  await page.evaluate(() => (window as any).__streamTest.session.dispatchEvent(new CustomEvent('needitems', { detail: { requestId: 'auto-next', count: 1 } })));
  await expect.poll(async () => page.evaluate(() => (window as any).__streamTest.calls.length)).toBe(2);
  const calls = await page.evaluate(() => (window as any).__streamTest.calls);
  expect(calls[0].payload.items[0].url).toBe('https://media.test/matching-first.mp4');
  expect(calls[1].payload.items[0].url).toBe('https://media.test/matching-next.mp4');
  await expect(page.locator('movi-player')).toHaveCount(0);
});

test('shows a skeleton for an uncached deep link instead of exposing its media ID', async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
  await page.route(`${addon}/meta/series/ttCold.json`, async (route) => {
    requested();
    await gate;
    await route.fulfill({ json: { meta: { ...series, id: 'ttCold', name: 'Cold Series', videos: [
      { id: 'ttCold:1:1', season: 1, episode: 1, title: 'Cold Pilot' }
    ] } }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/#/series/ttCold?season=1');
  await requestStarted;
  try {
    await expect(page.locator('.detail-intro .title-skeleton')).toBeVisible();
    await expect(page.locator('.detail-intro')).not.toContainText('ttCold');
    await expect(page.locator('.detail-play')).toHaveCount(0);
    await expect(page).toHaveTitle('Loading title · Bridged Streams');
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Cold Series', exact: true })).toBeVisible();
  await expect(page.locator('.detail-intro .title-skeleton')).toHaveCount(0);
  await expect(page.locator('.season-trigger')).toContainText('Season 1');
});

test('keeps the cached title on refresh while updating its metadata', async ({ page }) => {
  await page.getByRole('button', { name: 'View details for Sample Series' }).first().click();
  await expect(page.locator('.detail-play')).toBeEnabled();
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
  await page.route(`${addon}/meta/series/tt200.json`, async (route) => {
    requested();
    await gate;
    await route.fulfill({ json: { meta: { ...series, name: 'Updated Sample Series' } },
      headers: { 'access-control-allow-origin': '*' } });
  });
  await page.reload();
  await requestStarted;
  try {
    await expect(page.getByRole('heading', { name: 'Sample Series', exact: true })).toBeVisible();
    await expect(page.locator('.detail-intro')).not.toContainText('tt200');
    await expect(page.locator('.detail-play')).toHaveText('Loading…');
    await expect(page.locator('.detail-play')).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Updated Sample Series', exact: true })).toBeVisible();
  await expect(page.locator('.detail-play')).toBeEnabled();
});

test('routes movie details and streams through browser Back and Forward', async ({ page }) => {
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await expect(page).toHaveURL(/#\/movie\/tt100$/);
  await page.locator('.detail-play').click();
  await expect(page).toHaveURL(/#\/movie\/tt100\/streams$/);
  await expect(page.getByText('Film Source')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Sample Film', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveTitle('Sample Film · Bridged Streams');
  await page.goForward();
  await expect(page.getByText('Film Source')).toBeVisible();
});

test('restores linked episodes after reload and returns to their selected season', async ({ page }) => {
  await page.route(`${addon}/meta/series/tt200.json`, (route) => route.fulfill({ json: { meta: { ...series, videos: [
    { id: 'tt200:1:1', season: 1, episode: 1, title: 'Pilot' },
    { id: 'tt200:2:1', season: 2, episode: 1, title: 'Season Two Premiere' }
  ] } }, headers: { 'access-control-allow-origin': '*' } }));
  await page.getByRole('button', { name: 'View details for Sample Series' }).first().click();
  await page.locator('.season-trigger').click();
  await page.locator('#season-options').getByRole('button', { name: /Season 2/ }).click();
  await expect(page).toHaveURL(/#\/series\/tt200\?season=2$/);
  await page.getByRole('button', { name: /Season Two Premiere/ }).click();
  await expect(page).toHaveURL(/#\/series\/tt200\/streams\?video=tt200%3A2%3A1&season=2&episode=1$/);
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Streams for Sample Series' })).toContainText('Season Two Premiere');
  await page.locator('.stream-back').click();
  await expect(page.locator('.season-trigger')).toContainText('Season 2');
  await expect(page.locator('.episode-row.selected')).toContainText('Season Two Premiere');
});

test('opens a direct movie link and gives its back button a safe home fallback', async ({ page }) => {
  await page.goto('/#/movie/tt100');
  await expect(page.getByRole('dialog', { name: 'Sample Film', exact: true })).toBeVisible();
  await expect(page.locator('.detail-play')).toBeEnabled();
  await page.getByRole('button', { name: 'Back to browsing' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('routes catalogs and settings panels and restores them with browser Back', async ({ page }) => {
  await page.getByRole('button', { name: 'View all Films from Test Catalog' }).click();
  await expect(page).toHaveURL(/#\/catalog\/test\/movie\/top$/);
  await page.reload();
  const catalog = page.getByRole('dialog', { name: 'Films catalog' });
  await expect(catalog).toBeVisible();
  await catalog.getByRole('button', { name: 'View details for Sample Film' }).click();
  await expect(page.locator('.detail-play')).toBeEnabled();
  await page.goBack();
  await expect(catalog).toBeVisible();
  await page.goBack();
  await openAccounts(page);
  await expect(page).toHaveURL(/#\/settings\/accounts$/);
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Connected accounts' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('browser Back closes playback and reloaded playback links require source selection', async ({ page }) => {
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await page.locator('.detail-play').click();
  await page.locator('.stream-overlay .watch-button').click();
  await expect(page).toHaveURL(/#\/movie\/tt100\/player$/);
  await expect(page.getByRole('dialog', { name: 'Now playing Sample Film' })).toBeVisible();
  await page.goBack();
  await expect(page.locator('movi-player')).toHaveCount(0);
  await expect(page.getByText('Film Source')).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('dialog', { name: 'Now playing Sample Film' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/#\/movie\/tt100\/streams$/);
  await expect(page.getByText('Film Source')).toBeVisible();
  await expect(page.locator('movi-player')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Sample Film', exact: true })).toBeVisible();
});

test('restores a search query from its URL without creating a history entry per keystroke', async ({ page }) => {
  await goTab(page, 'Search');
  const input = page.getByRole('textbox', { name: 'Search movies, TV shows, and sports' });
  const initialLength = await page.evaluate(() => history.length);
  await input.fill('Sample');
  await page.locator('.search-submit').click();
  await expect(page).toHaveURL(/#\/search\?q=Sample$/);
  expect(await page.evaluate(() => history.length)).toBe(initialLength);
  await page.reload();
  await expect(input).toHaveValue('Sample');
  const result = page.getByRole('region', { name: 'Search results' }).getByRole('button', { name: 'View details for Sample Film' });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator('.detail-play')).toBeEnabled();
  await page.goBack();
  await expect(input).toHaveValue('Sample');
  await expect(result).toBeVisible();
});

test('casts a selected movie as one tracked item', async ({ page }) => {
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await page.locator('.detail-play').click();
  await expect(page.getByText('Film Source')).toBeVisible();
  await page.getByRole('button', { name: 'Cast' }).click();
  const calls = await page.evaluate(() => (window as any).__streamTest.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('linkCast');
  expect(calls[0].payload.items[0].url).toBe('https://media.test/movie.mp4');
});

test('opens a movie in MoviPlayer without starting a cast', async ({ page }) => {
  await page.getByRole('button', { name: 'View details for Sample Film' }).click();
  await page.locator('.detail-play').click();
  await expect(page.getByText('Film Source')).toBeVisible();
  await page.locator('.stream-overlay .watch-button').click();
  await expect(page.getByRole('dialog', { name: 'Now playing Sample Film' })).toBeVisible();
  await expect(page.locator('movi-player')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__streamTest.calls)).toEqual([]);
  await page.getByRole('button', { name: 'Close player' }).click();
  await expect(page.locator('movi-player')).toHaveCount(0);
});

test('keeps a copyable report when the MoviPlayer module fails to load', async ({ page }) => {
  await openAddons(page);
  await page.getByRole('switch', { name: 'Native player fallback' }).uncheck();
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close' }).click();
  await goTab(page, 'Home');
  await page.route('**/*element*slim*.js*', (route) => route.abort());
  await page.getByRole('button', { name: 'View details for Sample Film' }).click();
  await page.locator('.detail-play').click();
  await page.locator('.stream-overlay .watch-button').click();
  const player = page.getByRole('dialog', { name: 'Now playing Sample Film' });
  await expect(player.getByText(/MoviPlayer could not load/)).toBeVisible();
  await player.locator('details.playback-diagnostics summary').click();
  const report = player.getByRole('textbox', { name: 'Playback diagnostic report' });
  await expect(report).toHaveValue(/player import failed/);
  expect(await report.inputValue()).not.toContain('http://127.0.0.1:5182');
  await player.getByRole('button', { name: 'Check player engine' }).click();
  await expect(report).toHaveValue(/"event": "WASM compile"/, { timeout: 20000 });
  await expect(player.getByRole('status')).toContainText('Player engine check passed');
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Streams for Sample Film' })).toBeVisible();
  await page.goto('/#/settings/addons');
  await page.getByRole('dialog', { name: 'Manage addons' }).locator('details.playback-diagnostics summary').click();
  const settingsReport = page.getByRole('dialog', { name: 'Manage addons' }).getByRole('textbox', { name: 'Playback diagnostic report' });
  await expect(settingsReport).toHaveValue(/player import failed/);
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

test('selects another season from the desktop detail menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(`${addon}/meta/series/tt200.json`, (route) => route.fulfill({ json: { meta: { ...series, videos: [
    { id: 'tt200:1:1', season: 1, episode: 1, title: 'Pilot' },
    { id: 'tt200:2:1', season: 2, episode: 1, title: 'Season Two Premiere' }
  ] } }, headers: { 'access-control-allow-origin': '*' } }));
  await page.getByRole('button', { name: 'View details for Sample Series' }).first().click();
  await page.locator('.season-trigger').click();
  await page.locator('#season-options').getByRole('button', { name: /Season 2/ }).click();
  await expect(page.locator('.season-trigger')).toContainText('Season 2');
  await expect(page.getByRole('button', { name: /Season Two Premiere/ })).toBeVisible();
});

test('shows recent searches only when the history button is opened', async ({ page }) => {
  await goTab(page, 'Search');
  const input = page.getByRole('textbox', { name: 'Search movies, TV shows, and sports' });
  await input.fill('Sample');
  await page.locator('.search-submit').click();
  await expect(page.getByRole('region', { name: 'Search results' }).getByRole('button', { name: 'View details for Sample Film' })).toBeVisible();
  await expect(page.locator('.search-form').getByRole('button', { name: 'Recent searches' })).toBeEnabled();

  await page.reload();
  await goTab(page, 'Search');
  const restoredInput = page.getByRole('textbox', { name: 'Search movies, TV shows, and sports' });
  await restoredInput.focus();
  await expect(page.getByRole('group', { name: 'Recent searches' })).toHaveCount(0);
  const historyButton = page.locator('.search-form').getByRole('button', { name: 'Recent searches' });
  await historyButton.click();
  await expect(page.getByRole('group', { name: 'Recent searches' }).getByRole('button', { name: 'Sample', exact: true })).toBeVisible();
  await historyButton.click();
  await expect(page.getByRole('group', { name: 'Recent searches' })).toHaveCount(0);
  await historyButton.click();
  await page.getByRole('group', { name: 'Recent searches' }).getByRole('button', { name: 'Sample', exact: true }).click();
  await expect(restoredInput).toHaveValue('Sample');
  await expect(page.getByRole('region', { name: 'Search results' }).getByRole('button', { name: 'View details for Sample Film' })).toBeVisible();
});

test('saves only the settled search text to history', async ({ page }) => {
  await goTab(page, 'Search');
  const input = page.getByRole('textbox', { name: 'Search movies, TV shows, and sports' });
  for (const partial of ['a', 'av', 'ave']) {
    await input.fill(partial);
    await page.waitForTimeout(450);
  }
  await input.fill('avengers');
  await expect(page.getByRole('region', { name: 'Search results' }).getByRole('button', { name: 'View details for Sample Film' })).toBeVisible();
  const historyButton = page.locator('.search-form').getByRole('button', { name: 'Recent searches' });
  await expect(historyButton).toBeDisabled();
  await expect(historyButton).toBeEnabled({ timeout: 5000 });
  await historyButton.click();
  const history = page.getByRole('group', { name: 'Recent searches' });
  await expect(history.locator('.search-history-query')).toHaveCount(1);
  await expect(history.getByRole('button', { name: 'avengers', exact: true })).toBeVisible();
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
  await expect(page.getByRole('dialog', { name: 'Manage addons' }).locator('.addon-management-card').getByText('Expanded Catalogs', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close' }).click();
  await goTab(page, 'Home');
  await expect(page.getByRole('heading', { name: 'New Films' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View details for New Film' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New Shows' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live Now' })).toBeVisible();
  await page.getByRole('button', { name: 'View details for Live Match' }).click();
  await page.locator('.detail-play').click();
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
  await expect(page.getByText('Test Plugins', { exact: true })).toBeVisible();
  await page.getByLabel('TMDB API key').fill('test-key');
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close' }).click();
  await goTab(page, 'Home');
  await page.getByRole('button', { name: 'View details for Sample Film' }).click();
  await page.locator('.detail-play').click();
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
  await page.getByRole('dialog', { name: 'Accounts' }).getByRole('button', { name: 'Sign in', exact: true }).click();
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
  await page.getByRole('dialog', { name: 'Accounts' }).getByRole('button', { name: 'Sign in', exact: true }).click();
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

test('loads more titles in a catalog row and its dedicated page', async ({ page }) => {
  const firstPage = Array.from({ length: 25 }, (_, index) => ({
    id: `tt9${String(index).padStart(3, '0')}`, type: 'movie', name: `Paged Film ${index + 1}`, poster: ''
  }));
  const secondPage = [26, 27].map((index) => ({
    id: `tt9${String(index).padStart(3, '0')}`, type: 'movie', name: `Paged Film ${index}`, poster: ''
  }));
  let secondPageRequests = 0;
  await page.route('https://paging.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path === '/manifest.json' ? {
      id: 'paging', name: 'Paged Addon', version: '1.0.0', types: ['movie'],
      resources: ['catalog', 'meta'],
      catalogs: [{ type: 'movie', id: 'paged', name: 'Paged Movies', extra: [{ name: 'skip' }] }]
    } : path.includes('/skip=25.json') ? (secondPageRequests++, { metas: secondPage })
      : path.includes('/skip=27.json') ? { metas: [] } : { metas: firstPage };
    await route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
  });

  await openAddons(page);
  await page.getByLabel('Addon manifest URL').fill('https://paging.test/manifest.json');
  await page.getByRole('button', { name: 'Install' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Manage addons' }).locator('.addon-management-card').getByText('Paged Addon', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close' }).click();
  await goTab(page, 'Home');
  await expect(page.getByRole('button', { name: 'View all Paged Movies from Paged Addon' })).toBeVisible();
  expect(secondPageRequests).toBe(0);
  await page.getByRole('button', { name: 'View all Paged Movies from Paged Addon' }).click();
  const catalog = page.getByRole('dialog', { name: 'Paged Movies catalog' });
  await expect(catalog.getByRole('button', { name: 'View details for Paged Film 1', exact: true })).toBeVisible();
  await expect(catalog.getByRole('button', { name: 'View details for Sample Film', exact: true })).toHaveCount(0);
  await expect(page).toHaveTitle('Paged Movies · Bridged Streams');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
  await catalog.getByRole('button', { name: 'View details for Paged Film 1', exact: true }).click();
  await expect(page).toHaveTitle('Paged Film 1 · Bridged Streams');
  await page.getByRole('button', { name: 'Back to browsing' }).click();
  await expect(page).toHaveTitle('Paged Movies · Bridged Streams');
  await catalog.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(catalog.getByRole('button', { name: 'View details for Paged Film 27', exact: true })).toBeVisible();
  await catalog.getByRole('button', { name: 'Back to home' }).click();
  await expect(page).toHaveTitle('Bridged Streams · PlayBridge');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

  const row = page.locator('.catalog-section').filter({ has: page.getByRole('heading', { name: 'Paged Movies' }) });
  await row.locator('.media-row').evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(row.getByRole('button', { name: 'View details for Paged Film 27', exact: true })).toBeVisible();
  expect(secondPageRequests).toBeGreaterThanOrEqual(2);
});

test('keeps the dock expanded when returning to a scrolled tab', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const dock = page.getByRole('navigation', { name: 'Main navigation' });
  await page.mouse.move(195, 450);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await page.mouse.wheel(0, 300);
  await expect(dock).toHaveClass(/compact/);
  await goTab(page, 'Settings');
  await expect(dock).not.toHaveClass(/compact/);
  await goTab(page, 'Home');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await expect(dock).not.toHaveClass(/compact/);
});
