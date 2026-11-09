import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeUrl, tokenFromCallback, tokenSession } from '../src/lib/auth.ts';
import { apiBase, imageUrl, instanceUrl, normalizeInstance, videoThumbnail } from '../src/lib/instance.ts';
import { AutoplayQueue, castItem, loadAutoplay, mediaPlan, PlaylistPager, ProgressStore, saveAutoplay, videoIdFromItem } from '../src/lib/playback.ts';
import { linkTarget, parseRoute, routeHash } from '../src/lib/router.ts';

const instance = 'http://invidious.test:3000';

test('instance addresses normalize to an origin', () => {
  assert.equal(normalizeInstance('invidious.test:3000/feed'), instance);
  assert.equal(normalizeInstance('https://iv.example/'), 'https://iv.example');
  assert.equal(normalizeInstance('ftp://iv.example'), null);
  assert.equal(normalizeInstance('http://user:pw@iv.example'), null);
  assert.equal(normalizeInstance('  '), null);
});

test('API requests stay same-origin when the page is served beside or relays the instance', () => {
  assert.equal(apiBase(instance, instance, ''), instance);
  assert.equal(apiBase(instance, 'http://mac.test:5184', 'http://invidious.test:3000/'), 'http://mac.test:5184');
  assert.equal(apiBase(instance, 'http://mac.test:5184', ''), instance);
  assert.equal(apiBase(instance, 'http://mac.test:5184', 'http://other.test'), instance);
});

test('artwork always loads from the instance, never from Google', () => {
  assert.equal(instanceUrl(instance, '/vi/abc/mqdefault.jpg'), `${instance}/vi/abc/mqdefault.jpg`);
  assert.equal(imageUrl(instance, 'https://yt3.ggpht.com/a/b=s88'), `${instance}/ggpht/a/b=s88`);
  assert.equal(imageUrl(instance, '//yt3.googleusercontent.com/x'), `${instance}/ggpht/x`);
  assert.equal(videoThumbnail(instance, 'abc', [{ quality: 'maxres', url: '/vi/abc/maxres.jpg' }, { quality: 'medium', url: '/vi/abc/mqdefault.jpg' }]),
    `${instance}/vi/abc/mqdefault.jpg`);
  assert.equal(videoThumbnail(instance, 'a b'), `${instance}/vi/a%20b/mqdefault.jpg`);
});

test('PlayBridge players get DASH, other receivers the muxed MP4, live videos HLS', () => {
  const video = { videoId: 'dQw4w9WgXcQ' };
  assert.deepEqual(mediaPlan(video, 'native'), { kind: 'dash', path: '/api/manifest/dash/id/dQw4w9WgXcQ?local=true', contentType: 'application/dash+xml' });
  assert.equal(mediaPlan(video, 'local').kind, 'dash');
  assert.deepEqual(mediaPlan(video, 'external'), { kind: 'mp4', path: '/latest_version?id=dQw4w9WgXcQ&itag=18&local=true', contentType: 'video/mp4' });
  assert.equal(mediaPlan(video, 'browser').kind, 'mp4');
  assert.deepEqual(mediaPlan({ ...video, liveNow: true, hlsUrl: '/api/manifest/hls_variant/x' }, 'native'),
    { kind: 'hls', path: '/api/manifest/hls_variant/x?local=true', contentType: 'application/vnd.apple.mpegurl' });
});

test('cast items point at the instance and carry captions and resume', () => {
  const video = {
    videoId: 'abc', title: 'Title', author: 'Channel', authorId: 'UC1', lengthSeconds: 60,
    description: 'About', captions: [{ label: 'English', language_code: 'en', url: '/api/v1/captions/abc?label=English' }]
  };
  const plan = mediaPlan(video, 'native');
  const item = castItem(instance, video, '/companion/api/manifest/dash/id/abc?local=true', plan, 42_500.7);
  assert.equal(item.id, 'iv:abc');
  assert.equal(item.url, `${instance}/companion/api/manifest/dash/id/abc?local=true`);
  assert.equal(item.contentType, 'application/dash+xml');
  assert.equal(item.startPositionMs, 42_500);
  assert.deepEqual(item.subtitleResources, [{ url: `${instance}/api/v1/captions/abc?label=English`, language: 'en', label: 'English' }]);
  assert.equal(item.metadata.artist, 'Channel');
  assert.equal(castItem(instance, { ...video, captions: [] }, '/x', plan).startPositionMs, undefined);
  assert.equal(videoIdFromItem('iv:abc'), 'abc');
  assert.equal(videoIdFromItem('other'), null);
});

test('autoplay continues a playlist in order, then stops', () => {
  const list = ['a', 'b', 'c'].map((videoId) => ({ videoId }));
  const queue = new AutoplayQueue(list, 'a');
  assert.equal(queue.next(), 'b');
  assert.equal(queue.next(), 'c');
  assert.equal(queue.next([{ videoId: 'z' }]), null);
});

test('autoplay without a playlist follows related videos, skipping repeats and live streams', () => {
  const queue = new AutoplayQueue([], 'a');
  assert.equal(queue.next([{ videoId: 'a' }, { videoId: 'live', liveNow: true }, { videoId: 'b' }]), 'b');
  assert.equal(queue.next([{ videoId: 'a' }, { videoId: 'b' }, { videoId: 'c' }]), 'c');
  assert.equal(queue.next([{ videoId: 'a' }]), null);
});

