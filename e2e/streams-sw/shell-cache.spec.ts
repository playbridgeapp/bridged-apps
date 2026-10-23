import { expect, test, type Page } from '@playwright/test';

const SHELL_CACHE = 'playbridge-shell-v1';

async function shellCached(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async (name) => {
    const cache = await caches.open(name);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  }, SHELL_CACHE), { timeout: 15_000 }).toContain('/');
}

test('opens offline from the cached shell after one online visit', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await shellCached(page);
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    // Hash routes boot from the same shell.
    await page.goto('/#/library');
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).locator('[aria-current="page"]')).toHaveAttribute('aria-label', 'Library');
  } finally { await context.setOffline(false); }
});

test('the shell cache holds only the public page and its versioned entry assets', async ({ page }) => {
  await page.goto('/');
  await shellCached(page);
  const paths = await page.evaluate(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url)), SHELL_CACHE);
  for (const url of paths) {
    expect(url.search).toBe('');
    expect(url.pathname === '/' || /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?)$/.test(url.pathname)).toBe(true);
  }
  // Every entry asset referenced by the cached page is present beside it.
  const complete = await page.evaluate(async (name) => {
    const cache = await caches.open(name);
    const html = await (await cache.match('/'))!.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
    return assets.length > 0 && (await Promise.all(assets.map((path) => cache.match(path)))).every(Boolean);
  }, SHELL_CACHE);
  expect(complete).toBe(true);
});

test('a shell with a missing entry asset is not served; the network page is used and the shell repaired', async ({ page }) => {
  await page.goto('/');
  await shellCached(page);
  const removed = await page.evaluate(async (name) => {
    const cache = await caches.open(name);
    const html = await (await cache.match('/'))!.text();
    const path = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)][0][1];
    await cache.delete(path);
    // Also drop it from the general asset cache so the shell can't borrow it.
    await (await caches.open('playbridge-static-assets-v1')).delete(path);
    return path;
  }, SHELL_CACHE);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect.poll(() => page.evaluate(async ([name, path]) => !!(await (await caches.open(name)).match(path)), [SHELL_CACHE, removed] as const)).toBe(true);
});

test('offline with nothing cached shows an offline page instead of a browser error', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(async (name) => { await caches.delete(name); }, SHELL_CACHE);
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  } finally { await context.setOffline(false); }
});
