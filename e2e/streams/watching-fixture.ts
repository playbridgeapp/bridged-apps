import { expect, type Page } from '@playwright/test';
import type { NuvioProgress, NuvioWatchedItem } from '../../apps/streams/src/lib/nuvio';
export const showId = 'tt-watching';
export const addon = 'https://watching-addon.test';
export const point = (episode = 4, stamp = 1700000000000): NuvioProgress => ({ progress_key: `${showId}_s1e${episode}`, content_id: showId, content_type: 'series', video_id: `${showId}:1:${episode}`, season: 1, episode, position: 600000, duration: 3000000, last_watched: stamp });
export const marker = (episode: number): NuvioWatchedItem => ({ content_id: showId, content_type: 'series', season: 1, episode, watched_at: 1699999999000 });
export async function tab(page: Page, name: string) { await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click(); }
export async function accounts(page: Page) {
  await tab(page, 'Settings'); await page.getByRole('button', { name: /Accounts and profiles/ }).click();
  return page.getByRole('dialog', { name: 'Accounts', exact: true });
}
export const outbox = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bridged-streams.playback-outbox.v1') || '[]'));
export async function fixture(page: Page, options: { watched?: NuvioWatchedItem[]; progress?: NuvioProgress[]; subtitles?: boolean; native?: boolean; movie?: boolean } = {}) {
  const state = { progress: options.progress || [point()], watched: options.watched || [], writes: [] as { method: string; body: any }[], pulls: [] as string[], failWrites: false, settings: { features: { untouched: { keep: true } } } as any,
    cursor: 0, events: [] as any[], watchedCursor: 0, watchedEvents: [] as any[], subtitleRequests: [] as string[], fileRequests: [] as string[], failSubtitle: false, progressGate: null as Promise<void> | null };
  await page.addInitScript(() => {
    localStorage.setItem('bridged-streams.nuvio-session.v1', JSON.stringify({ backendUrl: 'https://watching-cloud.test', publishableKey: 'test-key', accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000, user: { id: 'viewer', email: 'viewer@example.com' } }));
    if (!localStorage.getItem('bridged-streams.nuvio-profile.v1')) localStorage.setItem('bridged-streams.nuvio-profile.v1', JSON.stringify({ userId: 'viewer', index: 2 }));
  });
  await page.route('https://watching-cloud.test/**', async (route) => {
    const method = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON() || {};
    if (method.startsWith('sync_push_') || method.startsWith('sync_delete_')) {
      state.writes.push({ method, body });
      if (method === 'sync_push_watch_progress' && state.progressGate) await state.progressGate;
      if (state.failWrites) return route.fulfill({ status: 503, json: { message: 'Offline test' } });
      if (method === 'sync_push_watch_progress') for (const item of body.p_entries) {
        state.progress = [...state.progress.filter((p) => p.progress_key !== item.progress_key), item]; state.events.push({ ...item, event_id: ++state.cursor, operation: 'upsert' });
      }
      if (method === 'sync_delete_watch_progress') for (const key of body.p_keys) {
        state.progress = state.progress.filter((p) => p.progress_key !== key); state.events.push({ progress_key: key, event_id: ++state.cursor, operation: 'delete' });
      }
      if (method === 'sync_push_watched_items') for (const item of body.p_items) {
        state.watched = [...state.watched.filter((p) => p.content_id !== item.content_id || p.season !== item.season || p.episode !== item.episode), item]; state.watchedEvents.push({ ...item, event_id: ++state.watchedCursor, operation: 'upsert' });
      }
      if (method === 'sync_delete_watched_items') for (const key of body.p_keys) {
        state.watched = state.watched.filter((p) => p.content_id !== key.content_id || p.season !== key.season || p.episode !== key.episode); state.watchedEvents.push({ ...key, content_type: 'series', event_id: ++state.watchedCursor, operation: 'delete' });
      }
      if (method.startsWith('sync_push_profile_settings_blob')) state.settings = body.p_settings_json;
      return route.fulfill({ json: null });
    }
    state.pulls.push(method);
    const isProfile = body.p_profile_id === 2;
    const result = method === 'sync_pull_profiles' ? [{ profile_index: 1, name: 'Other' }, { profile_index: 2, name: 'Golu' }]
      : method === 'addons' ? [{ url: `${addon}/manifest.json`, enabled: true }]
      : method === 'sync_pull_watch_progress' ? (isProfile ? state.progress : [])
      : method === 'sync_pull_watched_items' ? (isProfile && body.p_page === 1 ? state.watched : [])
      : method === 'sync_get_watch_progress_delta_cursor' ? state.cursor
      : method === 'sync_get_watched_items_delta_cursor' ? state.watchedCursor
      : method === 'sync_pull_watch_progress_delta' ? (isProfile ? state.events.filter((e) => e.event_id > body.p_since_event_id).slice(0, body.p_limit) : [])
      : method === 'sync_pull_watched_items_delta' ? (isProfile ? state.watchedEvents.filter((e) => e.event_id > body.p_since_event_id).slice(0, body.p_limit) : [])
      : method === 'sync_pull_profile_settings_blob' ? [{ settings_json: state.settings, updated_at: null }]
      : [];
    await route.fulfill({ json: result });
  });
  await page.route(`${addon}/**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    let json: unknown = {};
    if (path === '/manifest.json') json = { id: 'watching', name: 'Watching Catalog', version: '1.0.0', types: options.movie ? ['series', 'movie'] : ['series'], resources: ['catalog', 'meta', 'stream', ...(options.subtitles ? ['subtitles'] : [])], catalogs: [{ id: 'shows', type: 'series', name: 'Test shows' }] };
    else if (path.startsWith('/catalog/')) json = { metas: [{ id: showId, type: 'series', name: 'Test Series' }, ...(options.movie ? [{ id: 'tt-movie', type: 'movie', name: 'Test Movie' }] : [])] };
    else if (path === '/meta/movie/tt-movie.json') json = { meta: { id: 'tt-movie', type: 'movie', name: 'Test Movie' } };
    else if (path.startsWith('/meta/')) json = { meta: { id: showId, type: 'series', name: 'Test Series', videos: Array.from({ length: 6 }, (_, i) => ({ id: `${showId}:1:${i + 1}`, season: 1, episode: i + 1, title: `Episode ${i + 1}` })) } };
    else if (path.startsWith('/stream/')) json = { streams: [{ name: 'Test source', url: 'https://watching-media.test/episode.mp4' }] };
    else if (path.startsWith('/subtitles/')) { state.subtitleRequests.push(path); json = { subtitles: [{ id: 'same-id', lang: 'eng', url: 'https://watching-subs.test/english.srt' }, { id: 'same-id', lang: 'spa', url: 'https://watching-subs.test/spanish.vtt' }] }; }
    return route.fulfill({ json });
  });
  await page.route('https://watching-media.test/**', (route) => route.abort());
  await page.route('https://watching-subs.test/**', (route) => {
    state.fileRequests.push(route.request().url());
    return route.fulfill({ status: state.failSubtitle ? 503 : 200, contentType: 'text/plain', body: '1\n00:00:01,000 --> 00:00:05,000\nHello <i>world</i>\n\n2\n00:00:10,000 --> 00:00:15,000\nAfter seeking' });
  });
  if (options.native) await page.route('**/*element*slim*.js*', (route) => route.abort());
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Test shows', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watching options for Test Series', exact: true })).toBeVisible();
  return state;
}
export async function browserPlayer(page: Page) {
  await page.getByRole('button', { name: 'View details for Test Series', exact: true }).first().click();
  // The first card is Continue Watching and goes directly to the saved episode.
  await expect(page.getByRole('dialog', { name: 'Streams for Test Series' })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const player = page.getByRole('dialog', { name: 'Now playing Test Series' });
  await expect(player).toBeVisible(); return player;
}
export async function report(page: Page, position: number, event = 'pause') {
  await page.locator('.player-stage > movi-player, .player-stage > video').evaluate((node, value) => {
    Object.defineProperties(node, { currentTime: { configurable: true, value: value.position }, duration: { configurable: true, value: 3000 } });
    node.dispatchEvent(new Event(value.event));
  }, { position, event });
}
