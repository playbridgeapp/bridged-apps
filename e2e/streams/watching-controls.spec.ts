import { expect, test } from '@playwright/test';
import { fixture, point, marker, addon, showId, accounts, tab, outbox, browserPlayer, report } from './watching-fixture';
test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

async function options(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Watching options for Test Series', exact: true }).click();
  return page.getByRole('dialog', { name: 'Watching options for Test Series' });
}

test('marks an episode watched, advances Next up, and unwatched deletes markers and completed progress', async ({ page }) => {
  const state = await fixture(page);
  await (await options(page)).getByRole('button', { name: 'Mark watched', exact: true }).click();
  await expect.poll(() => state.watched.some((p) => p.episode === 4)).toBe(true);
  await expect.poll(() => state.progress.length).toBe(0);
  const card = page.getByRole('button', { name: 'View details for Test Series', exact: true }).first();
  await expect(card).toContainText('Next up: S1E5');
  await expect.poll(async () => (await outbox(page)).length).toBe(0);
  // Open details from the catalog, then correct the watched episode.
  await page.locator('.catalog-section').filter({ has: page.getByRole('heading', { name: 'Test shows', exact: true }) }).getByRole('button', { name: 'View details for Test Series' }).click();
  await page.getByRole('button', { name: 'Watching options for S1E4', exact: true }).click();
  await page.getByRole('dialog', { name: 'Watching options for Test Series' }).getByRole('button', { name: 'Mark unwatched', exact: true }).click();
  await expect.poll(() => state.watched.length).toBe(0);
  expect(state.writes.find((w) => w.method === 'sync_delete_watched_items')?.body).toMatchObject({ p_profile_id: 2, p_keys: [{ content_id: showId, season: 1, episode: 4 }] });
  await expect(page.getByRole('button', { name: 'Watching options for S1E4' })).toHaveText('Watching options');
});

test('season actions survive failed writes and a reload, without leaking into another profile', async ({ page }) => {
  const state = await fixture(page); state.failWrites = true;
  await page.locator('.catalog-section').filter({ has: page.getByRole('heading', { name: 'Test shows', exact: true }) }).getByRole('button', { name: 'View details for Test Series' }).click();
  await page.getByRole('button', { name: 'Mark season watched', exact: true }).click();
  await expect.poll(async () => (await outbox(page)).length).toBe(6);
  await page.goto('/');
  await expect.poll(async () => (await outbox(page)).length).toBe(6);
  let dialog = await accounts(page);
  await expect(dialog).toContainText('6 watching changes waiting to sync');
  await dialog.getByRole('combobox', { name: 'Profile', exact: true }).selectOption('1');
  await expect(dialog.getByRole('button', { name: 'Sync Nuvio now' })).toBeEnabled();
  state.failWrites = false;
  await dialog.getByRole('button', { name: 'Close account' }).click(); await tab(page, 'Home');
  await expect(page.getByRole('button', { name: 'Watching options for Test Series', exact: true })).toHaveCount(0);
  expect(state.writes.filter((w) => w.body.p_profile_id === 1)).toHaveLength(0);
  dialog = await accounts(page);
  await dialog.getByRole('combobox', { name: 'Profile', exact: true }).selectOption('2');
  await expect.poll(async () => (await outbox(page)).length).toBe(0);
  expect(state.watched).toHaveLength(6);
  await dialog.getByRole('button', { name: 'Close account' }).click(); await tab(page, 'Home');
  await page.locator('.catalog-section').filter({ has: page.getByRole('heading', { name: 'Test shows', exact: true }) }).getByRole('button', { name: 'View details for Test Series' }).click();
  await page.getByRole('button', { name: 'Mark season unwatched', exact: true }).click();
  await expect.poll(() => state.watched.length).toBe(0);
});

test('dismissal persists without removing progress, merges settings, and newer delta activity brings the title back', async ({ page }) => {
  const state = await fixture(page);
  await (await options(page)).getByRole('button', { name: 'Hide from Continue Watching' }).click();
  await expect(page.getByRole('button', { name: 'Watching options for Test Series', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await outbox(page)).length).toBe(0);
  expect(state.progress).toHaveLength(1); expect(state.settings.features.untouched.keep).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Test shows', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watching options for Test Series', exact: true })).toHaveCount(0);
  const fullBefore = state.pulls.filter((p) => p === 'sync_pull_watch_progress' || p === 'sync_pull_watched_items').length;
  const newer = point(4, Date.now() + 1000); state.progress = [newer]; state.events.push({ ...newer, event_id: ++state.cursor, operation: 'upsert' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('button', { name: 'Watching options for Test Series', exact: true })).toBeVisible();
  expect(state.pulls.filter((p) => p === 'sync_pull_watch_progress' || p === 'sync_pull_watched_items')).toHaveLength(fullBefore);
});

