import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { chromeButton } from '../helpers/app';
import { fixture, movie, episodes, series } from './playback-fixture';

async function bridgeState(page: Page) {
  return page.evaluate(() => {
    const state = (window as any).__jellyfinBridge;
    return { calls: state.calls, supplies: state.supplies, unlinks: state.unlinks, jumps: state.jumps };
  });
}
async function emit(page: Page, type: string, detail: Record<string, unknown>) {
  await page.evaluate(({ type, detail }) => (window as any).__jellyfinBridge.sessions.at(-1).emit(type, detail), { type, detail });
}

test('normal browser is Play/Resume first and does not pretend to cast', async ({ page }) => {
  await fixture(page);
  await expect(page.locator('.hero-banner .action-play')).toHaveText('Resume');
  await expect(page.locator('.action-cast, .overlay-cast, .mobile-cast-btn')).toHaveCount(0);
  await page.locator('.action-details').click();
  await expect(page.locator('.modal-container').getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Direct Cast', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.playbridge)).toBeUndefined();
});

test('This device defaults to browser playback even with a modern bridge', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern', nativeVideo: true });
  await expect(page.getByLabel('This device player', { exact: true })).toHaveValue('browser');
  await page.locator('.action-play').click();
  const player = page.locator('.native-video-el');
  await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(52);
  expect((await bridgeState(page)).calls).toHaveLength(0);
  expect(state.requests.find(r => r.path.endsWith('/PlaybackInfo'))!.body.DeviceProfile.Name).toBe('PlayBridge browser');
});

const songs = Array.from({ length: 3 }, (_, i) => ({ Id: `song-${i + 1}`, Name: `Song ${i + 1}`,
  Type: 'Audio', Container: 'm4a', RunTimeTicks: 300000000, UserData: { PlaybackPositionTicks: 0 } }));

async function startAudioQueue(page: Page, queue = songs) {
  await page.evaluate(async queue => (window as any).__bridgedTest.playMedia(queue[0], queue, 0), queue);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('audio')].some(node => !node.paused && node.currentTime > 0.2))).toBe(true);
  await page.evaluate(() => {
    const hooks = (window as any).__bridgedTest;
    hooks.audioTrace = [];
    hooks.activePlayer.subscribe((state: any) => hooks.audioTrace.push({ open: state.isOpen, index: state.currentIndex, expanded: state.isExpanded }));
  });
}

for (const expanded of [false, true]) {
  test(`browser Next keeps the ${expanded ? 'expanded' : 'mini'} player mounted and reuses buffered audio`, async ({ page }) => {
    const state = await fixture(page);
    await startAudioQueue(page);
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('audio')].some(node => node.src.includes('/Audio/song-2/') && node.readyState >= 2))).toBe(true);
    await page.evaluate(() => {
      [...document.querySelectorAll('audio')].find(node => node.src.includes('/Audio/song-2/'))!.dataset.preloaded = 'yes';
    });
    if (expanded) await page.locator('.mini-left').click();
    const chrome = page.locator(expanded ? '.player-overlay' : '.mini-player-bar');
    const original = await chrome.elementHandle();
    await chrome.getByTitle('Next track', { exact: true }).click();
    await expect(page.locator(expanded ? '.playing-title' : '.mini-title')).toHaveText('Song 2');
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('audio')].some(node => node.dataset.preloaded === 'yes' && !node.paused && node.currentTime > 0.2))).toBe(true);
    expect(await original!.evaluate(node => node.isConnected)).toBe(true);
    expect(await page.evaluate(() => (window as any).__bridgedTest.audioTrace.every((s: any) => s.open))).toBe(true);
    expect(state.requests.filter(r => r.path === '/Items/song-2/PlaybackInfo')).toHaveLength(1);
    await expect.poll(() => state.requests.filter(r => r.path === '/Sessions/Playing/Stopped' && r.body.ItemId === 'song-1').length).toBe(1);
    await expect.poll(() => state.requests.filter(r => r.path === '/Sessions/Playing' && r.body.ItemId === 'song-2').length).toBe(1);
  });
}

test('bridged This device audio and Next stay in the browser by default', async ({ page }) => {
  await fixture(page, { bridge: 'modern' });
  await startAudioQueue(page);
  await page.getByTitle('Next track', { exact: true }).click();
  await expect(page.locator('.mini-title')).toHaveText('Song 2');
  expect((await bridgeState(page)).calls).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('audio')].some(node => !node.paused && node.src.includes('/Audio/song-2/')))).toBe(true);
});

