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

test('opens cached catalogs, title details, and URL search while an addon manifest is still restoring', async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
  await page.route(`${addon}/manifest.json`, async (route) => {
    requested();
    await gate;
    await route.fallback();
  });
  try {
    await page.reload();
    await requestStarted;
    await page.getByRole('button', { name: 'View all Films from Test Catalog' }).click();
    await expect(page.getByRole('dialog', { name: 'Films catalog' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Films catalog' }).getByRole('button', { name: 'View details for Sample Film' }).click();
    await expect(page.locator('.detail-play')).toBeEnabled();
    await page.locator('.detail-play').click();
    await expect(page.getByText('Film Source', { exact: true })).toBeVisible();
    await page.goto('/#/search?q=Sample');
    await expect(page.locator('.search-results').getByRole('button', { name: 'View details for Sample Film' })).toBeVisible();
  } finally { release(); }
});

async function enableTmdbEnrichment(page: Page) {
  await goTab(page, 'Settings');
  await page.getByRole('button', { name: /^Integrations/ }).click();
  await expect(page.getByRole('switch', { name: 'TMDB enrichment', exact: true })).not.toBeChecked();
  await page.getByRole('dialog', { name: 'Integrations' }).getByLabel('TMDB API key', { exact: true }).fill('test-tmdb-key');
  await page.getByRole('switch', { name: 'TMDB enrichment', exact: true }).check();
  await page.getByRole('dialog', { name: 'Integrations' }).getByRole('button', { name: 'Close', exact: true }).click();
  await goTab(page, 'Home');
}

async function mockTmdb(page: Page) {
  const requests: string[] = [];
  await page.route('https://image.tmdb.org/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('https://i.ytimg.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('https://api.themoviedb.org/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    let data: unknown = {};
    if (path === '/3/find/tt100') data = { movie_results: [{ id: 321 }] };
    else if (path === '/3/find/tt200') data = { tv_results: [{ id: 900 }] };
    else if (path === '/3/movie/321') data = { id: 321, title: 'Enriched Film', overview: 'Extra film overview', runtime: 123,
      poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg', status: 'Released', original_language: 'en',
      genres: [{ name: 'Adventure' }], vote_average: 7.5, production_countries: [{ name: 'Canada' }],
      credits: { cast: [{ id: 1, name: 'Example Actor', character: 'Hero', profile_path: '/actor.jpg' }],
        crew: [{ id: 2, name: 'Example Director', job: 'Director' }, { id: 3, name: 'Example Writer', job: 'Writer' }] },
      production_companies: [{ id: 4, name: 'Example Studio', logo_path: '/studio.png' }],
      release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] },
      videos: { results: [{ key: 'abcdef12345', name: 'Official trailer', site: 'YouTube', type: 'Trailer', official: true }] },
      recommendations: { results: [{ id: 444, title: 'Recommended Film', poster_path: '/recommended.jpg' }] },
      belongs_to_collection: { id: 9, name: 'Example Collection' } };
    else if (path === '/3/collection/9') data = { name: 'Example Collection', parts: [
      { id: 321, title: 'Current Film', release_date: '2020-01-01' },
      { id: 555, title: 'Collection Sequel', release_date: '2023-01-01' }
    ] };
    else if (path === '/3/movie/444') data = { id: 444, title: 'Recommended Film', external_ids: { imdb_id: 'tt444' } };
    else if (path === '/3/tv/900') data = { id: 900, name: 'Enriched Series', overview: 'Extra series overview',
      networks: [{ id: 10, name: 'Example Network' }], seasons: [
        { season_number: 1, poster_path: '/season1.jpg' }, { season_number: 2, poster_path: '/season2.jpg' }
      ] };
    else if (path === '/3/tv/900/season/1') data = { poster_path: '/season1.jpg', episodes: [
      { episode_number: 1, name: 'Enriched Pilot', overview: 'Pilot overview', still_path: '/pilot.jpg', runtime: 43 }
    ] };
    else if (path === '/3/tv/900/season/2') data = { poster_path: '/season2.jpg', episodes: [
      { episode_number: 1, name: 'Enriched Second Season', overview: 'Second season overview', runtime: 44 }
    ] };
    return route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
  });
  return requests;
}

