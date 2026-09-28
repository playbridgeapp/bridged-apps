import { test, expect } from '../fixtures';
import { openApp } from '../helpers/app';
import { liveSessionFromEnv } from '../helpers/session';

test.describe('Jellyfin live login form', () => {
  test('pings the server URL and reaches the credentials step', async ({ page }) => {
    const url = process.env.JELLYFIN_URL?.replace(/\/+$/, '');
    test.skip(!url, 'Set JELLYFIN_URL to run live login tests');
    if (!url) return;

    await openApp(page);
    await page.getByLabel('Jellyfin Server URL').fill(url);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByLabel('Username')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.error-box')).toHaveCount(0);

    const password = process.env.JELLYFIN_PASSWORD;
    const username = process.env.JELLYFIN_USERNAME;
    const session = liveSessionFromEnv();
    if (!password || !username) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'JELLYFIN_PASSWORD not set; stopped after server ping'
      });
      return;
    }

    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /Sign In to Jellyfin/i }).click();
    await expect(page.locator('.brand-name')).toHaveText('PlayBridge', { timeout: 20_000 });
    if (session?.serverName) {
      await expect(page.locator('.library-tile-card, .media-card').first()).toBeVisible({
        timeout: 20_000
      });
    }
  });
});