test('browser-default This device rejects a destination change during preparation', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern' });
  let release!: () => void;
  state.holdPreparation = new Promise<void>(resolve => { release = resolve; });
  await page.locator('.action-play').click();
  await expect.poll(() => state.requests.filter(r => r.path.endsWith('/PlaybackInfo')).length).toBe(1);
  await page.evaluate(() => { (window as any).__jellyfinBridge.destination = { id: 'living-room', name: 'TV', kind: 'native', connected: true }; });
  release();
  await expect(page.locator('.destination-row [role="alert"]')).toContainText('changed or disconnected');
  await expect(page.locator('.mini-player-bar, .player-overlay')).toHaveCount(0);
  expect((await bridgeState(page)).calls).toHaveLength(0);
});

test('a mixed browser queue switches from audio to video without leaving audio playing', async ({ page }) => {
  await fixture(page, { nativeVideo: true });
  await startAudioQueue(page, [songs[0], movie]);
  await page.getByTitle('Next track', { exact: true }).click();
  await expect(page.locator('.playing-title')).toHaveText('Fixture Movie');
  const player = page.locator('.native-video-el');
  await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(52);
  expect(await page.evaluate(() => [...document.querySelectorAll('audio')].every(node => node.paused))).toBe(true);
});

test('audio EOF advances without closing the player', async ({ page }) => {
  await fixture(page);
  await startAudioQueue(page);
  const original = await page.locator('.mini-player-bar').elementHandle();
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('audio')].some(node => node.src.includes('/Audio/song-2/') && node.readyState >= 2))).toBe(true);
  await page.evaluate(() => { [...document.querySelectorAll('audio')].find(node => !node.paused)!.currentTime = 29; });
  await expect(page.locator('.mini-title')).toHaveText('Song 2', { timeout: 10000 });
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  expect(await page.evaluate(() => (window as any).__bridgedTest.audioTrace.every((s: any) => s.open))).toBe(true);
});

test('failed next-track preparation keeps current audio and UI alive and remains retryable', async ({ page }) => {
  const state = await fixture(page);
  state.failPreparationIds.add('song-2');
  await startAudioQueue(page);
  await expect.poll(() => state.requests.filter(r => r.path === '/Items/song-2/PlaybackInfo').length).toBe(1);
  await page.getByTitle('Next track', { exact: true }).click();
  await expect(page.locator('.destination-row [role="alert"]')).toContainText('preparation failed');
  await expect(page.locator('.mini-title')).toHaveText('Song 1');
  expect(await page.evaluate(() => [...document.querySelectorAll('audio')].some(node => !node.paused))).toBe(true);
  expect(state.requests.filter(r => r.path === '/Sessions/Playing/Stopped')).toHaveLength(0);
  state.failPreparationIds.delete('song-2');
  await page.getByTitle('Next track', { exact: true }).click();
  await expect(page.locator('.mini-title')).toHaveText('Song 2');
  expect(await page.evaluate(() => (window as any).__bridgedTest.audioTrace.every((s: any) => s.open))).toBe(true);
});

test('closing the browser player cancels a pending buffered queue transition', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/Items/song-2/PlaybackInfo', async route => { await hold; await route.fallback(); });
  const demanded = page.waitForRequest('**/Items/song-2/PlaybackInfo');
  await startAudioQueue(page);
  await demanded;
  await page.getByTitle('Next track', { exact: true }).click();
  await page.getByTitle('Stop & close', { exact: true }).click();
  const response = page.waitForResponse('**/Items/song-2/PlaybackInfo');
  release(); await response;
  await expect(page.locator('.mini-player-bar, .player-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => [...document.querySelectorAll('audio')].every(node => node.paused && !node.getAttribute('src')))).toBe(true);
});

test('duplicate audio URLs reset playback while keeping player chrome mounted', async ({ page }) => {
  await fixture(page);
  const queue = songs.slice(0, 2).map((song, i) => ({ ...song, streamUrl: 'https://jellyfin.test/base/Audio/shared/stream',
    UserData: { PlaybackPositionTicks: i ? 0 : 100000000 } }));
  await startAudioQueue(page, queue);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('audio')].some(node => !node.paused && node.currentTime > 10))).toBe(true);
  const original = await page.locator('.mini-player-bar').elementHandle();
  await page.getByTitle('Next track', { exact: true }).click();
  await expect(page.locator('.mini-title')).toHaveText('Song 2');
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('audio')].some(node => !node.paused && node.currentTime < 3))).toBe(true);
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
});

