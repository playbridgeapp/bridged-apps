import { expect, test } from '@playwright/test';
import { fixture, browserPlayer, report, addon, showId } from './watching-fixture';
test.use({ reducedMotion: 'reduce' });

test('loads only the chosen addon subtitle and renders safely inside the Movi fullscreen host', async ({ page }) => {
  const state = await fixture(page, { subtitles: true });
  const player = await browserPlayer(page);
  const selection = player.getByRole('combobox', { name: 'Addon subtitles' });
  await expect(selection).toBeEnabled();
  await expect(selection.locator('option')).toHaveCount(3);
  expect(state.subtitleRequests).toEqual([`/subtitles/series/${showId}:1:4.json`]);
  expect(state.fileRequests).toHaveLength(0);
  await selection.selectOption({ label: 'eng · Watching Catalog' });
  await expect(selection).toHaveValue(/english\.srt/);
  await report(page, 2, 'timeupdate');
  const caption = player.locator('[data-addon-caption]');
  await expect(caption).toHaveText('Hello world');
  await expect(caption).toBeVisible();
  expect(await caption.evaluate((node) => node.getRootNode() instanceof ShadowRoot && (node.getRootNode() as ShadowRoot).host.tagName === 'MOVI-PLAYER')).toBe(true);
  await report(page, 11, 'timeupdate'); await expect(caption).toHaveText('After seeking');
  await report(page, 2, 'timeupdate'); await expect(caption).toHaveText('Hello world');
  expect(state.fileRequests).toEqual(['https://watching-subs.test/english.srt']);
  await selection.selectOption(''); await expect(caption).toHaveCount(0);
});

test('native browser fallback receives an owned VTT track, cleans it up on Off, and reports file failures', async ({ page }) => {
  const state = await fixture(page, { subtitles: true, native: true });
  const player = await browserPlayer(page);
  await expect(player.locator('video')).toHaveCount(1);
  const selection = player.getByRole('combobox', { name: 'Addon subtitles' });
  await expect(selection.locator('option')).toHaveCount(3);
  state.failSubtitle = true;
  await selection.selectOption({ label: 'eng · Watching Catalog' });
  await expect(player.locator('.addon-subtitles').getByRole('alert')).toContainText('Subtitle returned HTTP 503');
  state.failSubtitle = false;
  await selection.selectOption({ label: 'eng · Watching Catalog' });
  await expect(player.locator('video > track')).toHaveCount(1);
  const source = await player.locator('video > track').getAttribute('src');
  expect(source).toMatch(/^blob:/);
  const vtt = await page.evaluate(async (url) => (await fetch(url!)).text(), source);
  expect(vtt).toContain('WEBVTT'); expect(vtt).toContain('Hello world');
  await selection.selectOption(''); await expect(player.locator('video > track')).toHaveCount(0);
  expect(await page.evaluate(async (url) => { try { await fetch(url!); return false; } catch { return true; } }, source)).toBe(true);
});

test('a new episode clears selected subtitles and requests the next episode identifier', async ({ page }) => {
  const state = await fixture(page, { subtitles: true });
  const player = await browserPlayer(page);
  const selection = player.getByRole('combobox', { name: 'Addon subtitles' });
  await expect(selection.locator('option')).toHaveCount(3);
  await selection.selectOption({ label: 'eng · Watching Catalog' });
  await expect(selection).toHaveValue(/english/);
  await report(page, 2950, 'ended');
  await expect.poll(() => state.subtitleRequests.length).toBe(2);
  expect(state.subtitleRequests[1]).toBe(`/subtitles/series/${showId}:1:5.json`);
  await expect(selection).toHaveValue('');
  await expect(player.locator('[data-addon-caption]')).toHaveCount(0);
});

test('disabled subtitle resources are not requested', async ({ page }) => {
  await page.addInitScript((url) => {
    localStorage.setItem('bridged-streams.addon-settings.v1', JSON.stringify({ [`nuvio:https://watching-cloud.test:viewer:2:${url}/manifest.json`]: { disabledFeatures: ['subtitles'] } }));
  }, addon);
  const state = await fixture(page, { subtitles: true });
  const player = await browserPlayer(page);
  await expect(player.getByText('No addon subtitles available.')).toBeVisible();
  expect(state.subtitleRequests).toHaveLength(0); expect(state.fileRequests).toHaveLength(0);
});


test('hands selected captions to a native text track when Movi switches engines', async ({ page }) => {
  await fixture(page, { subtitles: true });
  const player = await browserPlayer(page);
  const selection = player.getByRole('combobox', { name: 'Addon subtitles' });
  await expect(selection.locator('option')).toHaveCount(3);
  await selection.selectOption({ label: 'eng · Watching Catalog' });
  await expect(selection).toHaveValue(/english/);
  await player.locator('movi-player').evaluate((element) => {
    const video = element.shadowRoot!.querySelector('video')!;
    video.style.display = 'block';
    element.dispatchEvent(new CustomEvent('nativefallback'));
  });
  await expect(player.locator('movi-player video > track')).toHaveCount(1);
  await expect(player.locator('[data-addon-caption]')).toBeHidden();
  const source = await player.locator('movi-player video > track').getAttribute('src');
  expect(await page.evaluate(async (url) => (await fetch(url!)).text(), source)).toContain('Hello world');
  await selection.selectOption('');
  await expect(player.locator('movi-player video > track')).toHaveCount(0);
  await expect(player.locator('[data-addon-caption]')).toHaveCount(0);
  // Selecting after a handoff also goes straight to a native track.
  await selection.selectOption({ label: 'spa · Watching Catalog' });
  await expect(player.locator('movi-player video > track')).toHaveCount(1);
});
