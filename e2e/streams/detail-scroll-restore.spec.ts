import { expect, test, type Page } from '@playwright/test';

const addon = 'https://detail-scroll-addon.test';
const json = (data: unknown) => ({ json: data, headers: { 'access-control-allow-origin': '*' } });
const filmName = (id: number) => id === 100 ? 'Sample Film' : `Film ${id}`;

async function setup(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://image.tmdb.org/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.addInitScript((url) => {
    localStorage.setItem('bridged-streams.addons.v1', JSON.stringify([`${url}/manifest.json`]));
    localStorage.setItem('bridged-streams.tmdb-key.v1', 'test-tmdb-key');
    localStorage.setItem('bridged-streams.tmdb-enrichment.v1', JSON.stringify({ enabled: true }));
  }, addon);
  await page.route(`${addon}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/manifest.json') return route.fulfill(json({ id: 'detail-scroll', name: 'Scroll Addon', version: '1.0.0', types: ['movie'],
      idPrefixes: ['tt'], resources: ['catalog', 'meta'], catalogs: [{ type: 'movie', id: 'top', name: 'Top' }] }));
    if (path.startsWith('/catalog/')) return route.fulfill(json({ metas: [{ id: 'tt100', type: 'movie', name: 'Sample Film' }] }));
    const id = Number(path.match(/\/meta\/movie\/tt(\d+)\.json$/)?.[1]);
    return route.fulfill(json({ meta: { id: `tt${id}`, type: 'movie', name: filmName(id), description: 'A film. '.repeat(80) } }));
  });
  // Every film is its own TMDB id; each recommends sixteen others.
  await page.route('https://api.themoviedb.org/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const found = path.match(/^\/3\/find\/tt(\d+)$/);
    if (found) return route.fulfill(json({ movie_results: [{ id: Number(found[1]) }] }));
    const movie = path.match(/^\/3\/movie\/(\d+)$/);
    if (movie) {
      const id = Number(movie[1]);
      return route.fulfill(json({ id, title: filmName(id), imdb_id: `tt${id}`, overview: 'A film. '.repeat(80),
        recommendations: { results: Array.from({ length: 16 }, (_, index) => ({ id: id * 10 + index + 1, title: filmName(id * 10 + index + 1) })) } }));
    }
    return route.fulfill(json({}));
  });
}

const panelTop = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.detail-panel')].at(-1)?.scrollTop ?? -1);
const moreLikeThis = (page: Page) => page.getByRole('region', { name: 'More like this' }).locator('.media-row');

async function openSampleFilm(page: Page) {
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await expect(page.getByRole('heading', { name: 'Sample Film', exact: true })).toBeVisible();
  await expect(moreLikeThis(page).locator('.media-card')).toHaveCount(16);
}

test('returning from another title restores the page and its rows at once', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await openSampleFilm(page);
  const rail = moreLikeThis(page);
  await rail.scrollIntoViewIfNeeded();
  await rail.evaluate((element) => element.scrollTo({ left: 500, behavior: 'instant' }));
  const top = await panelTop(page);
  expect(top).toBeGreaterThan(0);
  await rail.getByRole('button', { name: 'View details for Film 1006' }).click();
  await expect(page.getByRole('heading', { name: 'Film 1006', exact: true })).toBeVisible();
  // Opening it scrolls smoothly to the top; let that finish before watching the return.
  await expect.poll(() => panelTop(page)).toBe(0);

  // Sample every frame of the return: a smooth scroll would pass through positions in between.
  await page.evaluate(() => {
    const samples: number[] = [];
    (window as unknown as { samples: number[] }).samples = samples;
    const sample = () => { samples.push([...document.querySelectorAll<HTMLElement>('.detail-panel')].at(-1)?.scrollTop ?? 0);
      if (samples.length < 40) requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  });
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Sample Film', exact: true })).toBeVisible();
  await expect.poll(() => panelTop(page)).toBe(top);
  await expect.poll(() => moreLikeThis(page).evaluate((element) => element.scrollLeft)).toBe(500);
  await expect.poll(() => page.evaluate(() => (window as unknown as { samples: number[] }).samples.length)).toBe(40);
  const samples = await page.evaluate(() => (window as unknown as { samples: number[] }).samples);
  // One jump, even while the TMDB rows below are still rendering.
  expect(samples.filter((value) => Math.abs(value) > 1 && Math.abs(value - top) > 1)).toEqual([]);
});

test('reaching Home forgets places on details pages', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await openSampleFilm(page);
  const rail = moreLikeThis(page);
  await rail.scrollIntoViewIfNeeded();
  await rail.evaluate((element) => element.scrollTo({ left: 500, behavior: 'instant' }));
  expect(await panelTop(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Back to browsing' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.detail-panel')).toHaveCount(0);

  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Sample Film', exact: true })).toBeVisible();
  await expect(moreLikeThis(page).locator('.media-card')).toHaveCount(16);
  expect(await panelTop(page)).toBe(0);
  expect(await moreLikeThis(page).evaluate((element) => element.scrollLeft)).toBe(0);
});