test('Play uses the explicit native This device destination with resume metadata', async ({ page }) => {
  await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  await expect(page.getByRole('button', { name: 'Change playback destination' })).toHaveText('Plays on This device');
  await page.locator('.action-play').click();
  await expect(page.locator('.mini-player-bar')).toBeVisible();
  const state = await bridgeState(page);
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0].destinationId).toBe('this-device');
  expect(state.calls[0].startIndex).toBe(0);
  expect(state.calls[0].items[0]).toMatchObject({ id: movie.Id, startPositionMs: 52345, contentType: 'video/mp4' });
  await expect(page.locator('movi-player, video')).toHaveCount(0);
  expect(await page.evaluate(() => window.playbridge)).toBeUndefined();
});

test('terminal session replay during opening cannot resurrect native player UI', async ({ page }) => {
  await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  await page.evaluate(() => { (window as any).__jellyfinBridge.endOnListen = true; });
  await page.locator('.action-play').click();
  await expect.poll(async () => (await bridgeState(page)).calls.length).toBe(1);
  await expect(page.locator('.mini-player-bar, .player-overlay')).toHaveCount(0);
});

test('the existing native picker selects another receiver', async ({ page }) => {
  await fixture(page, { bridge: 'modern' });
  await page.getByRole('button', { name: 'Change playback destination' }).click();
  await expect(page.getByRole('button', { name: 'Change playback destination' })).toHaveText('Plays on Living room TV');
  await page.locator('.action-play').click();
  await expect.poll(async () => (await bridgeState(page)).calls.length).toBe(1);
  expect((await bridgeState(page)).calls[0].destinationId).toBe('living-room');
});

test('a destination change during stream preparation cannot silently play elsewhere', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  let release!: () => void;
  state.holdPreparation = new Promise<void>(resolve => { release = resolve; });
  await page.locator('.action-play').click();
  await expect.poll(() => state.requests.filter(r => r.path.endsWith('/PlaybackInfo')).length).toBe(1);
  await page.evaluate(() => { (window as any).__jellyfinBridge.destination = { id: 'living-room', name: 'TV', kind: 'native', connected: true }; });
  release();
  await expect(page.locator('.destination-row [role="alert"]')).toBeVisible();
  await expect(page.locator('.mini-player-bar, .player-overlay')).toHaveCount(0);
  const calls = (await bridgeState(page)).calls;
  expect(calls).toHaveLength(1);
  expect(calls[0].destinationId).toBe('this-device');
  await page.getByRole('button', { name: 'Choose This device', exact: true }).click();
  await page.locator('.action-play').click();
  await expect(page.locator('.mini-player-bar')).toBeVisible();
});

