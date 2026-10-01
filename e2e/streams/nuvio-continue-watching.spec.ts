import { expect, test, type Page } from '@playwright/test';

const addon = 'https://nuvio-catalog.test';
const showId = 'tt-outlander-test';
const poster = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function goTab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
}

async function accounts(page: Page) {
  await goTab(page, 'Settings');
  await page.getByRole('button', { name: /Accounts and profiles/ }).click();
  return page.getByRole('dialog', { name: 'Accounts', exact: true });
}

async function fixture(page: Page, options: { slow?: boolean; fail?: boolean; watchedShows?: number } = {}) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const state = { metadataRequests: 0, metadataCancelled: 0, catalogRequests: 0, pagedCatalogRequests: 0, fail: !!options.fail, release };
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(`${addon}/meta/`)) state.metadataCancelled++;
  });
  await page.addInitScript(() => {
    localStorage.setItem('bridged-streams.nuvio-session.v1', JSON.stringify({
      backendUrl: 'https://nuvio.test', publishableKey: 'test-key', accessToken: 'test-access',
      refreshToken: 'test-refresh', expiresAt: Date.now() + 3600000,
      user: { id: 'test-user', email: 'viewer@example.com' }
    }));
    localStorage.setItem('bridged-streams.nuvio-profile.v1', JSON.stringify({ userId: 'test-user', index: 2 }));
  });
  await page.route('https://nuvio.test/**', (route) => {
    const method = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const result = method === 'sync_pull_profiles'
      ? [{ profile_index: 1, name: 'Other' }, { profile_index: 2, name: 'Golu' }]
      : method === 'addons' ? [{ url: `${addon}/manifest.json`, enabled: true }]
      : method === 'sync_pull_watch_progress' && body.p_profile_id === 2 ? [
        { progress_key: `${showId}_s2e4`, content_id: showId, content_type: 'series',
          video_id: `${showId}:2:4`, season: 2, episode: 4,
          position: 2220000, duration: 3000000, last_watched: 1700000001000 },
        { progress_key: `${showId}_s2e5`, content_id: showId, content_type: 'series',
          video_id: `${showId}:2:5`, season: 2, episode: 5,
          position: 60000, duration: 3000000, last_watched: 1700000000000 },
        ...Array.from({ length: (options.watchedShows || 1) - 1 }, (_, index) => ({
          progress_key: `tt-watched-${index}_s1e1`, content_id: `tt-watched-${index}`, content_type: 'series',
          video_id: `tt-watched-${index}:1:1`, season: 1, episode: 1,
          position: 600000, duration: 3000000, last_watched: 1699999999000 - index
        }))
      ] : [];
    return route.fulfill({ json: result, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route(`${addon}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    let status = 200;
    if (path === '/manifest.json') json = {
      id: 'nuvio-test', name: 'Nuvio Catalog', version: '1.0.0', types: ['series'],
      resources: ['catalog', 'meta', 'stream'],
      catalogs: [{ id: 'popular', type: 'series', name: 'Popular shows', extra: [{ name: 'skip' }] }]
    };
    else if (path.startsWith('/catalog/')) {
      state.catalogRequests++;
      if (Number(path.match(/(?:\/|&)skip=(\d+)/)?.[1]) > 0) state.pagedCatalogRequests++;
      json = { metas: [{ id: 'tt-unrelated-test', type: 'series', name: 'Unrelated show', poster }] };
    } else if (path.startsWith('/meta/series/')) {
      state.metadataRequests++;
      if (options.slow) await gate;
      if (state.fail) status = 503;
      else if (path === `/meta/series/${showId}.json`) json = { meta: { id: showId, type: 'series', name: 'Outlander', poster, videos: [
        { id: `${showId}:2:4`, season: 2, episode: 4, title: 'Episode four' },
        { id: `${showId}:2:5`, season: 2, episode: 5, title: 'Episode five' }
      ] } };
      else {
        const id = path.split('/').pop()!.replace(/\.json$/, '');
        json = { meta: { id, type: 'series', name: `Watched show ${id}`, poster } };
      }
    } else if (path.startsWith('/stream/')) json = { streams: [{ name: 'Episode source', url: 'https://media.test/episode.mp4' }] };
    await route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Popular shows', exact: true })).toBeVisible();
  return state;
}

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

test('resolves a watched show outside library/catalogs in the background and caches its metadata', async ({ page }) => {
  const state = await fixture(page, { slow: true });
  const card = page.locator('.home-panel .catalog-section').filter({ has: page.getByRole('heading', { name: 'Continue Watching' }) })
    .getByRole('button', { name: 'View details for Outlander', exact: true });
  try {
    await expect.poll(() => state.metadataRequests).toBe(1);
    await expect(card).toHaveCount(0);
    await goTab(page, 'Search');
    await expect(page.getByRole('textbox', { name: 'Search movies, TV shows, and sports' })).toBeVisible();
    state.release();
    await goTab(page, 'Home');
    await expect(card).toBeVisible();
    await expect(card).toContainText('74% watched');
    const catalogRequests = state.catalogRequests;

    const dialog = await accounts(page);
    await dialog.getByRole('button', { name: 'Sync Nuvio now' }).click();
    await expect(dialog.getByRole('button', { name: 'Sync Nuvio now' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Close account', exact: true }).click();
    await goTab(page, 'Home');
    await expect(card).toBeVisible();
    expect(state.metadataRequests).toBe(1);
    expect(state.catalogRequests).toBe(catalogRequests);

    await card.click();
    await expect(page.getByRole('dialog', { name: 'Streams for Outlander' })).toContainText('Episode four');
    await expect(page.getByText('Episode source', { exact: true })).toBeVisible();
    expect(state.metadataRequests).toBe(1);
    await page.goto('/');
    await expect(card).toBeVisible();
    expect(state.metadataRequests).toBe(1);
  } finally { state.release(); }
});

test('does not publish a pending show after changing Nuvio profiles', async ({ page }) => {
  const state = await fixture(page, { slow: true });
  try {
    await expect.poll(() => state.metadataRequests).toBe(1);
    const dialog = await accounts(page);
    await dialog.getByRole('combobox', { name: 'Profile', exact: true }).selectOption('1');
    await expect.poll(() => state.metadataCancelled).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Sync Nuvio now' })).toBeEnabled();
    state.release();
    await dialog.getByRole('button', { name: 'Close account', exact: true }).click();
    await goTab(page, 'Home');
    await expect(page.getByRole('heading', { name: 'Popular shows', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View details for Outlander', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Continue Watching' })).toHaveCount(0);
  } finally { state.release(); }
});

test('retries unavailable metadata on the next Nuvio sync', async ({ page }) => {
  const state = await fixture(page, { fail: true });
  await expect.poll(() => state.metadataRequests).toBe(1);
  await expect(page.getByRole('button', { name: 'View details for Outlander', exact: true })).toHaveCount(0);
  const dialog = await accounts(page);
  state.fail = false;
  await dialog.getByRole('button', { name: 'Sync Nuvio now' }).click();
  await expect(dialog.getByRole('button', { name: 'Sync Nuvio now' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close account', exact: true }).click();
  await goTab(page, 'Home');
  await expect(page.getByRole('button', { name: 'View details for Outlander', exact: true })).toBeVisible();
  expect(state.metadataRequests).toBe(2);
});

test('bounds background lookups to two at a time and the sixteen most recent watched titles', async ({ page }) => {
  const state = await fixture(page, { slow: true, watchedShows: 20 });
  try {
    await expect.poll(() => state.metadataRequests).toBe(2);
    await goTab(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    expect(state.metadataRequests).toBe(2);
    state.release();
    await goTab(page, 'Home');
    const row = page.locator('.catalog-section').filter({ has: page.getByRole('heading', { name: 'Continue Watching' }) });
    await expect(row.locator('.media-card')).toHaveCount(16);
    expect(state.metadataRequests).toBe(16);
    expect(state.pagedCatalogRequests).toBe(0);
  } finally { state.release(); }
});
