import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, point, addon } from './watching-fixture';

const mediaFixtures = {
  mp4: readFileSync(join(__dirname, 'fixtures/resume.mp4')),
  mkv: readFileSync(join(__dirname, 'fixtures/resume.mkv'))
};

async function resumeFixture(page: Page, format: keyof typeof mediaFixtures, native = false) {
  await page.addInitScript(() => {
    const hook = (window as any).__bridgedTest ||= {};
    hook.resumeEvents = [];
    for (const type of ['loadedmetadata', 'playing', 'seeked']) {
      window.addEventListener(type, (event) => {
        const media = event.target as HTMLMediaElement;
        if (media.tagName === 'MOVI-PLAYER') hook.resumeEvents.push({ type, time: media.currentTime });
      }, true);
    }
  });
  const state = await fixture(page, { movie: true, native, progress: [
    { ...point(), position: 94250, duration: 130000 },
    { progress_key: 'tt-movie', content_id: 'tt-movie', content_type: 'movie', video_id: 'tt-movie',
      position: 52345, duration: 130000, last_watched: 1700000000001 }
  ] });
  const body = mediaFixtures[format];
  await page.route('https://watching-media.test/**', (route) => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range ? Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1) : body.length - 1;
    const headers: Record<string, string> = {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'Content-Length,Content-Range,Accept-Ranges',
      'accept-ranges': 'bytes',
      'content-type': format === 'mp4' ? 'video/mp4' : 'video/x-matroska',
      'content-length': String(end - start + 1)
    };
    if (range) headers['content-range'] = `bytes ${start}-${end}/${body.length}`;
    return route.fulfill({ status: range ? 206 : 200, headers, body: body.subarray(start, end + 1) });
  });
  await page.route(`${addon}/stream/**`, (route) => route.fulfill({ json: {
    streams: [{ name: 'Resume fixture', url: `https://watching-media.test/resume.${format}` }]
  } }));
  return state;
}

async function openPlayer(page: Page, title: string) {
  await page.getByRole('button', { name: `View details for ${title}`, exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: `Streams for ${title}` })).toBeVisible();
  await page.locator('.stream-result .watch-button').click();
  await expect(page.getByRole('dialog', { name: `Now playing ${title}` })).toBeVisible();
  return page.locator('.player-stage > movi-player, .player-stage > video');
}

for (const format of ['mp4', 'mkv'] as const) {
  for (const kind of ['movie', 'series'] as const) {
    test(`real MoviPlayer resumes ${kind} ${format} at the saved time without reloading`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const state = await resumeFixture(page, format);
      const expectedSeconds = kind === 'movie' ? 52.345 : 94.25;
      const player = await openPlayer(page, kind === 'movie' ? 'Test Movie' : 'Test Series');
      await expect.poll(() => player.evaluate((node, target) => {
        const media = node as HTMLMediaElement;
        return !media.seeking && media.currentTime >= target - .2 && media.currentTime < target + 5;
      }, expectedSeconds), { timeout: 15_000 }).toBe(true);
      // The fixture is red at zero, green at the movie's position, blue at the episode's.
      await expect.poll(async () => {
        const bounds = await player.locator('canvas').first().boundingBox();
        if (!bounds) return 'no canvas';
        // Read the composited frame: a non-preserved WebGL drawing buffer can
        // appear transparent to drawImage between renders despite visible video.
        const screenshot = await page.screenshot({ clip: {
          x: Math.floor(bounds.x + bounds.width / 2), y: Math.floor(bounds.y + bounds.height / 2), width: 1, height: 1
        } });
        const pixel = await page.evaluate(async (bytes) => {
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
          try {
            const image = new Image(); image.src = url; await image.decode();
            const copy = document.createElement('canvas'); copy.width = copy.height = 1;
            const context = copy.getContext('2d')!; context.drawImage(image, 0, 0);
            return [...context.getImageData(0, 0, 1, 1).data];
          } finally { URL.revokeObjectURL(url); }
        }, [...screenshot]);
        const channel = kind === 'movie' ? 1 : 2;
        return pixel[channel] > 150 && pixel[0] < 40 && pixel[channel === 1 ? 2 : 1] < 40 && pixel[3] === 255
          ? 'resumed frame' : `rgba(${pixel.join(',')})`;
      }).toBe('resumed frame');
      expect(await player.evaluate((node) => !!(node as any)._nativeFallbackActive)).toBe(false);
      await player.evaluate((node) => (node as HTMLMediaElement).pause());
      const contentId = kind === 'movie' ? 'tt-movie' : 'tt-watching';
      await expect.poll(() => state.writes.filter((write) => write.method === 'sync_push_watch_progress')
        .flatMap((write) => write.body.p_entries).filter((entry) => entry.content_id === contentId).length).toBeGreaterThan(0);
      const entries = state.writes.filter((write) => write.method === 'sync_push_watch_progress')
        .flatMap((write) => write.body.p_entries).filter((entry) => entry.content_id === contentId);
      expect(entries.every((entry) => entry.position >= expectedSeconds * 1000 - 500)).toBe(true);
      expect(await page.evaluate(() => (window as any).__bridgedTest.resumeEvents
        .filter((event: { type: string }) => event.type === 'loadedmetadata').length)).toBe(1);
      expect(errors).toEqual([]);
    });
  }
}

test('a new episode using the same URL starts independently after real EOF', async ({ page }) => {
  await resumeFixture(page, 'mp4');
  const player = await openPlayer(page, 'Test Series');
  await expect.poll(() => player.evaluate((node) => {
    const media = node as HTMLMediaElement;
    return !media.seeking && media.currentTime > 94 && media.currentTime < 99;
  })).toBe(true);
  const previousPlayer = await player.elementHandle();
  await player.evaluate((node) => { (node as HTMLMediaElement).currentTime = 128; });
  await expect(page.locator('.player-title')).toContainText('S1 E5', { timeout: 15_000 });
  await expect.poll(() => player.evaluate((node) => {
    const media = node as HTMLMediaElement;
    return media.currentTime > 0 && media.currentTime < 5 && !media.seeking;
  })).toBe(true);
  expect(await page.evaluate(() => (window as any).__bridgedTest.resumeEvents
    .filter((event: { type: string }) => event.type === 'loadedmetadata').length)).toBe(2);
  await previousPlayer!.evaluate((node) => node.dispatchEvent(new Event('ended')));
  await expect(page.locator('.player-title')).toContainText('S1 E5');
});

for (const kind of ['movie', 'series'] as const) {
  test(`browser video fallback resumes ${kind} after the Movi import fails`, async ({ page }) => {
    await resumeFixture(page, 'mp4', true);
    const target = kind === 'movie' ? 52.345 : 94.25;
    const player = await openPlayer(page, kind === 'movie' ? 'Test Movie' : 'Test Series');
    await expect(player).toHaveJSProperty('tagName', 'VIDEO');
    await expect.poll(() => player.evaluate((node, seconds) => {
      const media = node as HTMLVideoElement;
      return !media.seeking && media.currentTime >= seconds - .2 && media.currentTime < seconds + 5;
    }, target)).toBe(true);
    const frameTime = await player.evaluate((node) => new Promise<number>((resolve) => {
      (node as HTMLVideoElement).requestVideoFrameCallback((_now, metadata) => resolve(metadata.mediaTime));
    }));
    expect(frameTime).toBeGreaterThanOrEqual(target - .2);
    expect(frameTime).toBeLessThan(target + 5);
  });
}
