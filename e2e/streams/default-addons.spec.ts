import { expect, test, type Page } from '@playwright/test';

const cinemeta = 'https://v3-cinemeta.strem.io';
const items = Array.from({ length: 8 }, (_, index) => ({
  id: `tt900000${index}`, type: 'movie', name: `Default Film ${index}`, description: 'A film from the default catalog.'
}));

async function mockCinemeta(page: Page) {
  const requests: string[] = [];
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route(`${cinemeta}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    const item = items.find((entry) => path.endsWith(`/${entry.id}.json`));
    const json = path === '/manifest.json'
      ? { id: 'com.linvo.cinemeta', name: 'Cinemeta', version: '3.0.0', types: ['movie'], idPrefixes: ['tt'],
        resources: ['catalog', 'meta'], catalogs: [{ type: 'movie', id: 'top', name: 'Popular' }] }
      : path.startsWith('/meta/') ? { meta: item } : { metas: items };
    return route.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
  });
  return requests;
}

test.describe('a browser that never saved addons', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('starts with Cinemeta and remembers removing it', async ({ page }) => {
    const requests = await mockCinemeta(page);
    await page.goto('/');
    await expect(page.locator('.home-panel .media-card').first()).toBeVisible();
    expect(requests).toContain('/manifest.json');

    await page.goto('/#/settings/addons');
    const card = page.locator('.addon-management-card', { hasText: 'Cinemeta' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /remove/i }).click();
    const confirm = page.locator('.confirm-delete');
    if (await confirm.count()) await confirm.click();
    await expect(card).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('bridged-streams.addons.v1'))).toBe('[]');

    requests.length = 0;
    await page.goto('/');
    await page.reload();
    await expect(page.locator('.welcome')).toBeVisible();
    expect(requests).toEqual([]);
  });

  test('a signed-in browser does not get the default addon', async ({ page }) => {
    const requests = await mockCinemeta(page);
    await page.route('https://nuvio.test/**', (route) => route.fulfill({ json: [], headers: { 'access-control-allow-origin': '*' } }));
    await page.addInitScript(() => {
      localStorage.setItem('bridged-streams.nuvio-session.v1', JSON.stringify({ backendUrl: 'https://nuvio.test', publishableKey: 'test-key',
        accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: Date.now() + 3600000, user: { id: 'test-user', email: 'viewer@example.com' } }));
      localStorage.setItem('bridged-streams.profile-launch.v1', 'remember');
    });
    await page.goto('/');
    await page.waitForTimeout(1000);
    expect(requests).toEqual([]);
  });
});

test('Back to Home at the end of details leaves every pushed screen', async ({ page }) => {
  await mockCinemeta(page);
  await page.addInitScript((url) => {
    localStorage.setItem('bridged-streams.addons.v1', JSON.stringify([`${url}/manifest.json`]));
  }, cinemeta);
  await page.goto('/');
  await page.locator('.home-panel .media-card').first().click();
  await expect(page.getByRole('dialog', { name: 'Default Film 0', exact: true })).toBeVisible();

  const home = page.getByRole('button', { name: 'Back to Home', exact: true });
  await home.scrollIntoViewIfNeeded();
  await home.click();
  await expect(page.getByRole('dialog', { name: 'Default Film 0', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).locator('[aria-current="page"]')).toHaveAttribute('aria-label', 'Home');
  expect(await page.evaluate(() => (history.state as { depth?: number } | null)?.depth ?? 0)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // The pushed detail entry is gone: Back leaves the app instead of reopening it.
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('Back to Home starts Home from the top, with every rail at its start', async ({ page }) => {
  const rows = Array.from({ length: 6 }, (_, row) => ({ type: 'movie', id: `row${row}`, name: `Row ${row}` }));
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route(`${cinemeta}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const row = Number(path.match(/\/catalog\/movie\/row(\d+)/)?.[1] ?? 0);
    const titles = Array.from({ length: 24 }, (_, index) => ({ id: `tt91${row}${String(index).padStart(4, '0')}`, type: 'movie',
      name: `Row ${row} Film ${index}` }));
    const json = path === '/manifest.json'
      ? { id: 'com.linvo.cinemeta', name: 'Cinemeta', version: '3.0.0', types: ['movie'], idPrefixes: ['tt'],
        resources: ['catalog', 'meta'], catalogs: rows }
      : path.startsWith('/meta/') ? { meta: { id: path.match(/(tt\d+)/)?.[1], type: 'movie', name: 'Picked Film' } } : { metas: titles };
    return route.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.addInitScript((url) => {
    localStorage.setItem('bridged-streams.addons.v1', JSON.stringify([`${url}/manifest.json`]));
  }, cinemeta);
  await page.goto('/');
  const homeRails = page.locator('.home-panel .media-row');
  await expect(homeRails).toHaveCount(6);
  await homeRails.nth(0).evaluate((rail) => { rail.scrollLeft = 600; });
  const lower = homeRails.nth(4);
  await lower.scrollIntoViewIfNeeded();
  await lower.evaluate((rail) => { rail.scrollLeft = 600; });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await lower.locator('.media-card').nth(4).click();
  await expect(page.getByRole('dialog', { name: 'Picked Film', exact: true })).toBeVisible();

  const home = page.getByRole('button', { name: 'Back to Home', exact: true });
  await home.scrollIntoViewIfNeeded();
  await home.click();
  await expect(page.getByRole('dialog', { name: 'Picked Film', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => homeRails.evaluateAll((rails) => rails.map((rail) => rail.scrollLeft))).toEqual([0, 0, 0, 0, 0, 0]);
});
