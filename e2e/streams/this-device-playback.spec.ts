import { expect, test, type Page } from '@playwright/test';
import { fixture, browserPlayer, report, tab } from './watching-fixture';

async function setup(page: Page, orientationSupported = true, remote = false) {
  await page.addInitScript(({ orientationSupported, remote }) => {
    const calls: any[] = [];
    const session = Object.assign(new EventTarget(), { sessionId: 'local-player', unlink: async () => {},
      provideItems: async (requestId: string, result: any) => { calls.push({ method: 'provideItems', requestId, ...result }); } });
    const hook = (window as any).__bridgedTest = { calls, session, destination: remote
      ? { id: 'living-room', name: 'Living Room TV', kind: 'native', connected: true }
      : { id: 'this-device', name: 'This device', kind: 'local', connected: true } };
    hook.playbridge = { capabilities: { playback: 1, localPlaybackOrientation: orientationSupported ? 1 : 0 },
      cast: () => {}, getPlaybackDestination: async () => ({ ok: true, destination: hook.destination }),
      play: async (payload: any) => { calls.push({ method: 'play', payload }); return session; } };
  }, { orientationSupported, remote });
  return fixture(page);
}
async function settings(page: Page) {
  await tab(page, 'Settings');
  await page.getByRole('button', { name: /Addons and playback/ }).click();
  return page.getByRole('dialog', { name: 'Manage addons' });
}
async function closeSettings(page: Page) {
  await page.getByRole('dialog', { name: 'Manage addons' }).getByRole('button', { name: 'Close', exact: true }).click();
  await tab(page, 'Home');
}
async function play(page: Page) {
  await page.getByRole('button', { name: 'View details for Test Series', exact: true }).first().click();
  await page.locator('.detail-overlay .detail-play').click(); // Continue Watching opens details first.
  await expect(page.getByRole('dialog', { name: 'Streams for Test Series' })).toBeVisible();
  await page.locator('.stream-result .watch-button').click();
}
const calls = (page: Page) => page.evaluate(() => (window as any).__bridgedTest.calls);

test('native This device defaults to landscape and retains resume and lazy queue supply', async ({ page }) => {
  await setup(page);
  await settings(page);
  await expect(page.getByRole('switch', { name: 'Use PlayBridge video player on this device' })).toBeChecked();
  await expect(page.getByLabel('Player opening orientation')).toHaveValue('landscape');
  await closeSettings(page);
  await play(page);
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0].payload).toMatchObject({ destinationId: 'this-device', initialOrientation: 'landscape',
    items: [{ id: 'tt-watching:1:4', startPositionMs: 600000 }] });
  await expect(page.locator('movi-player')).toHaveCount(0);
  await page.evaluate(() => (window as any).__bridgedTest.session.dispatchEvent(new CustomEvent('needitems', {
    detail: { requestId: 'next', afterIndex: 0, afterItemId: 'tt-watching:1:4', count: 1 }
  })));
  await expect.poll(async () => (await calls(page)).filter((call: any) => call.method === 'provideItems').length).toBe(1);
  expect((await calls(page))[1].items[0].id).toBe('tt-watching:1:5');
});

for (const orientation of ['portrait', 'auto']) {
  test(`saves and sends ${orientation} opening orientation after reload`, async ({ page }) => {
    await setup(page);
    await settings(page);
    await page.getByLabel('Player opening orientation').selectOption(orientation);
    await closeSettings(page);
    await page.reload();
    await settings(page);
    await expect(page.getByLabel('Player opening orientation')).toHaveValue(orientation);
    await closeSettings(page);
    await play(page);
    await expect.poll(async () => (await calls(page)).length).toBe(1);
    expect((await calls(page))[0].payload.initialOrientation).toBe(orientation);
  });
}

test('native-player Off persists and uses the browser with saved resume and progress', async ({ page }) => {
  const state = await setup(page);
  await settings(page);
  await page.getByRole('switch', { name: 'Use PlayBridge video player on this device' }).uncheck();
  await expect(page.getByLabel('Player opening orientation')).toBeDisabled();
  await closeSettings(page);
  await page.reload();
  await settings(page);
  await expect(page.getByRole('switch', { name: 'Use PlayBridge video player on this device' })).not.toBeChecked();
  await closeSettings(page);
  await browserPlayer(page);
  expect(await calls(page)).toEqual([]);
  await report(page, 700);
  await expect.poll(() => state.writes.filter((write) => write.method === 'sync_push_watch_progress').length).toBeGreaterThan(0);
  expect(state.writes.filter((write) => write.method === 'sync_push_watch_progress').at(-1)!.body.p_entries[0].position).toBe(700000);
});

test('remote casting is unchanged when the local native player is disabled', async ({ page }) => {
  await setup(page, true, true);
  await settings(page);
  await page.getByRole('switch', { name: 'Use PlayBridge video player on this device' }).uncheck();
  await closeSettings(page);
  await play(page);
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0].payload.destinationId).toBe('living-room');
  expect((await calls(page))[0].payload).not.toHaveProperty('initialOrientation');
  await expect(page.locator('movi-player')).toHaveCount(0);
});

test('older playback hosts retain native playback and explain unavailable orientation support', async ({ page }) => {
  await setup(page, false);
  const panel = await settings(page);
  await expect(page.getByLabel('Player opening orientation')).toBeDisabled();
  await expect(panel).toContainText('Update PlayBridge to choose the opening orientation');
  await closeSettings(page);
  await play(page);
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0].payload).not.toHaveProperty('initialOrientation');
});

test('settings are absent without a playback bridge', async ({ page }) => {
  await fixture(page);
  await settings(page);
  await expect(page.getByRole('switch', { name: 'Use PlayBridge video player on this device' })).toHaveCount(0);
});

test('a changed destination cannot silently start browser playback for an old local selection', async ({ page }) => {
  await setup(page);
  await settings(page);
  await page.getByRole('switch', { name: 'Use PlayBridge video player on this device' }).uncheck();
  await closeSettings(page);
  await page.getByRole('button', { name: 'View details for Test Series', exact: true }).first().click();
  await page.locator('.detail-overlay .detail-play').click(); // Continue Watching opens details first.
  await expect(page.getByRole('dialog', { name: 'Streams for Test Series' })).toBeVisible();
  await expect(page.locator('.stream-result .watch-button')).toBeVisible();
  await page.evaluate(() => {
    // Switch at the click boundary, after the app captured the local selection.
    // A pre-click switch can legitimately be picked up by its status poll.
    document.querySelector('.stream-result .watch-button')!.addEventListener('click', () => {
      (window as any).__bridgedTest.playbridge.getPlaybackDestination = async () => ({ ok: true,
        destination: { id: 'living-room', name: 'Living Room TV', kind: 'native', connected: true } });
    }, { capture: true, once: true });
  });
  await page.locator('.stream-result .watch-button').click();
  await expect(page.getByRole('alert')).toContainText('selected receiver disconnected or changed');
  expect(await calls(page)).toEqual([]);
  await expect(page.locator('movi-player')).toHaveCount(0);
});
