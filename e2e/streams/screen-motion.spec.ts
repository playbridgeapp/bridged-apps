import { expect, test, type Page } from '@playwright/test';

async function finishMotion(page: Page) {
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
}

async function sampleMotion(page: Page, selector: string) {
  return page.evaluate(async (selector) => {
    for (let frame = 0; frame < 30; frame++) {
      await new Promise(requestAnimationFrame);
      const surface = document.querySelector(selector)!;
      const animations = surface.getAnimations();
      if (!animations.length) continue;
      document.getAnimations().forEach((animation) => {
        animation.pause();
        const timing = animation.effect!.getTiming();
        animation.currentTime = timing.delay + Number(timing.duration) / 2;
      });
      const style = getComputedStyle(surface);
      return { x: new DOMMatrixReadOnly(style.transform).m41, opacity: style.opacity,
        zIndex: Number(style.zIndex), top: document.elementFromPoint(innerWidth - 5, 150)?.closest(selector) === surface };
    }
    throw new Error(`No screen animation for ${selector}`);
  }, selector);
}

for (const width of [390, 1280]) {
  test(`stack surfaces stay opaque and ordered during push and back at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const addon = 'https://motion.test';
    const movie = { id: 'tt-motion', type: 'movie', name: 'Motion Film' };
    await page.addInitScript((addon) => {
      localStorage.setItem('bridged-streams.addons.v1', JSON.stringify([`${addon}/manifest.json`]));
    }, addon);
    await page.route(`${addon}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path === '/manifest.json'
        ? { id: 'motion', name: 'Motion', version: '1.0.0', types: ['movie'], resources: ['catalog', 'meta', 'stream'],
          catalogs: [{ id: 'films', type: 'movie', name: 'Films' }] }
        : path.startsWith('/meta/') ? { meta: movie } : path.startsWith('/stream/') ? { streams: [] } : { metas: [movie] } });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'View details for Motion Film', exact: true }).first().click();
    const detail = await sampleMotion(page, '.detail-overlay');
    expect(detail.x).toBeGreaterThan(0);
    expect(detail.opacity).toBe('1');
    expect(detail.top).toBe(true);
    await finishMotion(page);
    await expect(page.locator('.detail-play')).toBeEnabled();
    await page.locator('.detail-play').click();
    const streams = await sampleMotion(page, '.stream-overlay');
    expect(streams.x).toBeGreaterThan(0);
    expect(streams.opacity).toBe('1');
    expect(streams.top).toBe(true);
    await finishMotion(page);
    await expect(page.locator('.detail-overlay')).toHaveCount(0);
    await page.locator('.stream-back').click();
    const back = await sampleMotion(page, '.stream-overlay');
    expect(back.x).toBeGreaterThan(0);
    expect(back.opacity).toBe('1');
    expect(back.zIndex).toBeGreaterThan(await page.locator('.detail-overlay').evaluate((node) => Number(getComputedStyle(node).zIndex)));
    expect(await page.locator('.detail-overlay').evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41)).toBeLessThan(0);
    await finishMotion(page);
    await expect(page.locator('.stream-overlay')).toHaveCount(0);
    await page.locator('.detail-back').click();
    await sampleMotion(page, '.detail-overlay');
    await finishMotion(page);
    await expect(page.locator('.detail-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: 'View all Films from Motion' }).click();
    await sampleMotion(page, '.catalog-page-overlay');
    await finishMotion(page);
    await page.locator('.catalog-page-grid .media-card').first().click();
    expect((await sampleMotion(page, '.detail-overlay')).top).toBe(true);
    await finishMotion(page);
    await page.locator('.detail-back').click();
    const catalogBack = await sampleMotion(page, '.detail-overlay');
    expect(catalogBack.zIndex).toBeGreaterThan(await page.locator('.catalog-page-overlay').evaluate((node) => Number(getComputedStyle(node).zIndex)));
    await finishMotion(page);
    await expect(page.locator('.detail-overlay')).toHaveCount(0);
    await expect(page.locator('.catalog-page-overlay')).toBeVisible();
    await page.locator('.catalog-page-back').click();
    await sampleMotion(page, '.catalog-page-overlay');
    await finishMotion(page);
    await expect(page.locator('.catalog-page-overlay')).toHaveCount(0);
  });
}
