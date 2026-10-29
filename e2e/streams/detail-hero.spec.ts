import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addon, fixture, showId } from './watching-fixture';

const busyBackdrop = readFileSync(join(__dirname, 'fixtures/bright-detail.svg'));

for (const width of [360, 393, 412, 1280]) {
  test(`bright detail artwork keeps compact accessible controls at the bottom at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('bridged-streams.stream-selection.v2', JSON.stringify({ mode: 'first', prefetchStreamsOnDetail: false })));
    await fixture(page);
    await page.route('https://bright-art.test/backdrop.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: busyBackdrop }));
    await page.route(`${addon}/meta/series/**`, (route) => route.fulfill({ json: { meta: {
      id: showId, type: 'series', name: 'Sunlit Adventure', background: 'https://bright-art.test/backdrop.svg',
      releaseInfo: '2021', genres: ['Drama', 'Fantasy', 'Magic', 'Fantasy World'], imdbRating: '8.2', runtime: '24min',
      description: 'Two friends explore a sunlit city filled with colourful buildings, crowded markets and unexpected discoveries. Their journey takes them far from home, where old friendships and new adventures change their lives forever.',
      videos: Array.from({ length: 6 }, (_, index) => ({ id: `${showId}:1:${index + 1}`, season: 1, episode: index + 1, title: `Episode ${index + 1}` }))
    } } }));
    await page.getByRole('button', { name: 'View details for Test Series', exact: true }).first().click();
    const primary = page.locator('.detail-play');
    await expect(primary).toHaveText('Resume S1·E4 · 10:00');
    await page.evaluate(async () => { await document.fonts.ready; const image = new Image(); image.src = 'https://bright-art.test/backdrop.svg'; await image.decode(); });
    const hero = page.locator('.detail-hero');
    const geometry = await hero.evaluate((node) => {
      const bounds = (element: Element) => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height }; };
      return { hero: bounds(node), intro: bounds(node.querySelector('.detail-intro')!), padding: parseFloat(getComputedStyle(node).paddingBottom),
        controls: [...node.querySelectorAll('.detail-actions button')].map((button) => ({ ...bounds(button), label: button.getAttribute('aria-label'), title: button.getAttribute('title'), background: getComputedStyle(button).backgroundColor, blur: getComputedStyle(button).backdropFilter })),
        scrim: getComputedStyle(node, '::after').backgroundImage, overflow: document.querySelector('.detail-panel')!.scrollWidth > innerWidth };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.intro.bottom).toBeCloseTo(geometry.hero.bottom - geometry.padding, 0);
    expect(geometry.intro.top - geometry.hero.top).toBeGreaterThan(geometry.hero.height * .4);
    expect(geometry.scrim).toContain('linear-gradient');
    expect(geometry.controls).toHaveLength(5);
    for (const [index, control] of geometry.controls.entries()) {
      expect(control.label).toBeTruthy(); expect(control.title).toBeTruthy();
      expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(width);
      // Buttons share a row even when the complete Resume label needs two lines.
      expect(control.top).toBeLessThan(geometry.controls[0].bottom);
      expect(control.bottom).toBeGreaterThan(geometry.controls[0].top);
      if (index > 0) {
        expect(control.width).toBe(44); expect(control.height).toBe(44);
        expect(control.background).toBe('rgba(0, 0, 0, 0.56)'); expect(control.blur).toContain('blur(');
      }
    }
    const choose = page.getByRole('button', { name: 'Choose stream', exact: true });
    await expect(choose).toHaveText('');
    await expect(choose.locator('svg')).toHaveCount(1);
    const destination = page.locator('.detail-intro .playback-destination');
    await expect(destination).toHaveText('Plays on this device');
    expect(await destination.locator(':scope > span').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0.56)');
    const seasonControls = page.locator('.season-watching-actions button');
    await expect(seasonControls).toHaveCount(2);
    const [watched, unwatched] = await Promise.all([seasonControls.nth(0).boundingBox(), seasonControls.nth(1).boundingBox()]);
    expect(watched!.y).toBeCloseTo(unwatched!.y, 0);
    expect(watched!.width).toBeCloseTo(unwatched!.width, 0);
    expect(watched!.height).toBeLessThanOrEqual(44);
    await page.screenshot({ path: `/private/tmp/streams-bright-hero-${width}.png` });
    if (width === 393) {
      await seasonControls.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: '/private/tmp/streams-bright-season-393.png' });
    }
    await choose.focus(); await expect(choose).toBeFocused();
    await choose.click(); await expect(page.locator('.stream-panel')).toBeVisible();
  });
}
