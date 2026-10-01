import test from 'node:test';
import assert from 'node:assert/strict';
import { deltaSync, updateDeltaSnapshot } from '../src/lib/delta-sync.ts';
import { queuePlaybackWrite, pendingPlaybackWrites, acknowledgePlaybackWrite, discardPlaybackWrites, clearAccountPlaybackWrites, playbackPosition, progressEntry } from '../src/lib/playback-outbox.ts';
import { episodeWatched, watchedItem, visibleWatching, watchingDismissals, saveWatchingDismissals } from '../src/lib/watching-controls.ts';
import { parseSubtitles, subtitlesVtt, loadSubtitleCues } from '../src/lib/subtitle-cues.ts';

const storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
test.beforeEach(() => storage.clear());
const record = { id: 'episode', position: 10 };
const api = (overrides = {}) => ({ full: async () => [record], cursor: async () => 5, delta: async () => [], key: (item) => item.id, valid: (item) => !!item && typeof item.id === 'string' && Number.isFinite(item.position), ...overrides });

test('captures cursor before full snapshot, replays concurrent changes, then persists and resumes the cursor', async () => {
  const calls = [];
  const source = api({ cursor: async () => { calls.push('cursor'); return 5; }, full: async () => { calls.push('full'); return [record]; }, delta: async (cursor) => { calls.push(cursor); return cursor === 5 ? [{ ...record, position: 20, event_id: 6, operation: 'UPSERT' }] : []; } });
  assert.equal((await deltaSync('profile2', 'progress', source))[0].position, 20);
  assert.deepEqual(calls, ['cursor', 'full', 5]);
  calls.length = 0;
  await deltaSync('profile2', 'progress', source);
  assert.deepEqual(calls, [6]);
});

test('delta deletes, pagination, and profile scope stay independent', async () => {
  let calls = 0;
  const source = api({ delta: async (cursor) => { calls++; return cursor === 5 ? Array.from({ length: 100 }, (_, i) => ({ id: `e${i}`, position: i, event_id: 6 + i, operation: 'insert' })) : [{ id: 'episode', event_id: 106, operation: 'delete' }]; } });
  const result = await deltaSync('one', 'watched', source);
  assert.equal(result.length, 100); assert.equal(calls, 2);
  assert.deepEqual(await deltaSync('two', 'watched', api()), [record]);
});

test('unsupported delta backend throttles full pulls during polling but manual sync refreshes', async () => {
  let pulls = 0;
  const source = api({ cursor: async () => { throw new Error('unsupported'); }, full: async () => { pulls++; return [record]; } });
  await deltaSync('one', 'progress', source);
  await deltaSync('one', 'progress', source, false);
  assert.equal(pulls, 1);
  await deltaSync('one', 'progress', source);
  assert.equal(pulls, 2);
});

test('malformed events fall back atomically; failed full pulls leave the old cursor intact', async () => {
  await deltaSync('one', 'progress', api());
  const before = storage.get('bridged-streams.delta.v1.progress:one');
  await assert.rejects(deltaSync('one', 'progress', api({ delta: async () => [{ ...record, event_id: 5, operation: 'upsert' }], full: async () => { throw new Error('offline'); } })), /offline/);
  assert.equal(storage.get('bridged-streams.delta.v1.progress:one'), before);
  assert.deepEqual(await deltaSync('one', 'progress', api({ delta: async () => [{ ...record, event_id: 5, operation: 'invalid' }] })), [record]);
  assert.equal(JSON.parse(storage.get('bridged-streams.delta.v1.progress:one')).cursor, null);
});

test('own successful writes update records without skipping server events', async () => {
  await deltaSync('one', 'progress', api());
  updateDeltaSnapshot('one', 'progress', (r) => r.id, [{ ...record, position: 30 }]);
  const value = JSON.parse(storage.get('bridged-streams.delta.v1.progress:one'));
  assert.equal(value.cursor, 5); assert.equal(value.records[0].position, 30);
});

test('outbox coalesces progress and old in-flight acknowledgements preserve newer revisions across reloads', () => {
  const write = { kind: 'nuvio-progress', entry: progressEntry({ id: 'show', type: 'series', name: 'Show' }, null, 'show:1:4', 10000, 3000000, 1) };
  const first = queuePlaybackWrite('user:2', 'progress:episode', write, 1);
  const latest = queuePlaybackWrite('user:2', 'progress:episode', { ...write, entry: { ...write.entry, position: 30 } }, 2);
  acknowledgePlaybackWrite(first);
  assert.deepEqual(pendingPlaybackWrites(), [latest]);
  acknowledgePlaybackWrite(latest); assert.deepEqual(pendingPlaybackWrites(), []);
});

