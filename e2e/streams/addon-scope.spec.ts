import { expect, test, type Page } from '@playwright/test';

const headers = { 'access-control-allow-origin': '*' };
const backend = 'https://scope-cloud.test';
const catalogAddon = (id: string, name: string, row: string) => ({
  url: `https://${id}.test/manifest.json`,
  manifest: { id, name, version: '1.0.0', types: ['movie'], resources: ['catalog', 'meta'], catalogs: [{ id: 'picks', type: 'movie', name: row }] }
});
const browser = catalogAddon('scope-browser', 'Browser Catalog', 'Browser picks');
const profile = catalogAddon('scope-profile', 'Profile Catalog', 'Profile picks');
const stremio = catalogAddon('scope-stremio', 'Stremio Catalog', 'Stremio picks');

async function serveAddons(page: Page) {
  for (const addon of [browser, profile, stremio]) {
    await page.route(`${new URL(addon.url).origin}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = path === '/manifest.json' ? addon.manifest
        : path.startsWith('/catalog/') ? { metas: [{ id: `${addon.manifest.id}-title`, type: 'movie', name: `${addon.manifest.name} title` }] }
        : { meta: { id: `${addon.manifest.id}-title`, type: 'movie', name: `${addon.manifest.name} title` } };
      return route.fulfill({ json, headers });
    });
  }
}

async function seedBrowserAddon(page: Page) {
  await page.addInitScript(({ url, manifest }) => {
    if (sessionStorage.getItem('browser-addon-seeded')) return;
    sessionStorage.setItem('browser-addon-seeded', '1');
    localStorage.setItem('bridged-streams.addons.v1', JSON.stringify([url]));
    localStorage.setItem('bridged-streams.startup-cache.v1.local-addons', JSON.stringify({ scope: 'browser', value: [{ manifestUrl: url, manifest }] }));
  }, browser);
}

const manager = (page: Page) => page.getByRole('dialog', { name: 'Manage addons' });
const settingsTab = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings', exact: true });
const homeTab = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Home', exact: true });

test('a Nuvio profile uses only its own addons and can take over the ones saved in this browser', async ({ page }) => {
  const state = { addons: [{ url: profile.url, enabled: true }] as { url: string; enabled: boolean }[], pushes: [] as string[][] };
  await serveAddons(page);
  await seedBrowserAddon(page);
  await page.addInitScript((backend) => {
    localStorage.setItem('bridged-streams.nuvio-session.v1', JSON.stringify({ backendUrl: backend, publishableKey: 'scope-key', accessToken: 'scope-access',
      refreshToken: 'scope-refresh', expiresAt: Date.now() + 3600000, user: { id: 'scope-user', email: 'scope@example.invalid' } }));
    localStorage.setItem('bridged-streams.nuvio-profile.v1', JSON.stringify({ userId: 'scope-user', index: 1 }));
  }, backend);
  await page.route(`${backend}/**`, (route) => {
    const method = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    if (method === 'sync_push_addons') {
      state.addons = body.p_addons.map((row: { url: string; enabled: boolean }) => ({ url: row.url, enabled: row.enabled }));
      state.pushes.push(state.addons.map((row) => row.url));
      return route.fulfill({ json: null, headers });
    }
    const json = method === 'sync_pull_profiles' ? [{ profile_index: 1, name: 'Alex' }] : method === 'addons' ? state.addons : [];
    return route.fulfill({ json, headers });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Profile picks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Browser picks' })).toHaveCount(0);

  await settingsTab(page).click();
  await expect(page.getByRole('button', { name: /^Addons / })).toContainText("Alex's Nuvio profile · 1 addon");
  await page.getByRole('button', { name: /^Addons / }).click();
  await expect(manager(page).locator('.source-owner')).toContainText('Alex');
  await expect(manager(page).locator('.addon-management-card')).toHaveText([/Profile Catalog/]);
  const notice = manager(page).getByRole('group', { name: 'Sources saved in this browser' });
  await expect(notice).toContainText("1 addon saved in this browser isn't used while you're signed in.");
  await notice.getByRole('button', { name: 'Add it to Alex' }).click();
  await expect(notice).toHaveCount(0);
  expect(state.pushes).toEqual([[profile.url, browser.url]]);
  await expect(manager(page).locator('.addon-management-card')).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem('bridged-streams.addons.v1'))).toBe('[]');

  await manager(page).getByRole('tab', { name: /^Plugins/ }).click();
  await expect(manager(page)).toContainText('No plugin repositories yet.');
  await manager(page).getByRole('button', { name: 'Close', exact: true }).click();
  await homeTab(page).click();
  await expect(page.getByRole('heading', { name: 'Browser picks' })).toBeVisible();
});

test('a Stremio account hides browser addons until sign-out, and keeping them is remembered', async ({ page }) => {
  await serveAddons(page);
  await seedBrowserAddon(page);
  await page.addInitScript(({ url, manifest }) => {
    if (sessionStorage.getItem('stremio-seeded')) return;
    sessionStorage.setItem('stremio-seeded', '1');
    localStorage.setItem('bridged-streams.stremio-session.v1', JSON.stringify({ authKey: 'synthetic-not-a-real-key', user: { _id: 'scope-user', email: 'stremio@example.invalid' } }));
    localStorage.setItem('bridged-streams.startup-cache.v1.stremio-addons', JSON.stringify({ scope: 'scope-user', value: [{ manifestUrl: url, manifest }] }));
  }, stremio);
  await page.route('https://api.strem.io/api/**', (route) => {
    const method = route.request().url().split('/').pop();
    const result = method === 'getUser' ? { _id: 'scope-user', email: 'stremio@example.invalid' }
      : method === 'addonCollectionGet' ? { addons: [{ transportUrl: stremio.url, manifest: stremio.manifest }] } : [];
    return route.fulfill({ json: { result }, headers });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Stremio picks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Browser picks' })).toHaveCount(0);
  await page.goto('/#/settings/addons');
  await expect(manager(page).locator('.source-owner')).toContainText('Stremio account');
  await expect(manager(page).getByRole('tab')).toHaveCount(0);
  await expect(manager(page).locator('.addon-management-card')).toHaveText([/Stremio Catalog/]);
  await manager(page).getByRole('button', { name: "Keep for when I'm signed out" }).click();
  await expect(manager(page).getByRole('group', { name: 'Sources saved in this browser' })).toHaveCount(0);
  await page.reload();
  await expect(manager(page).locator('.addon-management-card')).toHaveText([/Stremio Catalog/]);
  await expect(manager(page).getByRole('group', { name: 'Sources saved in this browser' })).toHaveCount(0);

  await page.goto('/#/settings/accounts');
  await page.getByRole('button', { name: 'Disconnect this account' }).click();
  await page.goto('/#/settings/addons');
  await expect(manager(page).locator('.source-owner')).toContainText('This browser');
  await expect(manager(page).locator('.addon-management-card')).toHaveText([/Browser Catalog/]);
  await expect(manager(page).getByRole('tab', { name: /^Plugins/ })).toBeVisible();
  await manager(page).getByRole('button', { name: 'Close', exact: true }).click();
  await homeTab(page).click();
  await expect(page.getByRole('heading', { name: 'Browser picks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stremio picks' })).toHaveCount(0);
});

test('playback settings have their own panel for this device', async ({ page }) => {
  await page.goto('/');
  await settingsTab(page).click();
  await page.getByRole('button', { name: /^Playback / }).click();
  const playback = page.getByRole('dialog', { name: 'Playback settings' });
  await expect(playback.getByRole('heading', { level: 3 })).toHaveText(['Choosing a stream', 'Player', 'Troubleshooting']);
  await expect(playback.getByRole('switch', { name: 'Auto-select stream', exact: true })).toBeVisible();
  await expect(playback.getByRole('switch', { name: 'Native player fallback' })).toBeVisible();
  await expect(page).toHaveURL(/#\/settings\/playback$/);
});

test('catalogs with addon-declared content types load, open, and keep their links', async ({ page }) => {
  const tube = 'https://scope-tube.test';
  const clip = { id: 'tbl:1', type: 'Tube', name: 'Custom Clip', poster: '' };
  await page.route(`${tube}/**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const json = path === '/manifest.json'
      ? { id: 'scope-tube', name: 'Tube Catalog', version: '1.0.0', types: ['Tube'], idPrefixes: ['tbl:'], resources: ['catalog', 'meta', 'stream'],
        catalogs: [{ id: 'recent', type: 'Tube', name: 'Tubes - Recent', extra: [{ name: 'genre', options: ['All', 'Other'] }, { name: 'skip' }] }] }
      : path.startsWith('/catalog/Tube/') ? { metas: [clip] }
      : path === '/meta/Tube/tbl:1.json' ? { meta: { ...clip, description: 'A custom-type title' } }
      : { streams: [] };
    return route.fulfill({ json, headers });
  });
  await page.addInitScript((url) => localStorage.setItem('bridged-streams.addons.v1', JSON.stringify([url])), `${tube}/manifest.json`);
  await page.goto('/');
  const row = page.locator('.catalog-section').filter({ has: page.getByRole('heading', { name: 'Tubes - Recent' }) });
  await expect(row).toContainText('TUBE · Tube Catalog');
  await row.getByRole('button', { name: 'View details for Custom Clip' }).click();
  await expect(page.getByRole('dialog', { name: 'Custom Clip', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/Tube\/tbl%3A1$/);
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Custom Clip', exact: true })).toBeVisible();
  await expect(page.getByText('A custom-type title')).toBeVisible();
});
