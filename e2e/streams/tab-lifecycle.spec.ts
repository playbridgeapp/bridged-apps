import { expect, test, type Page } from '@playwright/test';

const addon = 'https://tab-lifecycle.test';
const catalogs = Array.from({ length: 8 }, (_, index) => ({
  type: 'movie', id: `row-${index}`, name: `Catalog ${index}`,
  extra: [{ name: 'search' }]
}));
const poster = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function goTab(page: Page, name: 'Home' | 'Search' | 'Library' | 'Settings') {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test.describe(`${viewport.width}px tab lifecycle`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });

    test('unmounts inactive posters, keeps cached content and drafts, and resets tab scroll', async ({ page }) => {
      const requests: string[] = [];
      await page.addInitScript((url) => {
        localStorage.setItem('bridged-streams.addons.v1', JSON.stringify([`${url}/manifest.json`]));
      }, addon);
      await page.route(`${addon}/**`, (route) => {
        const path = new URL(route.request().url()).pathname;
        requests.push(path);
        const row = path.match(/row-(\d+)/)?.[1] || '0';
        const metas = Array.from({ length: 24 }, (_, index) => ({
          id: `tt${row}${String(index).padStart(3, '0')}`, type: 'movie', name: `Film ${row}-${index}`, poster
        }));
        return route.fulfill({ json: path === '/manifest.json'
          ? { id: 'tab-lifecycle', name: 'Tab Lifecycle', version: '1.0.0', types: ['movie'], resources: ['catalog'], catalogs }
          : { metas }, headers: { 'access-control-allow-origin': '*' } });
      });

      await page.goto('/');
      await expect(page.locator('.home-panel .media-row img')).toHaveCount(192);
      const rail = page.locator('.home-panel .media-row').first();
      await rail.scrollIntoViewIfNeeded();
      await rail.evaluate((element) => { element.scrollLeft = 350; });
      await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBe(350);
      await page.evaluate(() => window.scrollTo(0, 700));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);

      await goTab(page, 'Search');
      await expect(page.locator('.home-panel')).toHaveCount(0);
      await expect(page.locator('.discover-grid img')).toHaveCount(24);
      const input = page.getByRole('textbox', { name: 'Search movies, TV shows, and sports' });
      await input.fill('Unsubmitted draft');
      const requestCount = requests.length;

      await goTab(page, 'Library');
      await expect(page.locator('.search-panel')).toHaveCount(0);
      await expect(page.locator('main img')).toHaveCount(0);
      await goTab(page, 'Settings');
      await expect(page.locator('.library-panel')).toHaveCount(0);
      await expect(page.locator('main img')).toHaveCount(0);
      await page.goBack();
      await expect(page.locator('.library-panel')).toBeVisible();
      await expect(page.locator('.settings-page')).toHaveCount(0);

      await goTab(page, 'Home');
      await expect(page.locator('.home-panel .media-row img')).toHaveCount(192);
      await expect(page.locator('.library-panel')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await rail.scrollIntoViewIfNeeded();
      await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBe(0);

      await goTab(page, 'Search');
      await expect(input).toHaveValue('Unsubmitted draft');
      await expect(page.locator('.home-panel')).toHaveCount(0);
      expect(requests).toHaveLength(requestCount);
      await input.fill('Film');
      await page.locator('.search-submit').click();
      await expect(page.locator('.search-results img')).toHaveCount(192);
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect.poll(() => page.evaluate(() => Math.abs(window.scrollY - 600))).toBeLessThan(8);
      const searchRequestCount = requests.length;

      await goTab(page, 'Home');
      await expect(page.locator('.search-panel')).toHaveCount(0);
      await goTab(page, 'Search');
      await expect(input).toHaveValue('Film');
      await expect(page.locator('.search-results img')).toHaveCount(192);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
      await goTab(page, 'Home');
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.goBack();
      await expect(page.locator('.search-results img')).toHaveCount(192);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      expect(requests).toHaveLength(searchRequestCount);
    });
  });
}
