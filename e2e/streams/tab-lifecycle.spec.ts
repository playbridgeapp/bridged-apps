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

    test('returns from titles and catalogs to the browsing position while tab switches reset it', async ({ page }) => {
      const browsingCatalogs = catalogs.map((catalog, index) => ({ ...catalog, type: index % 2 ? 'series' : 'movie' }));
      const items = browsingCatalogs.map((catalog, row) => Array.from({ length: 24 }, (_, index) => ({
        id: `tt${row}${String(index).padStart(3, '0')}`, type: catalog.type, name: `Title ${row}-${index}`, poster
      })));
      await page.addInitScript((url) => {
        localStorage.setItem('bridged-streams.addons.v1', JSON.stringify([`${url}/manifest.json`]));
      }, addon);
      await page.route(`${addon}/**`, (route) => {
        const path = new URL(route.request().url()).pathname;
        const row = Number(path.match(/row-(\d+)/)?.[1] || '0');
        const item = items.flat().find((item) => path.endsWith(`/${item.id}.json`));
        const json = path === '/manifest.json'
          ? { id: 'tab-lifecycle', name: 'Tab Lifecycle', version: '1.0.0', types: ['movie', 'series'],
            resources: ['catalog', 'meta'], catalogs: browsingCatalogs }
          : path.startsWith('/meta/') ? { meta: item } : { metas: items[row] };
        return route.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
      });

      await page.goto('/');
      await expect(page.locator('.home-panel .catalog-section')).toHaveCount(8);
      for (const row of [4, 5]) {
        const section = page.locator('.home-panel .catalog-section').nth(row);
        await section.scrollIntoViewIfNeeded();
        const rail = section.locator('.media-row');
        await expect(rail.locator('.media-card')).toHaveCount(12);
        await rail.evaluate((element) => { element.scrollLeft = 350; });
        const card = rail.locator('.media-card').nth(3);
        await card.scrollIntoViewIfNeeded();
        const position = await page.evaluate(() => window.scrollY);
        const horizontal = await rail.evaluate((element) => element.scrollLeft);
        expect(position).toBeGreaterThan(700);
        const originalCard = await card.elementHandle();

        await card.click();
        await expect(page.getByRole('dialog', { name: `Title ${row}-3`, exact: true })).toBeVisible();
        await expect(page.locator('.detail-play')).toBeEnabled();
        if (row === 4) await page.locator('.detail-back').click();
        else await page.goBack();
        await expect(page).toHaveURL(/#\/$/);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(position);
        await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBe(horizontal);
        expect(await card.evaluate((element, original) => element === original, originalCard!)).toBe(true);
        await originalCard!.dispose();
      }

      const catalogButton = page.getByRole('button', { name: 'View all Catalog 6 from Tab Lifecycle' });
      await catalogButton.scrollIntoViewIfNeeded();
      const homePosition = await page.evaluate(() => window.scrollY);
      await catalogButton.click();
      const catalog = page.getByRole('dialog', { name: 'Catalog 6 catalog' });
      await expect(catalog).toBeVisible();
      const catalogCard = catalog.locator('.media-card').nth(18);
      await catalogCard.scrollIntoViewIfNeeded();
      const panel = page.locator('.catalog-page-panel');
      const catalogPosition = await panel.evaluate((element) => element.scrollTop);
      expect(catalogPosition).toBeGreaterThan(0);
      await catalogCard.click();
      await expect(page.locator('.detail-play')).toBeEnabled();
      await page.goBack();
      await expect(page).toHaveURL(/#\/catalog\//);
      await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(catalogPosition);
      await catalog.getByRole('button', { name: 'Back to home' }).click();
      await expect(page).toHaveURL(/#\/$/);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(homePosition);

      await goTab(page, 'Search');
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.getByRole('textbox', { name: 'Search movies, TV shows, and sports' }).fill('Title');
      await page.locator('.search-submit').click();
      const searchCard = page.locator('.search-results .media-card').nth(36);
      await searchCard.scrollIntoViewIfNeeded();
      const searchPosition = await page.evaluate(() => window.scrollY);
      expect(searchPosition).toBeGreaterThan(700);
      await searchCard.click();
      await expect(page.locator('.detail-play')).toBeEnabled();
      await page.locator('.detail-back').click();
      await expect(page).toHaveURL(/#\/search\?q=Title$/);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(searchPosition);
      await goTab(page, 'Home');
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await goTab(page, 'Search');
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    });

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
      await expect(page.locator('.home-panel .catalog-section')).toHaveCount(8);
      const rail = page.locator('.home-panel .media-row').first();
      await rail.scrollIntoViewIfNeeded();
      await expect(rail.locator('img')).toHaveCount(12);
      await expect(page.locator('.home-panel .media-row').last().locator('img')).toHaveCount(0);
      await rail.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      await expect(rail.locator('img')).toHaveCount(24);
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

      await page.evaluate(() => {
        (window as any).__homePaint = null;
        const observer = new MutationObserver(() => {
          const home = document.querySelector('.home-panel');
          if (!home) return;
          observer.disconnect();
          requestAnimationFrame(() => {
            (window as any).__homePaint = {
              images: home.querySelectorAll('img').length,
              placeholder: !!home.querySelector('.home-loading'),
              searchPresent: !!document.querySelector('.search-panel'),
              activeTab: document.querySelector('.mobile-nav [aria-current="page"]')?.getAttribute('aria-label')
            };
          });
        });
        observer.observe(document.querySelector('main')!, { childList: true, subtree: true });
      });
      await goTab(page, 'Home');
      await expect(page.locator('.home-panel .catalog-section')).toHaveCount(8);
      expect(await page.evaluate(() => (window as any).__homePaint)).toEqual({
        images: 0, placeholder: true, searchPresent: false, activeTab: 'Home'
      });
      await expect(page.locator('.library-panel')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await rail.scrollIntoViewIfNeeded();
      await expect(rail.locator('img')).toHaveCount(12);
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