test('reset clears all resume positions for a title while preserving watched history and Next up', async ({ page }) => {
  const state = await fixture(page, { watched: [marker(3)], progress: [point(4), point(2)] });
  await (await options(page)).getByRole('button', { name: 'Reset playback progress' }).click();
  await expect.poll(() => state.progress.length).toBe(0);
  expect(state.watched).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'View details for Test Series', exact: true }).first()).toContainText('Next up: S1E4');
  expect(state.writes.some((w) => w.method === 'sync_delete_watched_items')).toBe(false);
});

test('failed playback saves survive reload, but newer TV progress wins over an older queued save', async ({ page }) => {
  const state = await fixture(page); state.failWrites = true;
  await browserPlayer(page); await report(page, 700);
  await expect.poll(async () => (await outbox(page)).length).toBe(1);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Test shows', exact: true })).toBeVisible();
  const pending = await outbox(page); expect(pending).toHaveLength(1);
  expect(pending[0].write.entry.position).toBe(700000);
  const latest = { ...point(4, pending[0].observedAt + 1000), position: 900000 }; state.progress = [latest]; state.events.push({ ...latest, event_id: ++state.cursor, operation: 'upsert' });
  state.failWrites = false;
  const before = state.writes.length;
  await page.goto('/');
  await expect.poll(async () => (await outbox(page)).length).toBe(0);
  expect(state.writes).toHaveLength(before);
  expect(state.progress[0].position).toBe(900000);
});

test('queued playback progress retries successfully after reopening and ended saves completion', async ({ page }) => {
  const state = await fixture(page); state.failWrites = true;
  await browserPlayer(page); await report(page, 700);
  await expect.poll(async () => (await outbox(page)).length).toBe(1);
  state.failWrites = false; await page.goto('/');
  await expect.poll(async () => (await outbox(page)).length).toBe(0);
  expect(state.progress[0].position).toBe(700000);
  await browserPlayer(page); await report(page, 2950, 'ended');
  await expect.poll(() => state.progress.find((p) => p.episode === 4)?.position).toBe(3000000);
});


test('movie watched and unwatched controls use title markers with null episode coordinates', async ({ page }) => {
  const moviePoint = { ...point(), progress_key: 'tt-movie', content_id: 'tt-movie', content_type: 'movie', video_id: 'tt-movie', season: null, episode: null };
  const state = await fixture(page, { movie: true, progress: [point(), moviePoint] });
  await page.getByRole('button', { name: 'Watching options for Test Movie', exact: true }).click();
  await page.getByRole('dialog', { name: 'Watching options for Test Movie' }).getByRole('button', { name: 'Mark watched', exact: true }).click();
  await expect.poll(() => state.watched.some((p) => p.content_id === 'tt-movie')).toBe(true);
  await expect.poll(() => state.progress.some((p) => p.content_id === 'tt-movie')).toBe(false);
  expect(state.watched.find((p) => p.content_id === 'tt-movie')).toMatchObject({ content_type: 'movie', season: null, episode: null });
  await page.getByRole('button', { name: 'View details for Test Movie', exact: true }).click();
  await page.getByRole('dialog', { name: 'Test Movie', exact: true }).getByRole('button', { name: 'Watching options', exact: true }).click();
  await page.getByRole('dialog', { name: 'Watching options for Test Movie' }).getByRole('button', { name: 'Mark unwatched', exact: true }).click();
  await expect.poll(() => state.watched.some((p) => p.content_id === 'tt-movie')).toBe(false);
});

test('a newer pause queued during an in-flight save survives the older acknowledgement', async ({ page }) => {
  const state = await fixture(page);
  let release!: () => void;
  state.progressGate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await browserPlayer(page); await report(page, 700);
    await expect.poll(() => state.writes.filter((w) => w.method === 'sync_push_watch_progress').length).toBe(1);
    await report(page, 800);
    await expect.poll(async () => (await outbox(page))[0]?.write.entry.position).toBe(800000);
    state.progressGate = null; release();
    await expect.poll(async () => (await outbox(page)).length).toBe(0);
    expect(state.writes.filter((w) => w.method === 'sync_push_watch_progress').map((w) => w.body.p_entries[0].position)).toEqual([700000, 800000]);
    expect(state.progress[0].position).toBe(800000);
  } finally { release(); }
});