test('a failed native start offers explicit browser recovery without silently changing destination', async ({ page }) => {
  await fixture(page, { bridge: 'modern', localPlayer: 'native', nativeVideo: true });
  await page.evaluate(() => { (window as any).__jellyfinBridge.fail = true; });
  await page.locator('.action-play').click();
  await expect(page.getByRole('button', { name: 'Play in browser', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play in browser', exact: true }).click();
  const player = page.locator('.native-video-el');
  await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(52);
  expect((await bridgeState(page)).calls).toHaveLength(1);
});

test('linked playback reports real progress, fences late events and unlinks on logout', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  await page.locator('.action-play').click();
  await expect(page.locator('.mini-player-bar')).toBeVisible();
  // Initial zero position must not overwrite the resume point.
  await emit(page, 'statechange', { state: 'playing', currentIndex: 0, positionMs: 0, durationMs: 130000 });
  expect(state.requests.filter(r => r.path.startsWith('/Sessions/Playing'))).toHaveLength(0);
  await emit(page, 'statechange', { state: 'playing', currentIndex: 0, positionMs: 55000, durationMs: 130000 });
  await emit(page, 'statechange', { state: 'paused', currentIndex: 0, positionMs: 56000, durationMs: 130000 });
  await expect.poll(() => state.requests.filter(r => r.path === '/Sessions/Playing/Progress').length).toBeGreaterThan(0);
  await expect(page.locator('.mini-play-btn')).toBeDisabled();
  await page.evaluate(() => (window as any).__bridgedTest.logout());
  await expect.poll(async () => (await bridgeState(page)).unlinks).toBe(1);
  await expect.poll(() => state.requests.filter(r => r.path === '/Sessions/Playing/Stopped').length).toBe(1);
  const stop = state.requests.find(r => r.path === '/Sessions/Playing/Stopped')!;
  expect(stop.body).toMatchObject({ ItemId: 'movie', MediaSourceId: 'source-movie', PlaySessionId: 'play-movie', PositionTicks: 560000000 });
  const count = state.requests.length;
  await emit(page, 'statechange', { state: 'playing', currentIndex: 0, positionMs: 60000, durationMs: 130000 });
  expect(state.requests).toHaveLength(count);
});

test('starting a later episode sends a valid initial index and lazily supplies remaining episodes', async ({ page, isMobile }) => {
  const state = await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  await chromeButton(page, isMobile, 'Shows').click();
  await page.locator('.card-title').first().click();
  await expect(page.locator('.episode-card')).toHaveCount(4);
  await page.locator('.episode-card').nth(2).locator('.ep-play-btn').click();
  await expect.poll(async () => (await bridgeState(page)).calls.length).toBe(1);
  const initial = (await bridgeState(page)).calls[0];
  expect(initial).toMatchObject({ startIndex: 0, items: [{ id: 'ep-3', startPositionMs: 94250 }] });
  expect(state.requests.filter(r => r.path.endsWith('/PlaybackInfo')).map(r => r.path)).toEqual(['/Items/ep-3/PlaybackInfo']);
  await emit(page, 'needitems', { requestId: 'next', count: 2 });
  await expect.poll(async () => (await bridgeState(page)).supplies.length).toBe(1);
  expect((await bridgeState(page)).supplies[0]).toMatchObject({ id: 'next', items: [{ id: 'ep-4' }], endOfList: true });
  await page.evaluate(() => (window as any).__bridgedTest.playQueueTrack(3));
  expect((await bridgeState(page)).jumps).toEqual([1]);
  expect((await bridgeState(page)).calls).toHaveLength(1);
});

test('failed next-item preparation stays retryable and does not declare the series finished', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  await page.evaluate(async (series) => (window as any).__bridgedTest.playMedia(series, series.seasons[0].Episodes, 1), series);
  state.failNext = 'ep-3';
  await emit(page, 'needitems', { requestId: 'retry', count: 2 });
  await expect(page.getByRole('button', { name: 'Retry queue' })).toBeVisible();
  expect((await bridgeState(page)).supplies).toHaveLength(0);
  await page.getByRole('button', { name: 'Retry queue' }).click();
  await expect.poll(async () => (await bridgeState(page)).supplies.length).toBe(1);
  expect((await bridgeState(page)).supplies[0]).toMatchObject({ id: 'retry', items: [{ id: 'ep-3' }, { id: 'ep-4' }], endOfList: true });
});

test('partial next-item preparation does not send endOfList prematurely', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  await page.evaluate(async (series) => (window as any).__bridgedTest.playMedia(series, series.seasons[0].Episodes, 0), series);
  state.failNext = 'ep-3';
  await emit(page, 'needitems', { requestId: 'partial', count: 3 });
  await expect.poll(async () => (await bridgeState(page)).supplies.length).toBe(1);
  expect((await bridgeState(page)).supplies[0]).toMatchObject({ items: [{ id: 'ep-2' }], endOfList: false });
  await emit(page, 'needitems', { requestId: 'rest', count: 2 });
  await expect.poll(async () => (await bridgeState(page)).supplies.length).toBe(2);
  expect((await bridgeState(page)).supplies[1]).toMatchObject({ items: [{ id: 'ep-3' }, { id: 'ep-4' }], endOfList: true });
});

for (const bridge of ['linked', 'direct'] as const) {
  test(`legacy ${bridge} casting remains available and failure never shows fake casting UI`, async ({ page }) => {
    await fixture(page, { bridge });
    await page.evaluate(() => { (window as any).__jellyfinBridge.fail = true; });
    await page.locator('.action-cast').click();
    await expect(page.locator('.destination-row [role="alert"]')).toBeVisible();
    await expect(page.locator('.mini-player-bar')).toHaveCount(0);
    await page.evaluate(() => { (window as any).__jellyfinBridge.fail = false; });
    await page.locator('.action-cast').click();
    await expect(page.locator('.mini-player-bar')).toBeVisible();
    expect((await bridgeState(page)).calls.at(-1).items[0].startPositionMs).toBe(52345);
  });
}