test('resume skips the first seconds and nearly finished videos', () => {
  const data = new Map();
  const store = new ProgressStore({ getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) });
  store.save('short', 5_000, 100_000, undefined, 1);
  store.save('mid', 50_000, 100_000, { videoId: 'mid', title: 'Mid', author: 'A', authorId: 'UC', lengthSeconds: 100 }, 2);
  store.save('done', 97_000, 100_000, undefined, 3);
  store.save('bad', Number.NaN, 100_000);
  assert.equal(store.resumeMs('short'), 0);
  assert.equal(store.resumeMs('mid'), 50_000);
  assert.equal(store.resumeMs('done'), 0);
  assert.equal(store.get('bad'), undefined);
  assert.deepEqual(store.continueWatching().map((video) => video.videoId), ['mid']);
});

test('sign-in requests the needed scopes and accepts only a real token back', () => {
  const url = new URL(authorizeUrl(instance, 'http://mac.test:5184/'));
  assert.equal(url.origin + url.pathname, `${instance}/authorize_token`);
  assert.equal(url.searchParams.get('callback_url'), 'http://mac.test:5184/');
  assert.ok(url.searchParams.get('scopes').includes('GET:feed'));
  const token = JSON.stringify({ session: 'v1:abc', scopes: ['GET:feed'], signature: 'sig' });
  assert.equal(tokenFromCallback(`?token=${encodeURIComponent(token)}`), token);
  assert.equal(tokenSession(token), 'v1:abc');
  assert.equal(tokenFromCallback('?token=not-json'), null);
  assert.equal(tokenFromCallback(''), null);
});

test('routes round-trip and reject unsafe ids', () => {
  for (const route of [
    { kind: 'tab', tab: 'home' }, { kind: 'tab', tab: 'library' }, { kind: 'search', query: 'lofi beats' },
    { kind: 'watch', id: 'dQw4w9WgXcQ' }, { kind: 'watch', id: 'abc', list: 'PL123' },
    { kind: 'channel', id: 'UCabc' }, { kind: 'playlist', id: 'PL1' }
  ]) assert.deepEqual(parseRoute(routeHash(route)), route);
  assert.deepEqual(parseRoute('#/watch/<script>'), { kind: 'tab', tab: 'home' });
  assert.deepEqual(parseRoute('#/nowhere'), { kind: 'tab', tab: 'home' });
});

test('with autoplay off, related videos never queue but playlists still continue', () => {
  const related = [{ videoId: 'b' }];
  assert.equal(new AutoplayQueue([], 'a', false).next(related), null);
  const playlist = new AutoplayQueue([{ videoId: 'a' }, { videoId: 'b' }], 'a', false);
  assert.equal(playlist.next(related), 'b');
  assert.equal(playlist.next(related), null);
});

test('autoplay is off until the user turns it on', () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  assert.equal(loadAutoplay(storage), false);
  saveAutoplay(true, storage);
  assert.equal(loadAutoplay(storage), true);
  saveAutoplay(false, storage);
  assert.equal(loadAutoplay(storage), false);
  assert.equal(loadAutoplay(null), false);
});

test('pasted YouTube and Invidious links open their page', () => {
  const route = (text) => linkTarget(text)?.route;
  assert.deepEqual(route('https://youtube.com/playlist?list=PLuEcLy7QzdggKFctawsqMETLPDdiT6X4_&si=ubAV6uEy8d-51IMm'),
    { kind: 'playlist', id: 'PLuEcLy7QzdggKFctawsqMETLPDdiT6X4_' });
  assert.deepEqual(route('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&t=42'), { kind: 'watch', id: 'dQw4w9WgXcQ', list: 'PL1' });
  assert.deepEqual(route('youtu.be/dQw4w9WgXcQ?si=abc'), { kind: 'watch', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(route('https://m.youtube.com/shorts/abc123'), { kind: 'watch', id: 'abc123' });
  assert.deepEqual(route('https://music.youtube.com/watch?v=xyz'), { kind: 'watch', id: 'xyz' });
  assert.deepEqual(route('http://192.0.2.10:3000/watch?v=dQw4w9WgXcQ'), { kind: 'watch', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(route('https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw/videos'), { kind: 'channel', id: 'UCuAXFkgsw1L7xaCfnd5JJOw' });
  assert.deepEqual(linkTarget('https://www.youtube.com/@LofiGirl/streams'), { resolve: 'https://www.youtube.com/@LofiGirl' });
  assert.deepEqual(linkTarget('https://youtube.com/c/Name/videos'), { resolve: 'https://www.youtube.com/c/Name' });
  assert.equal(linkTarget('lofi beats'), null);
  assert.equal(linkTarget('https://example.com/article'), null);
  assert.equal(linkTarget('https://youtube.com/watch?v=<script>'), null);
});

test('playlist pages merge by position, despite overlapping pages', async () => {
  // Pages overlap the way Invidious serves them: each restarts 50 videos back.
  const all = Array.from({ length: 250 }, (_, index) => ({ videoId: `v${index}`, index }));
  const fetched = [];
  const fetchPage = async (page) => {
    fetched.push(page);
    const start = page === 1 ? 0 : (page - 1) * 100 - 50;
    return { videoCount: 250, videos: all.slice(start, start + 200) };
  };
  const pager = new PlaylistPager(fetchPage, await fetchPage(1));
  assert.equal(pager.videos.length, 200);
  assert.equal(pager.done, false);
  assert.equal(await pager.find('v240'), true);
  assert.deepEqual(pager.videos.map((video) => video.index), all.map((video) => video.index));
  assert.equal(pager.done, true);
  assert.deepEqual(await pager.more(), []);
  assert.deepEqual(fetched, [1, 2]);
});

test('a growing playlist extends the autoplay queue', async () => {
  const videos = [{ videoId: 'a' }, { videoId: 'b' }];
  const queue = new AutoplayQueue(() => videos, 'a', false);
  assert.equal(queue.next(), 'b');
  assert.equal(queue.next(), null);
  videos.push({ videoId: 'c' });
  assert.equal(queue.next(), 'c');
});