test('deletion and disconnect only discard the requested scope and keys', () => {
  const write = { kind: 'nuvio-reset', progressKeys: ['episode'] };
  queuePlaybackWrite('user:1', 'one', write); queuePlaybackWrite('user:2', 'two', write); queuePlaybackWrite('other:1', 'one', write);
  discardPlaybackWrites('user:1', ['missing']); assert.equal(pendingPlaybackWrites().length, 3);
  discardPlaybackWrites('user:1', ['one']); assert.equal(pendingPlaybackWrites().length, 2);
  clearAccountPlaybackWrites('user:'); assert.equal(pendingPlaybackWrites()[0].scope, 'other:1');
});

test('storage failures surface rather than claiming a durable save', () => {
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('quota'); };
  try { assert.throws(() => queuePlaybackWrite('one', 'key', { kind: 'nuvio-reset', progressKeys: [] }), /could not be queued safely/); }
  finally { localStorage.setItem = original; }
});

test('progress normalizes completion, rejects invalid and placeholder clips, and retains episode identity', () => {
  assert.deepEqual(playbackPosition(200000, 3000000, 'ended'), { position: 3000000, duration: 3000000 });
  assert.equal(playbackPosition(1000, 120000, 'ended'), null); assert.equal(playbackPosition(Infinity, 3000000, 'playing'), null);
  assert.deepEqual(progressEntry({ id: 'show', type: 'series', name: 'Show' }, null, 'provider:2:7', 2000, 3000000, 50), { progress_key: 'show_s2e7', content_id: 'show', content_type: 'series', video_id: 'provider:2:7', season: 2, episode: 7, position: 2000, duration: 3000000, last_watched: 50 });
});

test('watched status supports completion and imported compact timestamps; dismissal lifts on newer activity', () => {
  const meta = { id: 'show', type: 'series', name: 'Show' }, video = { id: 'show:1:4', season: 1, episode: 4 };
  const marker = watchedItem(meta, video, 20240102030405);
  assert.equal(episodeWatched(meta, video, [], [marker]), true);
  assert.equal(episodeWatched(meta, { ...video, episode: 5 }, [], [marker]), false);
  saveWatchingDismissals('one', { 'series:show': 1000 });
  assert.equal(visibleWatching({ ...meta, lastWatched: new Date(1000).toISOString() }, watchingDismissals('one')), false);
  assert.equal(visibleWatching({ ...meta, lastWatched: new Date(1001).toISOString() }, watchingDismissals('one')), true);
  assert.equal(visibleWatching(meta, watchingDismissals('two')), true);
});

test('SRT/VTT parsing handles BOM, CRLF, identifiers, settings, markup and safe entities', () => {
  const cues = parseSubtitles('\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> &amp; &#x1f600;\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nSecond');
  assert.deepEqual(cues, [{ start: 1, end: 2.5, text: 'Hello & 😀' }, { start: 3, end: 4, text: 'Second' }]);
  assert.deepEqual(parseSubtitles(subtitlesVtt(cues)), cues);
  assert.deepEqual(parseSubtitles('WEBVTT\n\nNOTE ignored\n00:01.000 --> 00:02.000\nBad\n\nid\n00:01.000 --> 00:02.000 align:start\nGood'), [{ start: 1, end: 2, text: 'Good' }]);
  assert.throws(() => parseSubtitles('00:61.000 --> 00:62.000\nInvalid'), /No usable/);
});

test('subtitle loading rejects failed or oversized responses', async () => {
  const fetchBefore = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('no', { status: 403 });
    await assert.rejects(loadSubtitleCues('https://sub.test', new AbortController().signal), /403/);
    globalThis.fetch = async () => new Response('x', { headers: { 'content-length': '2000001' } });
    await assert.rejects(loadSubtitleCues('https://sub.test', new AbortController().signal), /too large/);
  } finally { globalThis.fetch = fetchBefore; }
});


test('invalid persisted payloads are ignored before replaying cloud mutations', () => {
  storage.set('bridged-streams.playback-outbox.v1', JSON.stringify([{ scope: 'user:2', key: 'broken', revision: 'old', observedAt: 1, write: { kind: 'nuvio-progress', entry: null } }]));
  assert.deepEqual(pendingPlaybackWrites(), []);
  assert.throws(() => queuePlaybackWrite('user:2', 'broken', { kind: 'nuvio-progress', entry: {} }), /Invalid watching/);
});
