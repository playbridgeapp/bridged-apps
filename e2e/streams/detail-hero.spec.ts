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
    const label = primary.locator('.detail-play-label');
    const labelBox = await label.boundingBox();
    const labelLineHeight = await label.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
    expect(labelBox!.height).toBeLessThanOrEqual(labelLineHeight + 1);
    await expect(primary).toHaveAttribute('title', 'Resume S1·E4 · 10:00');
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
      // The primary label stays on one line, with ellipsis where space is limited.
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


for (const width of [393, 1280]) {
  for (const surface of ['ambient', 'art-only', 'panel-only'] as const) {
    test(`hero fades into ${surface} without a seam at ${width}px, including expanded text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 852 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await fixture(page);
      await page.route('https://bright-art.test/backdrop.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: busyBackdrop }));
      await page.route(`${addon}/meta/series/**`, (route) => route.fulfill({ json: { meta: {
        id: showId, type: 'series', name: 'Sunlit Adventure',
        ...(surface === 'panel-only' ? {} : { background: 'https://bright-art.test/backdrop.svg' }),
        description: 'A bright city and its busy markets bring two friends together for an unexpected adventure. '.repeat(14),
        videos: Array.from({ length: 6 }, (_, index) => ({ id: `${showId}:1:${index + 1}`, season: 1, episode: index + 1, title: `Episode ${index + 1}` }))
      } } }));
      await page.getByRole('button', { name: 'View details for Test Series', exact: true }).first().click();
      await expect(page.locator('.detail-play')).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);
      if (surface !== 'panel-only') await page.evaluate(async () => { const image = new Image(); image.src = 'https://bright-art.test/backdrop.svg'; await image.decode(); });
      if (surface !== 'ambient') {
        // A different panel tone makes accidental fixed-colour edges visible.
        await page.addStyleTag({ content: '.detail-ambient{display:none}.detail-panel{background:#243747}' });
      }
      for (const expanded of [false, true]) {
        if (expanded) await page.getByRole('button', { name: 'Read more', exact: true }).click();
        await page.locator('.detail-panel').evaluate((node) => {
          const hero = node.querySelector<HTMLElement>('.detail-hero')!;
          const pin = parseFloat(hero.style.getPropertyValue('--hero-pin')) || hero.getBoundingClientRect().height;
          node.scrollTo({ top: node.scrollTop + hero.getBoundingClientRect().top + pin - innerHeight / 2, behavior: 'instant' });
        });
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await page.screenshot({ path: `/private/tmp/streams-hero-blend-${width}-${surface}${expanded ? '-expanded' : ''}.png` });
        // Keep layout intact, but remove foreground text from the pixel comparison.
        const hidden = await page.addStyleTag({ content: '.detail-intro,.detail-facts-card,.detail-back{visibility:hidden}' });
        const boundary = await page.locator('.detail-hero').evaluate((node) => {
          const hero = node as HTMLElement;
          const pin = parseFloat(hero.style.getPropertyValue('--hero-pin')) || hero.getBoundingClientRect().height;
          return hero.getBoundingClientRect().top + pin;
        });
        const strip = await page.screenshot({ clip: { x: 0, y: Math.floor(boundary) - 4, width, height: 9 } });
        const difference = await page.evaluate(async (base64) => {
          const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
          const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
          const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
          let sum = 0, maximum = 0;
          // Compare the last complete artwork row to the first complete row below it.
          for (let x = 0; x < bitmap.width; x++) for (let channel = 0; channel < 3; channel++) {
            const delta = Math.abs(pixels[(3 * bitmap.width + x) * 4 + channel] - pixels[(5 * bitmap.width + x) * 4 + channel]);
            sum += delta; maximum = Math.max(maximum, delta);
          }
          bitmap.close(); return { mean: sum / (canvas.width * 3), maximum };
        }, strip.toString('base64'));
        await hidden.evaluate((node) => node.remove());
        expect(difference.mean).toBeLessThanOrEqual(3);
        expect(difference.maximum).toBeLessThanOrEqual(8);
      }
    });
  }
}
