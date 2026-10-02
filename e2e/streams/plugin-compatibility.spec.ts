import { expect, test } from '@playwright/test';

test('shows Castle-style S8E2 streams and preserves supported playback headers', async ({ page }) => {
  const addon = 'https://castle-catalog.test';
  const plugin = 'https://castle-plugin.test';
  const show = { id: 'tt2861424', type: 'series', name: 'Rick and Morty' };
  const headers = { 'User-Agent': 'Mozilla/5.0', Accept: 'video/*', 'Accept-Language': 'en-US',
    'Accept-Encoding': 'gzip, deflate', Connection: 'keep-alive', 'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Site': 'cross-site', DNT: '1',
    Referer: 'https://castle-media.test/', Authorization: 'Bearer test-playback-token' };
  await page.route(`${addon}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === '/manifest.json'
      ? { id: 'castle-catalog', name: 'Castle Catalog', version: '1.0.0', types: ['series'], resources: ['catalog', 'meta'], catalogs: [{ id: 'shows', type: 'series', name: 'Castle shows' }] }
      : path.startsWith('/catalog/') ? { metas: [show] }
      : { meta: { ...show, videos: [{ id: 'tt2861424:8:2', season: 8, episode: 2, title: 'Valkyrick' }] } };
    return route.fulfill({ json });
  });
  await page.route('https://api.themoviedb.org/**', (route) => route.fulfill({ json: { tv_results: [{ id: 60625 }] } }));
  await page.route(`${plugin}/**`, (route) => {
    if (route.request().url().endsWith('/manifest.json')) return route.fulfill({ json: { name: 'Castle Test Repository', scrapers: [
      { id: 'castle', name: 'Castle', filename: 'castle.js', supportedTypes: ['movie', 'tv'], enabled: true }
    ] } });
    return route.fulfill({ contentType: 'text/javascript', body: `
      module.exports.getStreams = async (id, type, season, episode) => {
        if (id !== '60625' || type !== 'tv' || season !== 8 || episode !== 2) throw new Error('Wrong episode arguments');
        const headers = ${JSON.stringify(headers)};
        return [1080, 720, 480].map(quality => ({
          name: 'Castle [Shared] - ' + quality + 'P', title: 'Rick and Morty S08E02',
          url: 'https://castle-media.test/' + quality + '.mp4', headers
        })).concat([{ name: 'Unsupported custom header', url: 'https://castle-media.test/custom.mp4', headers: { 'X-Provider-Token': 'required' } }]);
      };
    ` });
  });
  await page.route('https://castle-media.test/**', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Add an addon' }).click();
  const manager = page.getByRole('dialog', { name: 'Manage addons' });
  await manager.getByLabel('Addon manifest URL').fill(`${addon}/manifest.json`);
  await manager.getByRole('button', { name: 'Install', exact: true }).first().click();
  await expect(manager.locator('.addon-management-card').getByText('Castle Catalog', { exact: true })).toBeVisible();
  await manager.getByLabel('Nuvio plugin repository URL').fill(`${plugin}/manifest.json`);
  await manager.getByRole('button', { name: 'Install', exact: true }).last().click();
  await expect(manager.getByText('Castle Test Repository', { exact: true })).toBeVisible();
  await manager.getByLabel('TMDB API key', { exact: true }).fill('test-tmdb-key');
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'View details for Rick and Morty', exact: true }).first().click();
  await page.locator('.episode-row').click();
  await expect(page.locator('.stream-result')).toHaveCount(3);
  await expect(page.locator('.stream-result-copy p')).toHaveText(['Castle [Shared] - 1080P', 'Castle [Shared] - 720P', 'Castle [Shared] - 480P']);
  await expect(page.locator('.stream-panel').getByRole('alert')).toHaveCount(0);
  await page.locator('.stream-result').first().getByRole('button', { name: 'Play', exact: true }).click();
  const player = page.locator('movi-player');
  await expect(player).toHaveAttribute('src', 'https://castle-media.test/1080.mp4');
  await expect(player).toHaveJSProperty('headers', { 'User-Agent': 'Mozilla/5.0', Accept: 'video/*', 'Accept-Language': 'en-US',
    Referer: 'https://castle-media.test/', Authorization: 'Bearer test-playback-token' });
});