for (const nativeVideo of [false, true]) {
  test(`real browser ${nativeVideo ? 'video fallback' : 'Movi'} resumes and reports without resetting saved progress`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const state = await fixture(page, { nativeVideo });
    await page.locator('.action-play').click();
    const player = page.locator(nativeVideo ? '.native-video-el' : 'movi-player');
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate(node => {
      const media = node as HTMLMediaElement;
      return !media.seeking && media.currentTime >= 52 && media.currentTime < 70;
    }), { timeout: 20000 }).toBe(true);
    if (nativeVideo) {
      const frameTime = await player.evaluate(node => new Promise<number>(resolve =>
        (node as HTMLVideoElement).requestVideoFrameCallback((_now, metadata) => resolve(metadata.mediaTime))));
      expect(frameTime).toBeGreaterThan(52);
    } else {
      await expect.poll(async () => {
        const bounds = await player.locator('canvas').first().boundingBox();
        if (!bounds) return false;
        const screenshot = await page.screenshot({ clip: { x: Math.floor(bounds.x + bounds.width / 2),
          y: Math.floor(bounds.y + bounds.height / 2), width: 1, height: 1 } });
        return page.evaluate(async bytes => {
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
          try {
            const img = new Image(); img.src = url; await img.decode();
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d')!; context.drawImage(img, 0, 0);
            const pixel = context.getImageData(0, 0, 1, 1).data;
            return pixel[1] > 150 && pixel[0] < 40 && pixel[2] < 40;
          } finally { URL.revokeObjectURL(url); }
        }, [...screenshot]);
      }).toBe(true);
    }
    await player.evaluate(node => (node as HTMLMediaElement).pause());
    await expect.poll(() => state.requests.filter(r => r.path === '/Sessions/Playing/Progress').length).toBeGreaterThan(0);
    expect(state.requests.filter(r => r.path.startsWith('/Sessions/Playing')).every(r => r.body.PositionTicks >= 520000000)).toBe(true);
    await page.getByTitle('Stop and Close Player', { exact: true }).click();
    await expect.poll(() => state.requests.filter(r => r.path === '/Sessions/Playing/Stopped').length).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('server-selected transcoding URL and audio/subtitle choices travel to native playback', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  state.transcode = true;
  await page.locator('.action-details').click();
  await expect(page.getByLabel('Audio track', { exact: true })).toBeVisible();
  await page.getByLabel('Audio track', { exact: true }).selectOption('0');
  await page.getByLabel('Subtitle track', { exact: true }).selectOption('2');
  await page.locator('.modal-container').getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(async () => (await bridgeState(page)).calls.length).toBe(1);
  const preparation = state.requests.find(r => r.path.endsWith('/PlaybackInfo'))!;
  expect(preparation.body).toMatchObject({ AudioStreamIndex: 0, SubtitleStreamIndex: 2, UserId: 'user' });
  const item = (await bridgeState(page)).calls[0].items[0];
  expect(item.url).toContain('/base/Videos/movie/master.m3u8');
  expect(item.contentType).toBe('application/vnd.apple.mpegurl');
  expect(item.subtitleResources[0].url).toContain('/Subtitles/2/Stream.vtt');
});

test('search and favorites query the whole server rather than just the home subset', async ({ page, isMobile }) => {
  const state = await fixture(page);
  await page.evaluate(() => (window as any).__bridgedTest.activeTab.set('search'));
  await page.evaluate(() => (window as any).__bridgedTest.searchQuery.set('Older'));
  await expect(page.locator('.card-title').filter({ hasText: 'Older Favorite Song' })).toBeVisible();
  expect(state.requests.some(r => r.query.includes('SearchTerm=Older'))).toBe(true);
  await chromeButton(page, isMobile, isMobile ? 'Favs' : 'Favorites').click();
  await expect(page.locator('.card-title').filter({ hasText: 'Older Favorite Song' })).toBeVisible();
  expect(state.requests.some(r => r.query.includes('Filters=IsFavorite'))).toBe(true);
});

test('failed favorite save does not claim success or mutate local favorite state', async ({ page }) => {
  const state = await fixture(page);
  state.failFavorite = true;
  await page.locator('.action-details').click();
  const favorite = page.getByTitle('Toggle Favorite', { exact: true });
  await favorite.click();
  await expect(page.locator('.toast-notification')).toContainText('Favorite could not be saved');
  await expect(favorite).not.toHaveClass(/active-fav/);
});

