import test from 'node:test';
import assert from 'node:assert/strict';
import { nuvioSeriesAction, nuvioTimestamp, nuvioWatchingItems, nuvioWatchingTargets } from '../src/lib/nuvio-watching.ts';

const meta = { id: 'show', type: 'series', name: 'Show', videos: [
  { id: 'addon:1:4', season: 1, episode: 4 },
  { id: 'addon:1:5', season: 1, episode: 5 },
  { id: 'addon:1:6', season: 1, episode: 6 },
  { id: 'addon:2:1', season: 2, episode: 1, released: '2020-01-01' }
] };
const progress = (episode, position, last_watched = 1700000000000) => ({
  content_id: 'show', content_type: 'series', progress_key: `show:1:${episode}`,
  video_id: `different-addon:1:${episode}`, season: 1, episode, position,
  duration: 3000000, last_watched
});
const watched = (episode, watched_at = 1700000000000) => ({
  content_id: 'show', content_type: 'series', season: 1, episode, watched_at
});

test('completion starts at 90% without rounding and tiny positive progress still resumes', () => {
  assert.equal(nuvioSeriesAction(meta, [progress(4, 2699999)]).kind, 'resume');
  const action = nuvioSeriesAction(meta, [progress(4, 2700000)]);
  assert.equal(action.kind, 'next-up');
  assert.equal(action.video.id, 'addon:1:5');
  assert.equal(action.positionMs, 0);
  assert.equal(nuvioSeriesAction(meta, [progress(4, 29)]).positionMs, 29);
});

test('newly completed episodes replace old partial progress; a newer rewatch resumes', () => {
  const entries = [progress(4, 60000), progress(5, 3000000, 1700000001000)];
  assert.equal(nuvioSeriesAction(meta, entries).video.episode, 6);
  assert.equal(nuvioSeriesAction(meta, [...entries, progress(4, 120000, 1700000002000)]).video.episode, 4);
});

test('furthest completed episode determines Next up even when an earlier episode was watched more recently', () => {
  const action = nuvioSeriesAction(meta, [], [watched(5), watched(4, 1700000002000)]);
  assert.equal(action.video.episode, 6);
});

test('manual watched history overrides older progress while newer progress starts a rewatch', () => {
  const action = nuvioSeriesAction(meta, [progress(4, 60000)], [watched(4, 1700000001000)]);
  assert.equal(action.kind, 'next-up');
  assert.equal(action.video.episode, 5);
  assert.equal(nuvioSeriesAction(meta, [progress(4, 60000, 1700000002000)], [watched(4)]).kind, 'resume');
});

test('coordinates can come from a different provider video ID and next episodes follow season/episode order', () => {
  const entry = progress(4, 3000000);
  delete entry.season;
  delete entry.episode;
  const action = nuvioSeriesAction({ ...meta, videos: [...meta.videos].reverse() }, [entry]);
  assert.equal(action.video.id, 'addon:1:5');
});

test('completed shows and missing watched seeds never resurrect old partial progress', () => {
  const finished = { ...meta, videos: meta.videos.slice(0, 3) };
  assert.equal(nuvioSeriesAction(finished, [progress(4, 50000), progress(6, 3000000, 1700000001000)]), null);
  assert.equal(nuvioSeriesAction({ ...meta, videos: meta.videos.slice(1) }, [progress(4, 3000000)]), null);
});

test('Next up skips specials, unavailable episodes, duplicate coordinates and future dates', () => {
  const candidates = { ...meta, videos: [meta.videos[0], meta.videos[0],
    { id: 'special', season: 0, episode: 2 },
    { ...meta.videos[1], available: false },
    { ...meta.videos[2], released: '2099-01-01' }, meta.videos[3]
  ] };
  assert.equal(nuvioSeriesAction(candidates, [progress(4, 3000000)]).video.id, 'addon:2:1');
});

test('new seasons require a known past release date, while same-season episodes can omit dates', () => {
  assert.equal(nuvioSeriesAction(meta, [progress(6, 3000000)]).video.season, 2);
  for (const released of [undefined, 'invalid', '2099-01-01']) {
    assert.equal(nuvioSeriesAction({ ...meta, videos: [...meta.videos.slice(0, 3), { ...meta.videos[3], released }] }, [progress(6, 3000000)]), null);
  }
  assert.equal(nuvioSeriesAction(meta, [progress(4, 3000000)]).video.episode, 5);
});

test('watched history timestamps support legacy compact values, epoch seconds and milliseconds', () => {
  const stamp = Date.parse('2024-01-02T03:04:05Z');
  assert.equal(nuvioTimestamp(20240102030405), stamp);
  assert.equal(nuvioTimestamp(stamp / 1000), stamp);
  assert.equal(nuvioTimestamp(stamp), stamp);
  assert.equal(nuvioTimestamp(20240230030405), 0);
  assert.equal(nuvioTimestamp(NaN), 0);
  assert.equal(nuvioTimestamp(1e16), 0);
  assert.equal(nuvioTimestamp(-1), 0);
});

test('only unfinished movies are included, including ones outside the library', () => {
  const entry = { ...progress(4, 29), content_id: 'movie', content_type: 'movie', season: null, episode: null };
  const preview = { id: 'movie', type: 'movie', name: 'Movie' };
  assert.equal(nuvioWatchingItems([entry], [], [preview], new Map()).length, 1);
  assert.equal(nuvioWatchingTargets([{ ...entry, position: 3000000 }], []).length, 0);
  assert.equal(nuvioWatchingItems([entry], [{ content_id: 'movie', content_type: 'movie', watched_at: entry.last_watched }], [preview], new Map()).length, 0);
});

test('full episode metadata wins over catalog previews for Next up and keeps zero progress', () => {
  const entries = [progress(4, 3000000)];
  const preview = { id: meta.id, type: meta.type, name: meta.name };
  assert.equal(nuvioWatchingItems(entries, [], [preview], new Map()).length, 0);
  const items = nuvioWatchingItems(entries, [], [preview], new Map([['series:show', meta]]));
  assert.equal(items[0].nextUp.episode, 5);
  assert.equal(items[0].progress, 0);
  assert.equal(items[0].lastVideoId, 'addon:1:5');
});

test('invalid timestamps, empty positions and unsupported content types do not become cards', () => {
  assert.deepEqual(nuvioWatchingTargets([progress(4, 0), progress(4, NaN), progress(4, 60000, 0)], [
    watched(4, 0), { ...watched(4), content_type: 'channel' }
  ]), []);
});
