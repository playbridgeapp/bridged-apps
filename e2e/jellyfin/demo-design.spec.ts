import { test, expect } from '../fixtures';
import { enterDemoLibrary, openApp, readThemeTokens } from '../helpers/app';

test.describe('Jellyfin demo library', () => {
  test('shows the login screen', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('button', { name: /Explore with Demo Library/i })).toBeVisible();
    await expect(page.getByLabel('Jellyfin Server URL')).toBeVisible();
  });

  test('loads the demo home with media cards', async ({ page }) => {
    await enterDemoLibrary(page);
    await expect(page.locator('.brand-sub')).toContainText(/Jellyfin/i);
    expect(await page.locator('.media-card').count()).toBeGreaterThan(0);
  });

  test('opens and closes an item detail modal', async ({ page }) => {
    await enterDemoLibrary(page);
    await page.locator('.hero-banner .action-details').click();
    await expect(page.locator('.modal-backdrop .modal-container')).toBeVisible();
    await expect(page.locator('.item-title')).not.toBeEmpty();
    await page.getByRole('button', { name: 'Close modal' }).click();
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);

    // Card center is the play overlay; the title still opens details.
    await page.locator('.media-card .card-title').first().click();
    await expect(page.locator('.modal-backdrop .modal-container')).toBeVisible();
    await page.getByRole('button', { name: 'Close modal' }).click();
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  });

  test('navigates to Movies from the chrome', async ({ page, isMobile }) => {
    await enterDemoLibrary(page);
    if (isMobile) {
      await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Movies' }).click();
    } else {
      await page.locator('.nav-links').getByRole('button', { name: 'Movies' }).click();
    }
    await expect(page.locator('.media-card').first()).toBeVisible();
  });

  test('exposes design tokens and the correct chrome for the viewport', async ({ page, isMobile }) => {
    await enterDemoLibrary(page);
    const tokens = await readThemeTokens(page);
    expect(tokens.primaryAccent.toLowerCase()).toBe('#95ff50');
    expect(tokens.bgBase.toLowerCase()).toBe('#050505');
    expect(tokens.bgSurface.toLowerCase()).toBe('#1d1728');

    const bottomNav = page.locator('.mobile-bottom-nav');
    if (isMobile) {
      await expect(bottomNav).toBeVisible();
    } else {
      await expect(bottomNav).toBeHidden();
      await expect(page.locator('.nav-links')).toBeVisible();
    }
  });
});
