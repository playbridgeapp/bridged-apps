import { expect, test, type Page } from '@playwright/test';

const backend = 'https://gate-cloud.test';
const addon = 'https://gate-addon.test';
const headers = { 'access-control-allow-origin': '*' };
type Profile = { profile_index: number; name: string; pin_enabled?: boolean; avatar_color_hex?: string };
const family: Profile[] = [
  { profile_index: 1, name: 'Alex', avatar_color_hex: '#1E88E5' },
  { profile_index: 2, name: 'Jordan', pin_enabled: true, avatar_color_hex: '#FB8C00' },
  { profile_index: 3, name: 'Kids' }
];
const picker = (page: Page) => page.getByRole('dialog', { name: "Who's watching?" });

async function mockCloud(page: Page, options: { retryAfter?: number } = {}) {
  const state = { pinAttempts: [] as string[] };
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = url.pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    if (url.pathname === '/auth/v1/token') {
      return route.fulfill({ json: { access_token: 'gate-access', refresh_token: 'gate-refresh', expires_in: 3600, user: { id: 'gate-user', email: 'gate@example.invalid' } }, headers });
    }
    if (method === 'verify_profile_pin') {
      state.pinAttempts.push(body.p_pin);
      return route.fulfill({ json: [body.p_pin === '2468' ? { unlocked: true } : { unlocked: false, retry_after_seconds: options.retryAfter ?? 0 }], headers });
    }
    const json = method === 'sync_pull_profiles' ? family : method === 'addons' ? [{ url: `${addon}/manifest.json`, enabled: true }] : [];
    return route.fulfill({ json, headers });
  });
  await page.route(`${addon}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === '/manifest.json'
      ? { id: 'gate', name: 'Gate Catalog', version: '1.0.0', types: ['movie'], resources: ['catalog', 'meta'], catalogs: [{ id: 'picks', type: 'movie', name: 'Gate picks' }] }
      : path.startsWith('/catalog/') ? { metas: [{ id: 'tt-gate', type: 'movie', name: 'Gate Movie' }] }
      : { meta: { id: 'tt-gate', type: 'movie', name: 'Gate Movie' } };
    return route.fulfill({ json, headers });
  });
  return state;
}

async function mockStremio(page: Page) {
  await page.route('https://api.strem.io/api/**', (route) => {
    const method = route.request().url().split('/').pop();
    const result = method === 'getUser' ? { _id: 'stremio-user', email: 'stremio@example.invalid' } : method === 'addonCollectionGet' ? { addons: [] } : [];
    return route.fulfill({ json: { result }, headers });
  });
}

async function signedIn(page: Page, index: number, mode?: 'remember') {
  await page.addInitScript(({ backend, index, mode }) => {
    localStorage.setItem('bridged-streams.nuvio-session.v1', JSON.stringify({ backendUrl: backend, publishableKey: 'gate-key', accessToken: 'gate-access',
      refreshToken: 'gate-refresh', expiresAt: Date.now() + 3600000, user: { id: 'gate-user', email: 'gate@example.invalid' } }));
    if (!localStorage.getItem('bridged-streams.nuvio-profile.v1')) localStorage.setItem('bridged-streams.nuvio-profile.v1', JSON.stringify({ userId: 'gate-user', index }));
    if (mode) localStorage.setItem('bridged-streams.profile-launch.v1', mode);
  }, { backend, index, mode });
}

async function seedStremio(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('stremio-seeded')) return;
    sessionStorage.setItem('stremio-seeded', '1');
    localStorage.setItem('bridged-streams.stremio-session.v1', JSON.stringify({ authKey: 'synthetic-not-a-real-key', user: { _id: 'stremio-user', email: 'stremio@example.invalid' } }));
  });
}

test('asks who is watching on a new visit, keeps the choice on reload, and asks again in a new tab', async ({ page, context }) => {
  await mockCloud(page);
  await signedIn(page, 1);
  await page.goto('/');
  await expect(picker(page).getByRole('button', { name: 'Alex, last used', exact: true })).toBeVisible();
  await expect(picker(page).getByRole('button', { name: 'Jordan, PIN required', exact: true })).toBeVisible();
  await picker(page).getByRole('button', { name: 'Kids', exact: true }).click();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Gate picks' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Gate picks' })).toBeVisible();
  await expect(picker(page)).toHaveCount(0);

  const second = await context.newPage();
  await mockCloud(second);
  await second.goto('/');
  await expect(picker(second).getByRole('button', { name: 'Kids, last used', exact: true })).toBeVisible();
});

test('a reload on a title link asks for the locked profile PIN, then returns to the title', async ({ page }) => {
  const state = await mockCloud(page);
  await signedIn(page, 2, 'remember');
  await page.goto('/#/movie/tt-gate');
  await expect(picker(page)).toContainText('Returns to the title you were viewing');
  await picker(page).getByRole('button', { name: 'Jordan, PIN required, last used', exact: true }).click();
  await picker(page).getByLabel('Profile PIN').fill('1111');
  await expect(picker(page).getByRole('status')).toContainText('The profile PIN was not accepted.');
  await picker(page).getByLabel('Profile PIN').fill('2468');
  await expect(picker(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/movie\/tt-gate$/);
  await expect(page.getByRole('dialog', { name: 'Gate Movie', exact: true })).toBeVisible();
  expect(state.pinAttempts).toEqual(['1111', '2468']);

  // The unlock is never kept, so a refresh asks for the PIN again.
  await page.reload();
  await expect(picker(page).getByRole('button', { name: 'Jordan, PIN required, last used', exact: true })).toBeVisible();
});

test('a rate-limited PIN disables the keypad and says when to retry', async ({ page }) => {
  await mockCloud(page, { retryAfter: 30 });
  await signedIn(page, 2, 'remember');
  await page.goto('/');
  await picker(page).getByRole('button', { name: 'Jordan, PIN required, last used', exact: true }).click();
  for (const digit of '1357') await picker(page).getByRole('button', { name: digit, exact: true }).click();
  await expect(picker(page).getByRole('status')).toContainText(/Too many attempts\. Try again in \d+s\./);
  await expect(picker(page).getByRole('button', { name: '5', exact: true })).toBeDisabled();
  await picker(page).getByRole('button', { name: 'Profiles', exact: true }).click();
  await expect(picker(page).getByRole('button', { name: 'Alex', exact: true })).toBeVisible();
});

test('remember last profile opens a new tab straight into an unlocked profile', async ({ page, context }) => {
  await mockCloud(page);
  await signedIn(page, 1);
  await page.goto('/');
  await picker(page).getByRole('button', { name: 'Alex, last used', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.watching-as')).toContainText('Alex');
  await page.getByRole('button', { name: /Accounts and profiles/ }).click();
  await page.getByRole('radio', { name: /Remember last profile/ }).check();

  const second = await context.newPage();
  await mockCloud(second);
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Gate picks' })).toBeVisible();
  await expect(picker(second)).toHaveCount(0);
});

test('signing in to Nuvio replaces a Stremio account and then asks who is watching', async ({ page }) => {
  await mockCloud(page);
  await mockStremio(page);
  await seedStremio(page);
  await page.goto('/#/settings/accounts');
  const accounts = page.getByRole('dialog', { name: 'Accounts', exact: true });
  await accounts.getByRole('button', { name: 'Switch to Nuvio', exact: true }).click();
  const signIn = page.getByRole('dialog', { name: 'Sign in to Nuvio' });
  await expect(signIn).toContainText('Signing in will sign out of Stremio');
  await signIn.getByLabel('Email', { exact: true }).fill('gate@example.invalid');
  await signIn.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await signIn.getByRole('button', { name: /Nuvio Cloud/ }).click();
  await signIn.getByLabel('Backend URL').fill(backend);
  await signIn.getByLabel('Public publishable key').fill('gate-key');
  await signIn.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(signIn).toHaveCount(0);
  await picker(page).getByRole('button', { name: 'Alex', exact: true }).click();
  await expect(picker(page)).toHaveCount(0);
  await expect(accounts.getByRole('button', { name: 'Switch to Stremio', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('bridged-streams.stremio-session.v1'))).toBeNull();
});

test('a browser that still has both accounts asks which one to keep', async ({ page }) => {
  await mockCloud(page);
  await mockStremio(page);
  await signedIn(page, 1, 'remember');
  await seedStremio(page);
  await page.goto('/#/settings/accounts');
  const accounts = page.getByRole('dialog', { name: 'Accounts', exact: true });
  await expect(accounts).toContainText('Streams now uses one account at a time.');
  await accounts.getByRole('button', { name: 'Keep Nuvio', exact: true }).click();
  await expect(accounts.getByRole('button', { name: 'Switch to Stremio', exact: true })).toBeVisible();
  await expect(accounts).not.toContainText('Streams now uses one account at a time.');
  expect(await page.evaluate(() => localStorage.getItem('bridged-streams.stremio-session.v1'))).toBeNull();
});