test('waits for addon metadata before showing the detail backdrop', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('https://art.test/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route(`${addon}/meta/movie/tt100.json`, async (route) => {
    await gate;
    await route.fulfill({ json: { meta: { ...movie, background: 'https://art.test/detail.jpg' } },
      headers: { 'access-control-allow-origin': '*' } });
  });
  await page.evaluate(() => sessionStorage.setItem('bridged-streams.detail-preview.v1', JSON.stringify([
    { preview: { id: 'tt100', type: 'movie', name: 'Sample Film', background: 'https://art.test/catalog.jpg' }, savedAt: Date.now() }
  ])));
  try {
    await page.goto('/#/movie/tt100');
    await expect(page.locator('.detail-hero')).toBeVisible();
    await expect(page.locator('.detail-play')).toBeDisabled();
    await expect(page.locator('.detail-hero')).toHaveCSS('background-image', 'none');
  } finally { release(); }
  await expect(page.locator('.detail-play')).toBeEnabled();
  await expect(page.locator('.detail-hero')).toHaveCSS('background-image', /art\.test\/detail\.jpg/);
});

for (const artwork of [true, false]) {
  test(`keeps the detail backdrop stable with delayed TMDB and artwork ${artwork ? 'enabled' : 'disabled'}`, async ({ page }) => {
    await mockTmdb(page);
    await page.route('https://art.test/**', (route) => route.fulfill({ status: 404, body: '' }));
    await page.route(`${addon}/meta/movie/tt100.json`, (route) => route.fulfill({
      json: { meta: { ...movie, background: 'https://art.test/addon.jpg' } },
      headers: { 'access-control-allow-origin': '*' }
    }));
    let release!: () => void;
    let requested!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
    await page.route('https://api.themoviedb.org/3/movie/321?**', async (route) => {
      requested();
      await gate;
      await route.fallback();
    });
    await enableTmdbEnrichment(page);
    if (!artwork) {
      await page.goto('/#/settings/integrations');
      await page.getByRole('checkbox', { name: /^Artwork / }).uncheck();
      await page.getByRole('dialog', { name: 'Integrations' }).getByRole('button', { name: 'Close', exact: true }).click();
      await goTab(page, 'Home');
    }
    try {
      await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
      await requestStarted;
      await expect(page.locator('.detail-play')).toBeEnabled();
      await expect(page.locator('.detail-hero')).toHaveCSS('background-image', artwork ? 'none' : /art\.test\/addon\.jpg/);
    } finally { release(); }
    await expect(page.getByRole('heading', { name: 'Enriched Film', exact: true })).toBeVisible();
    const expected = artwork ? /image\.tmdb\.org\/t\/p\/w1280\/backdrop\.jpg/ : /art\.test\/addon\.jpg/;
    await expect(page.locator('.detail-hero')).toHaveCSS('background-image', expected);
    await page.getByRole('button', { name: 'Back to browsing' }).click();
    await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
    await expect(page.getByRole('heading', { name: 'Enriched Film', exact: true })).toBeVisible();
    await expect(page.locator('.detail-hero')).toHaveCSS('background-image', expected);
  });
}

