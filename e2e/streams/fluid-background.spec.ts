import { expect, test, type Page } from '@playwright/test';

async function drawState(page: Page) {
  return page.evaluate(() => (window as any).__bridgedTest.fluid as { draws: number; pixel: number[] });
}

async function expectPainted(page: Page) {
  const { pixel } = await drawState(page);
  expect(pixel.slice(0, 3).some((channel) => channel > 0)).toBe(true);
}

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.addInitScript(() => {
    // Inspect actual WebGL renders immediately, before the compositor can discard
    // the drawing buffer. No account, addon or native bridge fixtures are needed.
    const hooks = (window as any).__bridgedTest ||= {};
    hooks.fluid = { draws: 0, pixel: [] };
    const originalDraw = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      originalDraw.apply(this, args);
      if (!(this.canvas instanceof HTMLCanvasElement) || !this.canvas.closest('.fluid-bg')) return;
      hooks.fluid.draws++;
      const pixel = new Uint8Array(4);
      this.readPixels(Math.floor(this.drawingBufferWidth / 2), Math.floor(this.drawingBufferHeight / 2),
        1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
      hooks.fluid.pixel = [...pixel];
    };
  });
  await page.goto('/#/settings');
  await expect(page.locator('.fluid-bg canvas')).toBeVisible();
  await expect.poll(async () => (await drawState(page)).draws).toBeGreaterThan(0);
});

test('redraws a static reduced-motion background after rotation without starting an animation', async ({ page }) => {
  await page.clock.runFor(200);
  await expectPainted(page);
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
    const before = (await drawState(page)).draws;
    await page.setViewportSize(viewport);
    await expect.poll(async () => (await drawState(page)).draws).toBeGreaterThan(before);
    await expectPainted(page);
    const after = (await drawState(page)).draws;
    await page.clock.runFor(200);
    expect((await drawState(page)).draws).toBe(after);
  }
});

test('starts and stops animation when the reduced-motion preference changes', async ({ page }) => {
  const initial = (await drawState(page)).draws;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => (await drawState(page)).draws).toBeGreaterThan(initial + 1);

  const animated = (await drawState(page)).draws;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await drawState(page)).draws).toBeGreaterThan(animated);
  await page.clock.runFor(200);
  await expectPainted(page);
  const stopped = (await drawState(page)).draws;
  await page.clock.runFor(200);
  expect((await drawState(page)).draws).toBe(stopped);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => (await drawState(page)).draws).toBeGreaterThan(stopped + 1);
});

test('cleans up animation and listeners when leaving the background tabs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.runFor(200);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.fluid-bg')).toHaveCount(0);
  const stopped = (await drawState(page)).draws;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.clock.runFor(200);
  expect((await drawState(page)).draws).toBe(stopped);

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.fluid-bg canvas')).toBeVisible();
  await expect.poll(async () => (await drawState(page)).draws).toBeGreaterThan(stopped);
  await expectPainted(page);
});
