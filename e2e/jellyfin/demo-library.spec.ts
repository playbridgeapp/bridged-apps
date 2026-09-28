import { test, expect } from '../fixtures';
import { chromeButton, enterDemoLibrary, openApp } from '../helpers/app';

test.describe('Jellyfin demo library — shows & login', () => {
  test('rejects an unreachable server URL on the login form', async ({ page }) => {
    await openApp(page);
    await page.getByLabel('Jellyfin Server URL').fill('http://127.0.0.1:1');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('.error-box')).toBeVisible({ timeout: 15_000 });
  });

  test('opens Shows and a series modal with seasons', async ({ page, isMobile }) => {
    await enterDemoLibrary(page);
    await chromeButton(page, isMobile, 'Shows').click();
    await expect(page.locator('.media-card').first()).toBeVisible();

    const seriesCard = page.locator('.media-card').filter({ hasText: /Series/i }).first();
    await expect(seriesCard).toBeVisible();
    await seriesCard.locator('.card-title').click();

    const modal = page.locator('.modal-backdrop .modal-container');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Cast Series Queue' })).toBeVisible();
    await expect(modal.getByRole('button', { name: /Play Ep 1/i })).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'Seasons & Episodes' })).toBeVisible();
    await expect(modal.locator('.episode-card').first()).toBeVisible();

    const seasonTabs = modal.locator('.season-tab');
    if ((await seasonTabs.count()) > 1) {
      await seasonTabs.nth(1).click();
      await expect(modal.locator('.episode-card').first()).toBeVisible();
    }
  });

  test('plays a demo episode in the expanded video overlay', async ({ page, isMobile }) => {
    await enterDemoLibrary(page);
    await chromeButton(page, isMobile, 'Shows').click();
    await page.locator('.media-card .card-title').first().click();
    await expect(page.locator('.modal-container')).toBeVisible();
    await page.getByRole('button', { name: /Play Ep 1/i }).click();
    await expect(page.locator('.player-overlay')).toBeVisible({ timeout: 20_000 });
    await page.getByTitle('Minimize to mini-player (keep browsing)').click();
    await expect(page.locator('.mini-player-bar')).toBeVisible();
  });

  test('demo home layout screenshot', async ({ page }) => {
    test.skip(!!process.env.CI, 'Screenshot baselines are darwin-only so far');
    await enterDemoLibrary(page);
    await expect(page).toHaveScreenshot('demo-home.png', {
      animations: 'disabled',
      caret: 'hide',
      mask: [page.locator('img')],
      maxDiffPixelRatio: 0.04
    });
  });
});