test('enriches movie details, caches TMDB results, and opens recommendations with addon playback IDs', async ({ page }) => {
  const requests = await mockTmdb(page);
  await enableTmdbEnrichment(page);
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await expect(page.getByRole('heading', { name: 'Enriched Film', exact: true })).toBeVisible();
  await expect(page.locator('.detail-facts')).toContainText('123 min');
  await expect(page.locator('.detail-facts')).toContainText('PG-13');
  await expect(page.locator('.detail-facts')).toContainText('TMDB');
  await expect(page.locator('.detail-facts-card')).toContainText('Example Director');
  await expect(page.getByRole('region', { name: 'Cast', exact: true })).toContainText('Hero');
  await expect(page.getByRole('region', { name: 'Production companies' })).toContainText('Example Studio');
  await expect(page.getByRole('button', { name: 'Play Official trailer', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Movie collection' })).toContainText('Collection Sequel');
  await page.getByRole('button', { name: 'Back to browsing' }).click();
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await expect(page.getByRole('heading', { name: 'Enriched Film', exact: true })).toBeVisible();
  expect(requests.filter((path) => path === '/3/movie/321')).toHaveLength(1);
  await page.getByRole('region', { name: 'More like this' }).getByRole('button', { name: 'View details for Recommended Film' }).click();
  await expect(page).toHaveURL(/#\/movie\/tt444$/);
  await expect(page.getByRole('heading', { name: 'Recommended Film', exact: true })).toBeVisible();
  await page.locator('.detail-play').click();
  await page.locator('.stream-result .cast-button').click();
  const cast = await page.evaluate(() => (window as any).__streamTest.calls.find((call: any) => call.method === 'linkCast').payload);
  expect(cast.items[0].id).toBe('tt444');
});

for (const mobile of [false, true]) {
  test(`opens and dismisses embedded trailers without leaving details on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await mockTmdb(page);
    await page.route('https://www.youtube-nocookie.com/embed/**', (route) => route.fulfill({
      contentType: 'text/html', body: '<html><body>Embedded trailer</body></html>'
    }));
    await enableTmdbEnrichment(page);
    await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
    const trigger = page.getByRole('button', { name: 'Play Official trailer', exact: true });
    await expect(trigger).toBeVisible();
    const detailUrl = page.url();
    const dialog = page.getByRole('dialog', { name: 'Trailer: Official trailer', exact: true });
    const close = dialog.getByRole('button', { name: 'Close trailer' });
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await expect(dialog.locator('iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdef12345?autoplay=1&playsinline=1&rel=0');
    await expect(dialog.locator('iframe')).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    await expect(dialog.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdef12345');
    expect(page.url()).toBe(detailUrl);
    expect(page.context().pages()).toHaveLength(1);
    const bounds = await dialog.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(mobile ? 390 : 1280);
    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.trailer-player iframe')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Enriched Film', exact: true })).toBeVisible();
    expect(page.url()).toBe(detailUrl);
    await trigger.click();
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
    await trigger.click();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.detail-panel')).toHaveCount(0);
  });
}

test('enriches only the selected season and preserves addon episode IDs for casting', async ({ page }) => {
  const requests = await mockTmdb(page);
  await page.route(`${addon}/stream/series/tt200%3A2%3A1.json`, (route) => route.fulfill({ json: { streams: [
    { name: 'Episode Source', url: 'https://media.test/season2.mp4' }
  ] }, headers: { 'access-control-allow-origin': '*' } }));
  await page.route(`${addon}/meta/series/tt200.json`, (route) => route.fulfill({ json: { meta: { ...series, videos: [
    { id: 'tt200:1:1', season: 1, episode: 1, title: 'Pilot', released: '2020-01-01' },
    { id: 'tt200:2:1', season: 2, episode: 1, title: 'Season Two', released: '2021-01-01' }
  ] } }, headers: { 'access-control-allow-origin': '*' } }));
  await enableTmdbEnrichment(page);
  await page.getByRole('button', { name: 'View details for Sample Series' }).click();
  await expect(page.locator('.episode-row')).toContainText('Enriched Pilot');
  await expect(page.locator('.episode-row')).toContainText('43 min');
  expect(requests).not.toContain('/3/tv/900/season/2');
  await expect(page.getByRole('region', { name: 'Networks' })).toContainText('Example Network');
  await page.locator('.season-trigger').click();
  await page.getByRole('button', { name: /Season 2 1 episode/ }).click();
  await expect(page.locator('.episode-row')).toContainText('Enriched Second Season');
  await page.locator('.episode-row').click();
  await expect(page).toHaveURL(/video=tt200%3A2%3A1/);
  await expect(page.locator('.stream-panel')).toContainText('Enriched Second Season');
  await page.locator('.stream-result .cast-button').click();
  const cast = await page.evaluate(() => (window as any).__streamTest.calls.find((call: any) => call.method === 'linkCast').payload);
  expect(cast.items[0].id).toBe('tt200:2:1');
});

test('slow TMDB enrichment does not block details, stream selection, or browser playback', async ({ page }) => {
  await mockTmdb(page);
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
  await page.route('https://api.themoviedb.org/3/movie/321?**', async (route) => {
    requested();
    await gate;
    await route.fallback();
  });
  await enableTmdbEnrichment(page);
  try {
    await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
    await requestStarted;
    await expect(page.locator('.detail-play')).toBeEnabled();
    await page.locator('.detail-play').click();
    await page.locator('.stream-result .watch-button').click();
    await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/movie.mp4');
  } finally { release(); }
  await expect(page).toHaveTitle('Enriched Film · Bridged Streams');
  await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/movie.mp4');
});

test('TMDB failures leave addon details playable and can be retried', async ({ page }) => {
  await mockTmdb(page);
  await page.route('https://art.test/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route(`${addon}/meta/movie/tt100.json`, (route) => route.fulfill({
    json: { meta: { ...movie, background: 'https://art.test/fallback.jpg' } },
    headers: { 'access-control-allow-origin': '*' }
  }));
  let fail = true;
  await page.route('https://api.themoviedb.org/3/find/tt100?**', (route) => fail
    ? route.fulfill({ status: 401, json: { status_message: 'Invalid key' }, headers: { 'access-control-allow-origin': '*' } })
    : route.fallback());
  await enableTmdbEnrichment(page);
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await expect(page.locator('.tmdb-detail-status')).toContainText('HTTP 401');
  await expect(page.locator('.detail-play')).toBeEnabled();
  await expect(page.locator('.detail-hero')).toHaveCSS('background-image', /art\.test\/fallback\.jpg/);
  fail = false;
  await page.getByRole('button', { name: 'Retry TMDB details' }).click();
  await expect(page.getByRole('heading', { name: 'Enriched Film', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry TMDB details' })).toHaveCount(0);
});

test('TMDB settings survive refresh and disabling enrichment restores addon metadata', async ({ page }) => {
  const requests = await mockTmdb(page);
  await enableTmdbEnrichment(page);
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await expect(page.getByRole('heading', { name: 'Enriched Film', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to browsing' }).click();
  await page.goto('/#/settings/integrations');
  await page.reload();
  await expect(page.getByRole('switch', { name: 'TMDB enrichment', exact: true })).toBeChecked();
  await expect(page.getByRole('dialog', { name: 'Integrations' }).getByLabel('TMDB API key', { exact: true })).toHaveValue('test-tmdb-key');
  await page.getByRole('switch', { name: 'TMDB enrichment', exact: true }).uncheck();
  await expect(page.getByLabel('Episode details', { exact: false })).toBeDisabled();
  await page.getByRole('dialog', { name: 'Integrations' }).getByRole('button', { name: 'Close', exact: true }).click();
  await goTab(page, 'Home');
  const previousRequests = requests.length;
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await expect(page.getByRole('heading', { name: 'Sample Film', exact: true })).toBeVisible();
  await expect(page.locator('.detail-play')).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Trailers' })).toHaveCount(0);
  expect(requests).toHaveLength(previousRequests);
});

test('plays a ready source and returns to its list without waiting for an unfinished provider', async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  let streamRequests = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
  await page.route('https://slow.test/**', async (route) => {
    if (route.request().url().endsWith('/manifest.json')) {
      await route.fulfill({ json: { id: 'slow', name: 'Slow Provider', version: '1.0.0', types: ['movie'],
        resources: ['stream'], catalogs: [] }, headers: { 'access-control-allow-origin': '*' } });
    } else {
      streamRequests += 1;
      requested();
      await gate;
      await route.fulfill({ json: { streams: [{ name: 'Slow Source', url: 'https://media.test/slow.mp4' }] },
        headers: { 'access-control-allow-origin': '*' } });
    }
  });
  await openAddons(page);
  await page.getByLabel('Addon manifest URL').fill('https://slow.test/manifest.json');
  await page.getByRole('button', { name: 'Install', exact: true }).first().click();
  await expect(page.locator('.addon-management-card').getByText('Slow Provider', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close', exact: true }).click();
  await goTab(page, 'Home');
  try {
    await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
    await page.locator('.detail-play').click();
    await requestStarted;
    await page.locator('.stream-result').filter({ hasText: 'Film Source' }).getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/movie.mp4');
    await page.getByRole('button', { name: 'Choose another stream' }).click();
    await expect(page.locator('.stream-panel')).toBeVisible();
    await expect(page.locator('movi-player')).toHaveCount(0);
    await expect(page.getByText('Film Source', { exact: true })).toBeVisible();
    expect(streamRequests).toBe(1);
  } finally { release(); }
  await expect(page.getByText('Slow Source', { exact: true })).toBeVisible();
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

test('automatically starts a ready preferred source without waiting for unrelated providers', async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
  await page.route(`${addon}/stream/movie/tt100.json`, (route) => route.fulfill({ json: { streams: [
    { name: '1080p WEB-DL', url: 'https://media.test/ready.mp4' }
  ] }, headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://slow.test/**', async (route) => {
    if (route.request().url().endsWith('/manifest.json')) {
      await route.fulfill({ json: { id: 'slow', name: 'Slow Provider', version: '1.0.0', types: ['movie'],
        resources: ['stream'], catalogs: [] }, headers: { 'access-control-allow-origin': '*' } });
    } else {
      requested();
      await gate;
      await route.fulfill({ json: { streams: [] }, headers: { 'access-control-allow-origin': '*' } });
    }
  });
  await enableStreamSelection(page);
  await openAddons(page);
  await page.getByLabel('Addon manifest URL').fill('https://slow.test/manifest.json');
  await page.getByRole('button', { name: 'Install', exact: true }).first().click();
  await expect(page.locator('.addon-management-card').getByText('Slow Provider', { exact: true })).toBeVisible();
  await page.getByLabel('Preferred provider', { exact: true }).selectOption(`${addon}/manifest.json`);
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close', exact: true }).click();
  await goTab(page, 'Home');
  try {
    await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
    await page.locator('.detail-play').click();
    await requestStarted;
    await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/ready.mp4');
    await expect(page).toHaveURL(/#\/movie\/tt100\/player$/);
    await page.getByRole('button', { name: 'Choose another stream' }).click();
    await expect(page.locator('movi-player')).toHaveCount(0);
    await expect(page.locator('.stream-result')).toHaveCount(1);
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Refresh all streams' }).locator('svg')).not.toHaveClass(/spin/);
  await expect(page).toHaveURL(/#\/movie\/tt100\/streams$/);
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

test('searches only on submit and preserves focus and URL while typing', async ({ page }) => {
  await goTab(page, 'Search');
  await page.clock.install();
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(`${addon}/catalog/`) && request.url().includes('search=')) requests.push(request.url());
  });
  const input = page.getByRole('textbox', { name: 'Search movies, TV shows, and sports' });
  for (const partial of ['S', 'Sa', 'Sample']) {
    await input.fill(partial);
    await page.clock.runFor(1000);
    await expect(input).toBeFocused();
    await expect(page).toHaveURL(/#\/search$/);
    await expect(page.getByRole('region', { name: 'Search results' })).toHaveCount(0);
    expect(requests).toEqual([]);
  }
  await page.locator('.search-submit').click();
  await expect(page).toHaveURL(/#\/search\?q=Sample$/);
  const results = page.getByRole('region', { name: 'Search results' });
  await expect(results.getByRole('button', { name: 'View details for Sample Film' })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  const completedRequests = requests.length;
  await input.fill('Other');
  await page.clock.runFor(1000);
  await expect(input).toBeFocused();
  await expect(page).toHaveURL(/#\/search\?q=Sample$/);
  await expect(results.getByRole('button', { name: 'View details for Sample Film' })).toBeVisible();
  expect(requests).toHaveLength(completedRequests);
  await input.press('Enter');
  await expect(page).toHaveURL(/#\/search\?q=Other$/);
  await expect.poll(() => requests.length).toBeGreaterThan(completedRequests);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page).toHaveURL(/#\/search$/);
  await expect(results).toHaveCount(0);
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
  await page.clock.install();
  await page.getByRole('button', { name: 'Cast' }).click();
  const calls = await page.evaluate(() => (window as any).__streamTest.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('linkCast');
  expect(calls[0].payload.items[0].url).toBe('https://media.test/movie.mp4');
  const notice = page.locator('.toast');
  await expect(notice).toContainText('Casting Sample Film · watch progress sync is on.');
  await page.clock.fastForward(3000);
  await page.getByRole('button', { name: 'Cast' }).click();
  await page.clock.fastForward(2100);
  await expect(notice).toBeVisible();
  await page.clock.fastForward(3100);
  await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: 'Cast' }).click();
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
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

test('saves only the submitted search text to history', async ({ page }) => {
  await goTab(page, 'Search');
  const input = page.getByRole('textbox', { name: 'Search movies, TV shows, and sports' });
  for (const partial of ['a', 'av', 'ave']) {
    await input.fill(partial);
    await page.waitForTimeout(450);
  }
  await input.fill('avengers');
  await expect(page.getByRole('region', { name: 'Search results' })).toHaveCount(0);
  await page.locator('.search-submit').click();
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
  await page.getByRole('heading', { name: 'New Films' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'View details for New Film' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New Shows' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live Now' })).toBeVisible();
  await page.getByRole('heading', { name: 'Live Now' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'View details for Live Match' }).click();
  await page.locator('.detail-play').click();
  await expect(page.getByText('Live Feed')).toBeVisible();
  await page.getByRole('button', { name: 'Cast' }).click();
  const calls = await page.evaluate(() => (window as any).__streamTest.calls);
  expect(calls.at(-1)).toMatchObject({ method: 'cast', payload: { url: 'https://media.test/live.m3u8' } });
});

for (const delayedRestore of [false, true]) {
test(delayedRestore ? 'adds a Nuvio scraper restored after its stream page opens'
  : 'uses a browser-compatible Nuvio scraper for an IMDb movie', async ({ page }) => {
  await page.route('https://api.themoviedb.org/**', (route) => route.fulfill({ json: { movie_results: [{ id: 321 }] }, headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://plugins.test/**', (route) => {
    if (route.request().url().endsWith('/manifest.json')) {
      return route.fulfill({ json: { name: 'Test Plugins', version: '1.0.0', scrapers: [{ id: 'simple', name: 'Simple Scraper', filename: 'simple.js', supportedTypes: ['movie'] }] }, headers: { 'access-control-allow-origin': '*' } });
    }
    return route.fulfill({ body: `
      global.URL_VALIDATION_ENABLED = true;
      if (global !== globalThis || window !== globalThis || self !== globalThis) throw new Error('Missing Nuvio runtime aliases');
      const cheerio = require('cheerio-without-node-native');
      const CryptoJS = require('crypto-js');
      const scrape = async (id) => {
        const $ = cheerio.load('<a href="https://media.test/plugin.mp4">Plugin Source ' + id + '</a>');
        const encrypted = CryptoJS.AES.encrypt($('a').attr('href'), 'test-passphrase');
        return [{ name: $('a').text(), url: CryptoJS.AES.decrypt(encrypted.toString(), 'test-passphrase').toString(CryptoJS.enc.Utf8) }];
      };
      ${delayedRestore ? 'global.getStreams = scrape;' : 'module.exports.getStreams = scrape;'}
    `, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await openAddons(page);
  await page.getByLabel('Nuvio plugin repository URL').fill('https://plugins.test/manifest.json');
  await page.getByRole('button', { name: 'Install' }).last().click();
  await expect(page.getByText('Test Plugins', { exact: true })).toBeVisible();
  await page.getByLabel('TMDB API key').fill('test-key');
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close' }).click();
  await goTab(page, 'Home');
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
  if (delayedRestore) {
    await page.route('https://plugins.test/manifest.json', async (route) => {
      requested();
      await gate;
      await route.fallback();
    });
  }
  try {
    if (delayedRestore) { await page.reload(); await requestStarted; }
    await page.getByRole('button', { name: 'View details for Sample Film' }).click();
    await page.locator('.detail-play').click();
    if (delayedRestore) {
      await expect(page.getByText('Film Source', { exact: true })).toBeVisible();
      await expect(page.getByText('Plugin Source 321')).toHaveCount(0);
    }
  } finally { release(); }
  await expect(page.getByText('Plugin Source 321')).toBeVisible();
});
}

async function mockNuvioPluginSync(page: Page, options: { guardedMissing?: boolean } = {}) {
  const repoUrl = 'https://configured-plugins.test/manifest.json';
  const state = {
    failNextWrite: false,
    conflicts: 0,
    writes: [] as any[],
    settingsReads: [] as number[],
    blobs: new Map<number, any>([
      [1, { version: 1, features: { unrelated: { keep: true }, plugins: { repositories: [{ url: repoUrl, scrapers: [{ id: 'configured', enabled: false, settings: { token: 'test-cloud-token', audio: 'sub', strict: true } }] }] } } }],
      [2, { version: 1, features: { plugins: { repositories: [{ url: repoUrl, scrapers: [{ id: 'configured', enabled: true, settings: { audio: 'dub' } }] }] } } }],
    ]),
  };
  await page.route('https://nuvio.test/**', async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON() || {};
    const method = url.pathname.split('/').pop();
    let result: unknown = [];
    if (method === 'sync_pull_profiles') result = [
      { profile_index: 1, name: 'Primary' }, { profile_index: 2, name: 'Kids' },
      { profile_index: 3, name: 'Shared', uses_primary_plugins: true },
    ];
    else if (method === 'plugins') result = [{ url: repoUrl, name: 'Configured Repo', enabled: true }];
    else if (method === 'sync_pull_profile_settings_blob') {
      expect(body.p_platform).toBe('bridged-streams');
      state.settingsReads.push(body.p_profile_id);
      result = [{ settings_json: state.blobs.get(body.p_profile_id) || {}, updated_at: '2026-09-30T00:00:00Z' }];
    } else if (method?.startsWith('sync_push_profile_settings_blob')) {
      expect(body.p_platform).toBe('bridged-streams');
      if (options.guardedMissing && method.endsWith('_guarded')) return route.fulfill({ status: 404, json: { code: 'PGRST202', message: 'Function not found' }, headers: { 'access-control-allow-origin': '*' } });
      if (state.failNextWrite) {
        state.failNextWrite = false;
        return route.fulfill({ status: 503, json: { message: 'Test save failed' }, headers: { 'access-control-allow-origin': '*' } });
      }
      if (state.conflicts > 0) {
        state.conflicts--;
        state.blobs.get(body.p_profile_id).features.fromAnotherDevice = true;
        return route.fulfill({ status: 400, json: { code: '40001', message: 'Settings changed' }, headers: { 'access-control-allow-origin': '*' } });
      }
      state.writes.push(body);
      state.blobs.set(body.p_profile_id, body.p_settings_json);
      result = null;
    }
    await route.fulfill({ json: result, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://api.themoviedb.org/**', route => route.fulfill({ json: { movie_results: [{ id: 321 }] }, headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://configured-plugins.test/**', route => {
    if (route.request().url().endsWith('manifest.json')) return route.fulfill({ json: { name: 'Configured Repo', scrapers: [
      { id: 'configured', name: 'Configured Scraper', filename: 'configured.js', hasSettings: true, supportedTypes: ['movie'] },
    ] }, headers: { 'access-control-allow-origin': '*' } });
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: `
      module.exports = {
        onSettings: async () => [
          {type: 'text', key: 'token', label: 'Access token', isPassword: true},
          {type: 'select', key: 'audio', label: 'Audio preference', defaultValue: 'both', options: [{label: 'Sub', value: 'sub'}, {label: 'Dub', value: 'dub'}, {label: 'Both', value: 'both'}]},
          {type: 'toggle', key: 'strict', label: 'Strict matching', defaultValue: false}
        ],
        getStreams: async (id) => [{ name: 'Configured ' + SCRAPER_SETTINGS.audio + ' ' + id, url: 'https://media.test/configured.mp4', headers: { authorization: SCRAPER_SETTINGS.token || '' } }]
      };
    ` });
  });
  await page.addInitScript(() => {
    localStorage.setItem('bridged-streams.nuvio-session.v1', JSON.stringify({ backendUrl: 'https://nuvio.test', publishableKey: 'test-key', accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: Date.now() + 3600000, user: { id: 'test-user', email: 'viewer@example.com' } }));
    localStorage.setItem('bridged-streams.tmdb-key.v1', 'test-key');
  });
  await page.reload();
  await openAddons(page);
  await expect(page.getByRole('button', { name: 'Configured Scraper enabled' })).toBeEnabled();
  return state;
}

test('syncs Nuvio scraper switches and settings and uses them for cached playback', async ({ page }) => {
  const state = await mockNuvioPluginSync(page);
  const enabled = page.getByRole('button', { name: 'Configured Scraper enabled' });
  await expect(enabled).toHaveAttribute('aria-pressed', 'false');
  state.conflicts = 1;
  await enabled.click();
  await expect(enabled).toHaveAttribute('aria-pressed', 'true');
  expect(state.writes[0].p_settings_json.features.unrelated).toEqual({ keep: true });
  expect(state.writes[0].p_settings_json.features.fromAnotherDevice).toBe(true);
  await page.getByRole('button', { name: 'Configure Configured Scraper' }).click();
  let settings = page.getByRole('dialog', { name: 'Configured Scraper settings' });
  await expect(settings.getByLabel('Access token')).toHaveAttribute('type', 'password');
  await expect(settings.getByLabel('Access token')).toHaveValue('test-cloud-token');
  await expect(settings.getByLabel('Audio preference')).toHaveValue('sub');
  await expect(settings.getByLabel('Strict matching')).toBeChecked();
  await settings.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close', exact: true }).click();
  await goTab(page, 'Home');
  await page.getByRole('button', { name: 'View details for Sample Film' }).click();
  await page.locator('.detail-play').click();
  await expect(page.getByText('Configured sub 321', { exact: true })).toBeVisible();
  await page.goto('/#/settings/addons');
  await page.getByRole('button', { name: 'Configure Configured Scraper' }).click();
  settings = page.getByRole('dialog', { name: 'Configured Scraper settings' });
  await settings.getByLabel('Audio preference').selectOption('dub');
  await settings.getByLabel('Access token').fill('test-new-token');
  await settings.getByLabel('Strict matching').uncheck();
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(settings).not.toBeVisible();
  expect(state.writes.at(-1).p_settings_json.features.plugins.repositories[0].scrapers[0].settings).toEqual({ token: 'test-new-token', audio: 'dub', strict: false });
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close', exact: true }).click();
  await goTab(page, 'Home');
  await page.getByRole('button', { name: 'View details for Sample Film' }).click();
  await page.locator('.detail-play').click();
  await expect(page.getByText('Configured dub 321', { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('bridged-streams.startup-cache.v1.nuvio-plugins'));
  await page.reload();
  await expect(page.getByText('Configured dub 321', { exact: true })).toBeVisible();
});

test('isolates Nuvio scraper controls by profile and protects shared plugins', async ({ page }) => {
  const state = await mockNuvioPluginSync(page, { guardedMissing: true });
  await page.getByRole('button', { name: 'Configured Scraper enabled' }).click();
  await expect(page.getByRole('button', { name: 'Configured Scraper enabled' })).toHaveAttribute('aria-pressed', 'true');
  expect(state.writes[0].p_profile_id).toBe(1);
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close', exact: true }).click();
  await openAccounts(page);
  await page.getByRole('combobox', { name: 'Profile', exact: true }).selectOption('2');
  await expect(page.getByRole('button', { name: 'Sync Nuvio now' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close account' }).click();
  await openAddons(page);
  await page.getByRole('button', { name: 'Configure Configured Scraper' }).click();
  await expect(page.getByRole('dialog', { name: 'Configured Scraper settings' }).getByLabel('Audio preference')).toHaveValue('dub');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close', exact: true }).click();
  await openAccounts(page);
  await page.getByRole('combobox', { name: 'Profile', exact: true }).selectOption('3');
  await expect(page.getByRole('button', { name: 'Sync Nuvio now' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close account' }).click();
  await openAddons(page);
  await expect(page.getByRole('button', { name: 'Configured Scraper enabled' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Configure Configured Scraper' })).toBeDisabled();
  expect(state.settingsReads.slice(-2)).toEqual([1, 3]);
  expect(state.writes).toHaveLength(1);
});

test('keeps Nuvio scraper edits retryable when saving fails', async ({ page }) => {
  const state = await mockNuvioPluginSync(page);
  state.failNextWrite = true;
  const enabled = page.getByRole('button', { name: 'Configured Scraper enabled' });
  await enabled.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Test save failed' })).toBeVisible();
  await expect(enabled).toHaveAttribute('aria-pressed', 'false');
  await enabled.click();
  await expect(enabled).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Configure Configured Scraper' }).click();
  const settings = page.getByRole('dialog', { name: 'Configured Scraper settings' });
  await settings.getByLabel('Access token').fill('test-retry-token');
  state.failNextWrite = true;
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('Test save failed');
  await expect(settings.getByLabel('Access token')).toHaveValue('test-retry-token');
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(settings).not.toBeVisible();
  expect(state.writes).toHaveLength(2);
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

  await page.getByRole('heading', { name: 'Shows', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'View details for Sample Series' }).first().click();
  await page.getByRole('button', { name: /Pilot/ }).click();
  await expect(page.getByText('Episode Source')).toBeVisible();
  await page.getByRole('button', { name: 'Cast' }).click();
  await page.evaluate(() => (window as any).__streamTest.session.dispatchEvent(new CustomEvent('statechange', {
    detail: { state: 'playing', positionMs: 30_000, durationMs: 300_000,
      currentIndex: 0, items: [{ id: 'tt200:1:1' }] }
  })));
  await expect.poll(() => libraryWrites.length).toBe(3);
  expect(libraryWrites[2]).toMatchObject({
    _id: 'tt200', state: { video_id: 'tt200:1:1', timeOffset: 30_000, duration: 300_000 }
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
  await row.scrollIntoViewIfNeeded();
  await expect(row.locator('.media-card')).toHaveCount(12);
  for (const count of [24, 25, 27]) {
    await row.locator('.media-row').evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect(row.locator('.media-card')).toHaveCount(count);
  }
  await expect(row.getByRole('button', { name: 'View details for Paged Film 27', exact: true })).toBeVisible();
  expect(secondPageRequests).toBeGreaterThanOrEqual(2);
});

test('resets a previously scrolled tab to the top and expands the dock', async ({ page }) => {
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
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(dock).not.toHaveClass(/compact/);
});

test('unmounts inactive tabs and restores cached search without fetching it again', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let searchRequests = 0;
  await page.route(`${addon}/catalog/movie/**`, async (route) => {
    if (route.request().url().includes('search=')) searchRequests += 1;
    await route.fulfill({ json: { metas: Array.from({ length: 40 }, (_,index) => ({
      id: `tt-search-${index}`, type: 'movie', name: `Search Film ${index}`
    })) }, headers: { 'access-control-allow-origin': '*' } });
  });
  await goTab(page, 'Search');
  const input = page.getByRole('textbox', { name: 'Search movies, TV shows, and sports' });
  await input.fill('Film');
  await page.locator('.search-submit').click();
  const cards = page.locator('.search-results .media-card');
  await expect(cards).toHaveCount(41);
  const firstCard = await cards.first().elementHandle();
  expect(firstCard).not.toBeNull();
  const completedSearchRequests = searchRequests;
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);

  await goTab(page, 'Settings');
  await expect(page.locator('.search-panel')).toHaveCount(0);
  expect(await firstCard!.evaluate((node) => node.isConnected)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await goTab(page, 'Library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await expect(page.locator('.settings-page')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await goTab(page, 'Home');
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible();
  await goTab(page, 'Search');
  await expect(input).toHaveValue('Film');
  await expect(cards).toHaveCount(41);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await cards.first().evaluate((node, original) => node === original, firstCard!)).toBe(false);
  expect(searchRequests).toBe(completedSearchRequests);
  await firstCard!.dispose();
});
