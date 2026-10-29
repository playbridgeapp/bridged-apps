import { expect, test, type Page } from '@playwright/test';
import { addon, fixture, showId, tab } from './watching-fixture';

async function setup(page: Page, preferences: Record<string, unknown> = {}) {
  await page.addInitScript((preferences) => {
    localStorage.setItem('bridged-streams.stream-selection.v2', JSON.stringify({ mode: 'first', ...preferences }));
    const state = (window as any).__openingTest = { streamsSeen: 0, attempts: [] as string[], holdFrames: false, native: [] as any[] };
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof Element
        && (node.matches('.stream-panel') || node.querySelector('.stream-panel'))) state.streamsSeen++;
    }).observe(document, { childList: true, subtree: true });
    customElements.define('movi-player', class extends HTMLElement {
      currentTime = 0; duration = 3000; seeking = false;
      connectedCallback() {
        const url = this.getAttribute('src') || ''; state.attempts.push(url);
        setTimeout(() => {
          if (!this.isConnected || state.holdFrames) return;
          if (url.includes('/fail')) this.dispatchEvent(new CustomEvent('error', { detail: 'Synthetic load failure' }));
          else for (const event of ['loadedmetadata', 'canplay', 'playing']) this.dispatchEvent(new Event(event));
        }, 20);
      }
      play() { return Promise.resolve(); }
      pause() {}
    });
  }, preferences);
  await fixture(page, { movie: true });
}

const opening = (page: Page) => page.getByRole('dialog', { name: /^Opening / });
async function movieDetail(page: Page) { await page.getByRole('button', { name: 'View details for Test Movie', exact: true }).first().click(); }
const noList = async (page: Page) => expect(await page.evaluate(() => (window as any).__openingTest.streamsSeen)).toBe(0);

for (const prefetched of [false, true]) {
  test(prefetched ? 'adopts a completed movie prefetch without another provider request' : 'detail Play uses an opening overlay, never renders the list, and Back returns to detail', async ({ page }) => {
    await setup(page, { prefetchStreamsOnDetail: prefetched });
    let requests = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`${addon}/stream/movie/**`, async (route) => {
      requests++; if (!prefetched) await gate;
      await route.fulfill({ json: { streams: [{ name: 'Movie source', url: 'https://media.test/movie.mp4' }] } });
    });
    await movieDetail(page);
    if (prefetched) await expect.poll(() => requests).toBe(1);
    try {
      await page.locator('.detail-play').click();
      if (!prefetched) { await expect(opening(page)).toBeVisible(); await expect(opening(page).getByRole('status')).toHaveText('Finding a stream…'); }
    } finally { release(); }
    await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/movie.mp4');
    await expect(opening(page)).toHaveCount(0);
    await noList(page); expect(requests).toBe(1);
    await page.goBack();
    await expect(page.locator('.detail-play')).toBeVisible();
    await expect(page).toHaveURL(/#\/movie\/tt-movie$/);
    await expect(page.locator('movi-player')).toHaveCount(0);
  });
}

test('series prefetch and Resume use the same episode and saved position', async ({ page }) => {
  await setup(page);
  const requests: string[] = [];
  await page.route(`${addon}/stream/series/**`, (route) => {
    requests.push(decodeURIComponent(new URL(route.request().url()).pathname));
    return route.fulfill({ json: { streams: [{ name: 'Resume source', url: 'https://media.test/resume.mp4' }] } });
  });
  await page.getByRole('button', { name: 'View details for Test Series', exact: true }).first().click();
  await expect(page.locator('.detail-play')).toContainText('Resume S1·E4 · 10:00');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toContain(`${showId}:1:4.json`);
  await page.locator('.detail-play').click();
  await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/resume.mp4');
  await expect.poll(() => page.locator('movi-player').evaluate((node: any) => node.currentTime)).toBe(600);
  await expect(opening(page)).toHaveCount(0);
  await noList(page); expect(requests).toHaveLength(1);
});

for (const target of ['browser', 'native'] as const) {
  test(`${target} load failure tries the next candidate before starting playback`, async ({ page }) => {
    await setup(page);
    await page.route(`${addon}/stream/movie/**`, (route) => route.fulfill({ json: { streams: [
      { name: 'Fails', url: 'https://media.test/fail.mp4' }, { name: 'Works', url: 'https://media.test/works.mp4' }
    ] } }));
    if (target === 'native') await page.evaluate(() => {
      const state = (window as any).__openingTest;
      (window as any).__bridgedTest = { playbridge: {
        capabilities: { playback: 1 },
        getPlaybackDestination: async () => ({ destination: { id: 'mock-tv', name: 'Mock TV', kind: 'native', connected: true } }),
        play: async (payload: any) => {
          state.native.push(payload);
          if (payload.items[0].url.includes('/fail')) throw new Error('Synthetic cast load failure');
          return Object.assign(new EventTarget(), { unlink: async () => {}, provideItems: async () => {} });
        }
      } };
      window.dispatchEvent(new Event('pageshow'));
    });
    await movieDetail(page);
    if (target === 'native') await expect(page.getByRole('button', { name: /Playback destination: Mock TV/ })).toBeVisible();
    await page.locator('.detail-play').click();
    if (target === 'browser') {
      await expect(page.locator('movi-player')).toHaveAttribute('src', 'https://media.test/works.mp4');
      await expect(opening(page)).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).__openingTest.attempts)).toEqual(['https://media.test/fail.mp4', 'https://media.test/works.mp4']);
      // Once started, a later playback error must not silently try another source.
      await page.locator('movi-player').evaluate((node) => node.dispatchEvent(new Event('error')));
      expect(await page.evaluate(() => (window as any).__openingTest.attempts.length)).toBe(2);
    } else {
      await expect.poll(() => page.evaluate(() => (window as any).__openingTest.native.length)).toBe(2);
      await expect(opening(page)).toHaveCount(0);
      await expect(page).toHaveURL(/#\/movie\/tt-movie$/);
    }
    await noList(page);
  });
}

