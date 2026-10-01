import { expect, test } from '@playwright/test';

test('sorts manual streams across arriving providers, respects provider tabs, and persists independently of auto-play', async ({ page }) => {
  const catalog = 'https://sorting-catalog.test';
  const preferred = 'https://sorting-preferred.test';
  const movie = { id: 'tt-sort', type: 'movie', name: 'Sorting Film' };
  const firstStreams = [
    { name: 'Unknown source', url: 'https://media.test/unknown.mp4' },
    { name: '720p WEB-DL partial', url: 'https://media.test/partial.mp4' },
    { name: '1080p WEB-DL first', url: 'https://media.test/first.mp4' },
    { name: '1080p WEB-DL second', url: 'https://media.test/second.mp4' }
  ];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let streamRequests = 0;
  for (const provider of [catalog, preferred]) {
    await page.route(`${provider}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      let json: unknown = {};
      if (path === '/manifest.json') json = {
        id: provider === catalog ? 'sorting-catalog' : 'sorting-preferred',
        name: provider === catalog ? 'Sorting Catalog' : 'Sorting Preferred',
        version: '1.0.0', types: ['movie'], resources: ['catalog', 'meta', 'stream'],
        catalogs: provider === catalog ? [{ id: 'films', type: 'movie', name: 'Sorting films' }] : []
      };
      else if (path.startsWith('/catalog/')) json = { metas: [movie] };
      else if (path.startsWith('/meta/')) json = { meta: movie };
      else if (path.startsWith('/stream/')) {
        streamRequests += 1;
        if (provider === preferred) await gate;
        json = { streams: provider === catalog ? firstStreams : [
          { name: '1080p BluRay preferred partial', url: 'https://media.test/preferred-partial.mp4' },
          { name: '1080p WEB-DL preferred full', url: 'https://media.test/preferred.mp4' }
        ] };
      }
      await route.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
    });
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Add an addon' }).click();
  const manager = page.getByRole('dialog', { name: 'Manage addons' });
  for (const provider of [catalog, preferred]) {
    await manager.getByLabel('Addon manifest URL').fill(`${provider}/manifest.json`);
    await manager.getByRole('button', { name: 'Install', exact: true }).first().click();
    await expect(manager.locator('.addon-management-card').getByText(provider === catalog ? 'Sorting Catalog' : 'Sorting Preferred', { exact: true })).toBeVisible();
  }
  const sortSwitch = page.getByRole('switch', { name: 'Sort streams by preference', exact: true });
  const autoSwitch = page.getByRole('switch', { name: 'Auto-select stream', exact: true });
  await expect(sortSwitch).not.toBeChecked();
  await expect(autoSwitch).not.toBeChecked();
  await manager.getByLabel('Preferred resolution', { exact: true }).selectOption('1080p');
  await manager.getByLabel('Preferred provider', { exact: true }).selectOption(`${preferred}/manifest.json`);
  await manager.getByRole('button', { name: 'WEB-DL', exact: true }).click();
  await sortSwitch.check();
  await page.reload();
  await expect(sortSwitch).toBeChecked();
  await expect(autoSwitch).not.toBeChecked();
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'View details for Sorting Film', exact: true }).first().click();
  await page.locator('.detail-play').click();
  const headings = page.locator('.stream-result-copy strong');
  try {
    await expect(headings).toHaveText(['1080p WEB-DL first', '1080p WEB-DL second', '720p WEB-DL partial', 'Unknown source']);
    await expect(page.locator('movi-player')).toHaveCount(0);
    release();
    await expect(headings).toHaveText(['1080p WEB-DL preferred full', '1080p WEB-DL first', '1080p WEB-DL second', '1080p BluRay preferred partial', '720p WEB-DL partial', 'Unknown source']);
    await expect(page.locator('.stream-match-badge')).toHaveCount(1);
    await expect(page.locator('.stream-result').first().locator('.stream-match-badge')).toHaveText('Matches preferences');
    await page.locator('.stream-provider-row').getByRole('button', { name: /^Sorting Catalog/ }).click();
    await expect(headings).toHaveText(['1080p WEB-DL first', '1080p WEB-DL second', '720p WEB-DL partial', 'Unknown source']);
    await page.locator('.stream-provider-row').getByRole('button', { name: /^All/ }).click();
    await expect(headings).toHaveCount(6);
    expect(streamRequests).toBe(2);
    const streamUrl = page.url();
    await page.goto('/#/settings/addons');
    await sortSwitch.uncheck();
    await expect(autoSwitch).not.toBeChecked();
    await page.goto(streamUrl);
    await expect(headings).toHaveText([...firstStreams.map((stream) => stream.name), '1080p BluRay preferred partial', '1080p WEB-DL preferred full']);
    await expect(page.locator('.stream-match-badge')).toHaveCount(0);
    await expect(page.locator('movi-player')).toHaveCount(0);
  } finally { release(); }
});