test('cache keys include origin, user, filters, recursive mode and pagination', async ({ page }) => {
  await fixture(page);
  const keys = await page.evaluate(async () => {
    const { cacheKey } = await import('/src/lib/api/jellyfin.ts');
    const options = [{ startIndex: 0, limit: 48 }, { startIndex: 48, limit: 48 }, { genres: 'Drama' },
      { sortOrder: 'Ascending' }, { sortOrder: 'Descending' }, { recursive: false }, { recursive: true }, { filters: 'IsFavorite' }];
    return [cacheKey('https://a.test/base', 'same-user', 'library'), cacheKey('https://b.test/base', 'same-user', 'library'),
      cacheKey('https://a.test/base', 'different-user', 'library'), ...options.map(option => cacheKey('https://a.test/base', 'same-user', 'library', option))];
  });
  expect(new Set(keys).size).toBe(keys.length);
});

test('account switching reloads folder rows when both accounts use the same library ID', async ({ page }) => {
  await fixture(page, { library: true });
  await page.locator('.library-tile-card').filter({ hasText: 'Shared music' }).click();
  await expect(page.locator('.card-title')).toHaveText('Account A song');
  await page.evaluate(async () => {
    const hooks = (window as any).__bridgedTest;
    let config: any; hooks.serverConfig.subscribe((value: any) => { config = value; })();
    await hooks.switchAccount({ ...config, id: 'other-account', userId: 'other-user', token: 'other-mock-token', lastActive: 0 });
  });
  await page.locator('.library-tile-card').filter({ hasText: 'Shared music' }).click();
  await expect(page.locator('.card-title')).toHaveText('Account B song');
  await expect(page.locator('.card-title').filter({ hasText: 'Account A song' })).toHaveCount(0);
});

async function persistReviewCache(page: Page, key: string) {
  await page.evaluate(async key => {
    const cache = await import('/src/lib/api/cache.ts');
    cache.setCachedData(key, 'old');
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('PlayBridge_Jellyfin_DB');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('swr_cache', 'readonly').objectStore('swr_cache').get(key);
        request.onerror = () => { db.close(); reject(request.error); };
        request.onsuccess = () => { db.close(); request.result?.data === 'old' ? resolve() : reject(new Error('Cache fixture did not persist')); };
      };
    });
  }, key);
}

for (const action of ['clearAllCache', 'invalidateCache'] as const) {
  test(`pending IndexedDB hydration cannot undo ${action}`, async ({ page }) => {
    await fixture(page);
    const key = `review-${action}`;
    await persistReviewCache(page, key);
    const value = await page.evaluate(async ({ key, action }) => {
      const cache = await import('/src/lib/api/cache.ts');
      const hydration = cache.hydrateCacheFromStorage();
      if (action === 'clearAllCache') cache.clearAllCache(); else cache.invalidateCache(key);
      await hydration;
      return cache.getCachedData(key);
    }, { key, action });
    expect(value).toBeNull();
  });
}

test('IndexedDB hydration cannot replace a fresher in-memory cache entry', async ({ page }) => {
  await fixture(page);
  const key = 'review-newer-memory';
  await persistReviewCache(page, key);
  const value = await page.evaluate(async key => {
    const cache = await import('/src/lib/api/cache.ts');
    const hydration = cache.hydrateCacheFromStorage();
    cache.setCachedData(key, 'new');
    await hydration;
    return cache.getCachedData(key);
  }, key);
  expect(value).toBe('new');
});

test('preparing a duplicate playlist item does not replace the current item resume/session identity', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  const queue = [movie, { ...movie, UserData: { PlaybackPositionTicks: 0, IsFavorite: false } }];
  await page.evaluate(async queue => (window as any).__bridgedTest.playMedia(queue[0], queue, 0), queue);
  await emit(page, 'needitems', { requestId: 'duplicate', count: 1 });
  await expect.poll(async () => (await bridgeState(page)).supplies.length).toBe(1);
  expect((await bridgeState(page)).supplies[0].items[0].startPositionMs).toBe(0);
  await emit(page, 'statechange', { state: 'playing', currentIndex: 0, positionMs: 0, durationMs: 130000 });
  expect(state.requests.filter(r => r.path.startsWith('/Sessions/Playing'))).toHaveLength(0);
});