test('no match opens the list with a message and Choose stream always opens it manually', async ({ page }) => {
  await setup(page, { mode: 'regex', regex: 'NO-MATCH' });
  await movieDetail(page); await page.locator('.detail-play').click();
  await expect(page.locator('.stream-panel').getByRole('alert')).toContainText('No stream matches');
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.getByRole('button', { name: 'Choose stream', exact: true }).click();
  await expect(page.locator('.stream-panel')).toBeVisible();
  await expect(opening(page)).toHaveCount(0);
  await expect(page.locator('movi-player')).toHaveCount(0);
});

for (const action of ['Cancel', 'Escape', 'Back', 'Choose manually'] as const) {
  test(`opening ${action} respects the user's choice while results are pending`, async ({ page }) => {
    await setup(page, { prefetchStreamsOnDetail: false });
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`${addon}/stream/movie/**`, async (route) => { await gate; await route.fulfill({ json: { streams: [{ name: 'Late', url: 'https://media.test/late.mp4' }] } }); });
    await movieDetail(page); await page.locator('.detail-play').click();
    try {
      await expect(opening(page)).toBeVisible();
      await expect(opening(page).getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(opening(page).getByRole('button', { name: 'Choose manually', exact: true })).toBeFocused();
      if (action === 'Escape') await page.keyboard.press('Escape');
      else if (action === 'Back') await page.goBack();
      else await opening(page).getByRole('button', { name: action, exact: true }).click();
      await expect(opening(page)).toHaveCount(0);
    } finally { release(); }
    if (action === 'Choose manually') await expect(page.locator('.stream-panel')).toBeVisible();
    else { await expect(page.locator('.detail-play')).toBeVisible(); await noList(page); }
    await expect(page.locator('movi-player')).toHaveCount(0);
  });
}

