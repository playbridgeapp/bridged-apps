import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const SHELL_CACHE = 'playbridge-shell-v1';

async function shellCached(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async (name) => {
    const cache = await caches.open(name);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  }, SHELL_CACHE), { timeout: 15_000 }).toContain('/');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

async function removeEntryAsset(page: Page) {
  return page.evaluate(async (name) => {
    const cache = await caches.open(name);
    const html = await (await cache.match('/'))!.text();
    const path = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)][0][1];
    await cache.delete(path);
    // Also drop it from the general asset cache so the shell can't borrow it.
    await (await caches.open('playbridge-static-assets-v1')).delete(path);
    return path;
  }, SHELL_CACHE);
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
  const removed = await removeEntryAsset(page);
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


test('an incomplete shell is never used as the offline fallback', async ({ page, context }) => {
  await page.goto('/');
  await shellCached(page);
  await removeEntryAsset(page);
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  } finally { await context.setOffline(false); }
});

async function deployShell(context: BrowserContext, delay = 0) {
  const response = await context.request.get('/');
  const original = await response.text();
  const entry = original.match(/<script[^>]+src="(\/assets\/[^" ]+\.js)"/)![1];
  const path = '/assets/shell-test-deploy-00000001.js';
  const deployed = original.replace(entry, path).replace('<head>', '<head><meta name="streams-test-deploy" content="new">');
  let html = deployed;
  let requests = 0;
  await context.route(`**${path}`, async (route) => {
    const asset = await route.fetch({ url: new URL(entry, route.request().url()).href });
    await route.fulfill({ response: asset });
  });
  await context.route((url) => (url.pathname === '/' || url.pathname === '/index.html') && !url.search, async (route) => {
    requests += 1;
    const page = await route.fetch();
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({ response: page, body: html });
  });
  return { path, get requests() { return requests; }, useOriginal() { html = original; }, useDeploy() { html = deployed; } };
}

async function checkShellUpdate(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const updated = (event: MessageEvent) => {
      if (event.data?.type !== 'shell-updated') return;
      navigator.serviceWorker.removeEventListener('message', updated);
      resolve();
    };
    navigator.serviceWorker.addEventListener('message', updated);
    navigator.serviceWorker.controller!.postMessage({ type: 'check-shell-update' });
  }));
}

async function visibility(page: Page, state: 'visible' | 'hidden') {
  // Exercise the production handler without depending on headless window focus behavior.
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('a new deploy is shown on the first reload', async ({ page, context }) => {
  await page.goto('/');
  await shellCached(page);
  const deploy = await deployShell(context);
  await page.reload();
  await expect(page.locator('meta[name="streams-test-deploy"]')).toHaveAttribute('content', 'new');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.locator(`script[src="${deploy.path}"]`)).toHaveCount(1);
});

test('a slow network falls back quickly and still stores the late deploy', async ({ page, context }) => {
  await page.goto('/');
  await shellCached(page);
  await deployShell(context, 4000);
  const started = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(Date.now() - started).toBeLessThan(3000);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.locator('meta[name="streams-test-deploy"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async (name) => {
    const shell = await (await caches.open(name)).match('/');
    return shell ? (await shell.text()).includes('streams-test-deploy') : false;
  }, SHELL_CACHE), { timeout: 10_000 }).toBe(true);
  // Finishing the fetch must not interrupt the visible page that opened from the fallback.
  await expect(page.locator('meta[name="streams-test-deploy"]')).toHaveCount(0);
});

test('without a cached shell a late network response still opens', async ({ page, context }) => {
  await page.goto('/');
  await shellCached(page);
  await page.evaluate(async (name) => { await caches.delete(name); }, SHELL_CACHE);
  await deployShell(context, 2200);
  await page.reload();
  await expect(page.locator('meta[name="streams-test-deploy"]')).toHaveAttribute('content', 'new');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('a failed network response uses the complete cached shell', async ({ page, context }) => {
  await page.goto('/');
  await shellCached(page);
  await context.route((url) => url.pathname === '/', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' }));
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('a stored deploy waits for a visibility return, keeps the hash route and does not reload again', async ({ page, context }) => {
  await page.goto('/#/settings/playback');
  await shellCached(page);
  const deploy = await deployShell(context);
  let navigations = 0;
  page.on('domcontentloaded', () => { navigations += 1; });
  await checkShellUpdate(page);
  expect(navigations).toBe(0);
  await expect(page.locator('meta[name="streams-test-deploy"]')).toHaveCount(0);
  await visibility(page, 'hidden');
  expect(navigations).toBe(0);
  await Promise.all([page.waitForNavigation(), visibility(page, 'visible')]);
  await expect(page.locator('meta[name="streams-test-deploy"]')).toHaveAttribute('content', 'new');
  expect(new URL(page.url()).hash).toBe('#/settings/playback');
  expect(navigations).toBe(1);
  await shellCached(page);
  const requests = deploy.requests;
  await visibility(page, 'hidden');
  await visibility(page, 'visible');
  await expect.poll(() => deploy.requests).toBe(requests + 1);
  await checkShellUpdate(page);
  const checked = deploy.requests;
  await visibility(page, 'hidden');
  await visibility(page, 'visible');
  expect(deploy.requests).toBe(checked);
  expect(navigations).toBe(1);
});

test('an attempted version cannot cause a reload loop if the reload gets an older shell', async ({ page, context }) => {
  await page.goto('/');
  await shellCached(page);
  const deploy = await deployShell(context);
  await checkShellUpdate(page);
  deploy.useOriginal();
  await visibility(page, 'hidden');
  await Promise.all([page.waitForNavigation(), visibility(page, 'visible')]);
  await shellCached(page);
  await expect(page.locator('meta[name="streams-test-deploy"]')).toHaveCount(0);
  deploy.useDeploy();
  await checkShellUpdate(page);
  const document = await page.evaluate(() => performance.timeOrigin);
  await visibility(page, 'hidden');
  await visibility(page, 'visible');
  await checkShellUpdate(page);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(document);
});
