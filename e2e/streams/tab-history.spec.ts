import { expect, test, type Page } from '@playwright/test';

async function goTab(page: Page, name: 'Home' | 'Search' | 'Library' | 'Settings') {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
}
const current = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' }).locator('[aria-current="page"]');

test('switching tabs keeps one base entry and Back leaves from any tab', async ({ page }) => {
  await page.goto('/');
  const length = await page.evaluate(() => history.length);
  for (const tab of ['Library', 'Search', 'Settings', 'Home', 'Search', 'Library'] as const) {
    await goTab(page, tab);
    await expect(current(page)).toHaveAttribute('aria-label', tab);
    await expect(page).toHaveURL(/#\/$/);
    expect(await page.evaluate(() => history.length)).toBe(length);
  }
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

for (const [hash, tab] of [['#/library', 'Library'], ['#/search?q=film', 'Search'], ['#/settings', 'Settings']] as const) {
  test(`a legacy ${tab} link opens once and replaces its URL with the base`, async ({ page }) => {
    await page.goto(`/${hash}`);
    await expect(current(page)).toHaveAttribute('aria-label', tab);
    await expect(page).toHaveURL(/#\/$/);
    if (tab === 'Search') await expect(page.getByRole('textbox', { name: 'Search movies, TV shows, and sports' })).toHaveValue('film');
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
  });

  test(`reloading a normalized ${tab} link opens Home`, async ({ page }) => {
    await page.goto(`/${hash}`);
    await expect(current(page)).toHaveAttribute('aria-label', tab);
    await expect(page).toHaveURL(/#\/$/);
    await page.reload();
    await expect(current(page)).toHaveAttribute('aria-label', 'Home');
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
  });
}

for (const panel of ['accounts', 'addons', 'integrations'] as const) {
  test(`Back from Settings ${panel} returns to Settings at the base URL`, async ({ page }) => {
    await page.goto('/');
    await goTab(page, 'Settings');
    const label = panel === 'accounts' ? /Accounts and profiles/ : panel === 'addons' ? /Addons and playback/ : /Integrations/;
    await page.getByRole('button', { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`#/settings/${panel}$`));
    await page.goBack();
    await expect(page).toHaveURL(/#\/$/);
    await expect(current(page)).toHaveAttribute('aria-label', 'Settings');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
  });
}

test('a direct Settings panel link goes Back to Settings', async ({ page }) => {
  await page.goto('/#/settings/addons');
  await expect(page.getByRole('dialog', { name: 'Manage addons' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);
  await expect(current(page)).toHaveAttribute('aria-label', 'Settings');
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

async function libraryFixture(page: Page, openDetail = true) {
  const addon = 'https://tab-history.test';
  const movie = { id: 'tt-tab', type: 'movie', name: 'Saved Film' };
  await page.addInitScript(({ addon, movie }) => {
    localStorage.setItem('bridged-streams.addons.v1', JSON.stringify([`${addon}/manifest.json`]));
    localStorage.setItem('bridged-streams.stremio-session.v1', JSON.stringify({ authKey: 'synthetic-tab-key', user: { _id: 'tab-user', email: 'tab@example.invalid' } }));
    localStorage.setItem('bridged-streams.startup-cache.v1.stremio-library', JSON.stringify({
      scope: 'tab-user', value: [{ ...movie, progress: 0, removed: false, temp: false, record: {} }]
    }));
  }, { addon, movie });
  await page.route('https://api.strem.io/api/**', (route) => {
    const method = route.request().url().split('/').pop();
    const result = method === 'getUser' ? { _id: 'tab-user', email: 'tab@example.invalid' }
      : method === 'datastoreGet' ? [{ _id: movie.id, type: movie.type, name: movie.name, removed: false, temp: false }]
      : { addons: [] };
    return route.fulfill({ json: { result } });
  });
  await page.route(`${addon}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/manifest.json'
      ? { id: 'tab-history', name: 'Tab History', version: '1.0.0', types: ['movie'], resources: ['catalog', 'meta', 'stream'],
        catalogs: [{ id: 'films', type: 'movie', name: 'Films' }] }
      : path.startsWith('/meta/') ? { meta: movie } : path.startsWith('/stream/') ? { streams: [] } : { metas: [movie] } });
  });
  await page.goto('/');
  await goTab(page, 'Library');
  if (openDetail) {
    await page.getByRole('button', { name: 'View details for Saved Film', exact: true }).click();
    await expect(page.locator('.detail-play')).toBeEnabled();
  }
}

test('Back through streams and detail returns to the originating Library tab', async ({ page }) => {
  await libraryFixture(page);
  await page.locator('.detail-play').click();
  await expect(page).toHaveURL(/#\/movie\/tt-tab\/streams$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/movie\/tt-tab$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);
  await expect(current(page)).toHaveAttribute('aria-label', 'Library');
  await expect(page.locator('.library-panel .media-card')).toHaveCount(1);
  await page.goForward();
  await expect(page).toHaveURL(/#\/movie\/tt-tab$/);
  await page.locator('.detail-back').click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(current(page)).toHaveAttribute('aria-label', 'Library');
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('selecting a tab above a pushed stack drops every Back step', async ({ page }) => {
  await libraryFixture(page);
  await page.locator('.detail-play').click();
  await expect(page).toHaveURL(/\/streams$/);
  // Exercise rapid dock dispatch even where the top screen covers the dock.
  await page.locator('.mobile-nav').evaluate((dock) => {
    dock.querySelector<HTMLButtonElement>('[aria-label="Search"]')!.click();
    dock.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click();
  });
  await expect(current(page)).toHaveAttribute('aria-label', 'Settings');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.detail-overlay, .stream-overlay')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

for (const screen of ['Library', 'detail', 'streams', 'player', 'catalog'] as const) {
  test(`app reopen from ${screen} returns Home without adding history`, async ({ page }) => {
    await libraryFixture(page, false);
    if (screen === 'catalog') {
      await goTab(page, 'Home');
      await page.getByRole('button', { name: 'View all Films from Tab History' }).click();
      await expect(page.locator('.catalog-page-overlay')).toBeVisible();
    } else if (screen !== 'Library') {
      await page.getByRole('button', { name: 'View details for Saved Film', exact: true }).click();
      await expect(page.locator('.detail-play')).toBeEnabled();
    }
    if (screen === 'streams' || screen === 'player') {
      await page.route('https://tab-history.test/stream/**', route => route.fulfill({ json: { streams: [
        { name: 'Synthetic source', url: 'https://tab-history-media.test/fixture.mp4' }
      ] } }));
      await page.route('https://tab-history-media.test/**', route => route.abort());
      await page.locator('.detail-play').click();
      await expect(page.locator('.stream-overlay')).toBeVisible();
    }
    if (screen === 'player') {
      await page.route('**/*element*slim*.js*', route => route.abort());
      await page.locator('.stream-result .watch-button').click();
      await expect(page.getByRole('dialog', { name: 'Now playing Saved Film' })).toBeVisible();
    }
    const length = await page.evaluate(() => history.length);
    await page.evaluate(() => window.dispatchEvent(new Event('PlayBridgeAppReopened')));
    await expect(current(page)).toHaveAttribute('aria-label', 'Home');
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('.detail-overlay, .stream-overlay, .player-overlay, .catalog-page-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => history.length)).toBe(length);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
  });
}

test('app reopen closes Settings panels and coalesces duplicate events', async ({ page }) => {
  await page.goto('/');
  await goTab(page, 'Settings');
  await page.getByRole('button', { name: /Addons and playback/ }).click();
  await expect(page.getByRole('dialog', { name: 'Manage addons' })).toBeVisible();
  const length = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('PlayBridgeAppReopened'));
    window.dispatchEvent(new Event('PlayBridgeAppReopened'));
  });
  await expect(current(page)).toHaveAttribute('aria-label', 'Home');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('app reopen cooperates with the host already traversing to the first entry', async ({ page }) => {
  await libraryFixture(page);
  await page.locator('.detail-play').click();
  await expect(page).toHaveURL(/\/streams$/);
  const length = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    history.go(-history.state.depth);
    window.dispatchEvent(new Event('PlayBridgeAppReopened'));
  });
  await expect(current(page)).toHaveAttribute('aria-label', 'Home');
  await expect(page).toHaveURL(/#\/$/);
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});