test('Continue Watching optionally resumes directly; its options menu still offers details', async ({ page }) => {
  await setup(page, { resumeDirectlyFromContinueWatching: true });
  await page.getByRole('button', { name: 'Watching options for Test Series', exact: true }).click();
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  await expect(page.locator('.detail-play')).toBeVisible();
  await expect(opening(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to browsing', exact: true }).click();
  await page.getByRole('button', { name: 'View details for Test Series', exact: true }).first().click();
  await expect(page.locator('movi-player')).toBeVisible();
  await expect(opening(page)).toHaveCount(0);
  await expect.poll(() => page.locator('movi-player').evaluate((node: any) => node.currentTime)).toBe(600);
  await noList(page);
});

test('manual mode keeps Play opening the stream list without prefetch', async ({ page }) => {
  await setup(page, { mode: 'manual' });
  let lookups = 0;
  await page.route(`${addon}/stream/movie/**`, (route) => { lookups++; return route.fulfill({ json: { streams: [] } }); });
  await movieDetail(page); expect(lookups).toBe(0);
  await page.locator('.detail-play').click();
  await expect(page.locator('.stream-panel')).toBeVisible();
  await expect(opening(page)).toHaveCount(0); expect(lookups).toBe(1);
});

test('phone opening stays within the viewport and Cancel restores the action focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.evaluate(() => { (window as any).__openingTest.holdFrames = true; });
  await movieDetail(page); await page.locator('.detail-play').click();
  await expect(opening(page)).toBeVisible();
  await expect(opening(page).getByRole('status')).toHaveText('Opening…');
  expect(await opening(page).evaluate((node) => node.scrollWidth <= window.innerWidth)).toBe(true);
  for (const button of await opening(page).getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: '/private/tmp/streams-smooth-opening-phone.png' });
  await opening(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.detail-play')).toBeFocused();
});

test('three failed candidates open the list with an error and never try a fourth', async ({ page }) => {
  await setup(page);
  await page.route(`${addon}/stream/movie/**`, (route) => route.fulfill({ json: { streams: Array.from({ length: 4 }, (_, index) => ({
    name: `Candidate ${index}`, url: `https://media.test/fail-${index}.mp4`
  })) } }));
  await movieDetail(page); await page.locator('.detail-play').click();
  await expect(page.locator('.stream-panel').getByRole('alert')).toContainText('Could not open these streams');
  expect(await page.evaluate(() => (window as any).__openingTest.attempts.length)).toBe(3);
  await expect(page.locator('movi-player')).toHaveCount(0);
});

test('retargeting a native episode prefetch cancels the old resolver before adopting the new one', async ({ page }) => {
  await setup(page, { scope: 'plugins' });
  await page.route(`${addon}/meta/series/**`, (route) => route.fulfill({ json: { meta: { id: 'tmdb:1', type: 'series', name: 'Native Series', videos: [
    { id: 'tmdb:1:1:1', season: 1, episode: 1, title: 'Native first' }, { id: 'tmdb:1:1:2', season: 1, episode: 2, title: 'Native second' }
  ] } } }));
  await page.evaluate(() => {
    const state = (window as any).__openingTest; state.resolved = []; state.cancels = 0;
    let release: (() => void) | undefined;
    (window as any).__bridgedTest = { playbridge: {
      capabilities: { playback: 1, nativePlugins: 1 },
      getPlaybackDestination: async () => ({ destination: { id: 'mock-tv', name: 'Mock TV', kind: 'native', connected: true } }),
      play: async (payload: any) => { state.native.push(payload); return Object.assign(new EventTarget(), { unlink: async () => {}, provideItems: async () => {} }); },
      plugins: {
        status: async () => ({ available: true, enabled: true, providers: [{ repoUrl: 'https://native-prefetch.test/manifest.json', scraperId: 'mock', name: 'Mock resolver', enabled: true, requiresApproval: false }] }),
        cancel: () => { state.cancels++; release?.(); },
        resolve: async (request: any) => {
          state.resolved.push(request.episode);
          if (request.episode === 1) await new Promise<void>((resolve) => { release = resolve; });
          return { streams: [{ name: 'Native source', url: `https://media.test/native-${request.episode}.mp4` }], warnings: [] };
        }
      }
    } };
    window.dispatchEvent(new Event('pageshow'));
  });
  await page.getByRole('button', { name: 'View details for Test Series', exact: true }).last().click();
  await expect.poll(() => page.evaluate(() => (window as any).__openingTest.resolved)).toEqual([1]);
  await page.getByRole('button', { name: /Native second/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__openingTest.native.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__openingTest.native[0].items[0].url)).toBe('https://media.test/native-2.mp4');
  expect(await page.evaluate(() => (window as any).__openingTest.cancels)).toBeGreaterThan(0);
  await noList(page);
});

test('direct Continue Watching shows its opening dialog immediately while metadata is pending', async ({ page }) => {
  await setup(page, { resumeDirectlyFromContinueWatching: true });
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let metadataRequests = 0;
  await page.route(`${addon}/meta/series/**`, async (route) => { metadataRequests++; await gate; await route.fallback(); });
  try {
    await page.getByRole('button', { name: 'View details for Test Series', exact: true }).first().click();
    await expect(opening(page)).toBeVisible();
    await expect(opening(page).getByRole('status')).toHaveText('Finding a stream…');
    await expect.poll(() => metadataRequests).toBeGreaterThan(0);
    await opening(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(opening(page)).toHaveCount(0);
  } finally { release(); }
  await expect(page.locator('.detail-play')).toBeVisible();
  await expect(page.locator('movi-player')).toHaveCount(0);
  await noList(page);
});

test('direct resume selection timeout includes time spent waiting for metadata', async ({ page }) => {
  await setup(page, { resumeDirectlyFromContinueWatching: true, timeoutSeconds: 1 });
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`${addon}/meta/series/**`, async (route) => { await gate; await route.fallback(); });
  try {
    await page.getByRole('button', { name: 'View details for Test Series', exact: true }).first().click();
    await expect(opening(page)).toBeVisible();
    await expect(opening(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/streams/);
  } finally { release(); }
  await expect(page.locator('.stream-panel').getByRole('alert')).toContainText('Stream selection timed out');
  await expect(page.locator('movi-player')).toHaveCount(0);
});

test('a late native load rejection cannot revive a cancelled opening attempt', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const state = (window as any).__openingTest;
    (window as any).__bridgedTest = { playbridge: {
      capabilities: { playback: 1 },
      getPlaybackDestination: async () => ({ destination: { id: 'mock-tv', name: 'Mock TV', kind: 'native', connected: true } }),
      play: async (payload: any) => {
        state.native.push(payload);
        return new Promise((_resolve, reject) => { state.rejectNative = () => reject(new Error('Synthetic late load rejection')); });
      }
    } };
    window.dispatchEvent(new Event('pageshow'));
  });
  await movieDetail(page); await page.locator('.detail-play').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__openingTest.rejectNative)).toBe('function');
  await opening(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => (window as any).__openingTest.rejectNative());
  await expect(page.locator('.detail-play')).toBeEnabled();
  await expect(opening(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await noList(page);
});