test('logout during initial preparation cancels native playback', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  let release!: () => void;
  state.holdPreparation = new Promise<void>(resolve => { release = resolve; });
  await page.locator('.action-play').click();
  await expect.poll(() => state.requests.filter(r => r.path.endsWith('/PlaybackInfo')).length).toBe(1);
  await page.evaluate(() => (window as any).__bridgedTest.logout());
  release();
  await expect(page.getByRole('button', { name: /Explore with Demo Library/ })).toBeVisible();
  expect((await bridgeState(page)).calls).toHaveLength(0);
});

test('logout while a demanded item is preparing prevents late queue supply', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  await page.evaluate(async series => (window as any).__bridgedTest.playMedia(series, series.seasons[0].Episodes, 0), series);
  let release!: () => void;
  state.holdPreparation = new Promise<void>(resolve => { release = resolve; });
  await emit(page, 'needitems', { requestId: 'late', count: 1 });
  await expect.poll(() => state.requests.filter(r => r.path === '/Items/ep-2/PlaybackInfo').length).toBe(1);
  await page.evaluate(() => (window as any).__bridgedTest.logout());
  release();
  await expect.poll(async () => (await bridgeState(page)).unlinks).toBe(1);
  expect((await bridgeState(page)).supplies).toHaveLength(0);
});

test('switching native playback to the browser preserves the actual receiver position', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern', localPlayer: 'native', nativeVideo: true });
  await page.locator('.action-play').click();
  await expect(page.locator('.mini-player-bar')).toBeVisible();
  await emit(page, 'statechange', { state: 'playing', currentIndex: 0, positionMs: 61000, durationMs: 130000 });
  await page.locator('.mini-left').click();
  await page.getByRole('button', { name: 'Play on This Screen' }).click();
  const player = page.locator('.native-video-el');
  await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(60);
  expect((await bridgeState(page)).unlinks).toBe(1);
  await expect.poll(() => state.requests.filter(r => r.path === '/Sessions/Playing/Stopped').length).toBe(1);
});

test('selecting an alternate media version uses that source rather than always the first one', async ({ page }) => {
  const state = await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  await page.locator('.action-details').click();
  await page.getByLabel('Media version', { exact: true }).selectOption('alternate');
  await page.locator('.modal-container').getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(async () => (await bridgeState(page)).calls.length).toBe(1);
  expect(state.requests.find(r => r.path.endsWith('/PlaybackInfo'))!.body.MediaSourceId).toBe('alternate');
  expect((await bridgeState(page)).calls[0].items[0]).toMatchObject({ contentType: 'video/x-matroska' });
  expect((await bridgeState(page)).calls[0].items[0].url).toContain('mediaSourceId=alternate');
});

test('browser EOF advances once and resets resume state for a new episode using the same URL', async ({ page }) => {
  await fixture(page, { nativeVideo: true });
  const queue = [episodes[2], episodes[3]].map(item => ({ ...item, streamUrl: 'https://jellyfin.test/shared/stream.mp4' }));
  await page.evaluate(async queue => (window as any).__bridgedTest.playMedia(queue[0], queue, 0), queue);
  const player = page.locator('.native-video-el');
  await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(94);
  const old = await player.elementHandle();
  await player.evaluate(node => { (node as HTMLVideoElement).currentTime = 128; });
  await expect(page.locator('.playing-title')).toContainText('Episode 4', { timeout: 15000 });
  await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeLessThan(5);
  await old!.evaluate(node => node.dispatchEvent(new Event('ended')));
  await expect(page.locator('.playing-title')).toContainText('Episode 4');
});

test('diagnostics redact credentials and authenticated stream URLs', async ({ page }) => {
  await fixture(page, { bridge: 'modern', localPlayer: 'native' });
  await page.locator('.action-play').click();
  await page.evaluate(async () => {
    const { addDiagnosticLog } = await import('/src/lib/cast/playbridge.ts');
    addDiagnosticLog('feedback', 'Authorization: Bearer mock-token', {
      Authorization: 'Bearer mock-token', Cookie: 'session=mock-token', api_key: 'mock-token',
      detail: 'Token="mock-token"; password=mock-token'
    });
  });
  const json = await page.evaluate(() => JSON.stringify((window as any).__bridgedTest.diagnostics()));
  expect(json).not.toContain('mock-token');
  expect(json).not.toContain('api_key=');
});
