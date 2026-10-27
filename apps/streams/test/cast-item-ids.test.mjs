import assert from 'node:assert/strict';
import test from 'node:test';
import { CastItemIds } from '../src/lib/cast-item-ids.ts';
import { castMovie, directCast, lazyCastSeries, stopLinkedCast } from '../src/lib/cast.ts';

const longId = (name) => `sample-${name}-${'episode-data-'.repeat(36)}`;
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const addon = { manifestUrl: 'https://cast-ids.test/manifest.json', manifest: {
  id: 'cast-id-fixture', name: 'Cast ID Fixture', version: '1.0.0', types: ['movie', 'series'], resources: ['stream', 'subtitles']
} };
const stream = { addonName: addon.manifest.name, addonUrl: addon.manifestUrl, url: 'https://media.test/episode.mp4' };
const movie = (id) => ({ id, type: 'movie', name: 'Sample Movie' });
const options = { destinationId: 'test-destination', addons: [addon] };

function bridge() {
  const calls = [];
  const session = new EventTarget();
  session.sessionId = 'test-session';
  session.provideItems = async (requestId, result) => { calls.push({ method: 'provideItems', payload: { requestId, ...result } }); };
  session.unlink = async () => { session.dispatchEvent(new CustomEvent('ended')); };
  const api = {
    capabilities: { playback: 1, linkedCast: 1 },
    cast(payload) { calls.push({ method: 'cast', payload }); },
    async play(payload) { calls.push({ method: 'play', payload }); return session; },
    async linkCast(payload) { calls.push({ method: 'linkCast', payload }); return session; }
  };
  globalThis.window = { __bridgedTest: { playbridge: api } };
  return { calls, session, api };
}
function progress(session, items, currentIndex = 0) {
  session.dispatchEvent(new CustomEvent('statechange', { detail: { currentIndex, items, state: 'playing', positionMs: 30_000, durationMs: 300_000 } }));
}
async function until(predicate) {
  for (let count = 0; count < 1000 && !predicate(); count += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(predicate(), 'Expected playback callback');
}
function addonFetch(emptyFirstId) {
  const lookups = [];
  globalThis.fetch = async (raw) => {
    const parts = new URL(String(raw)).pathname.split('/');
    const resource = parts[1];
    const id = decodeURIComponent(parts[3].replace(/\.json$/, ''));
    lookups.push({ resource, id });
    if (resource === 'subtitles') return Response.json({ subtitles: [] });
    const empty = id === emptyFirstId && lookups.filter((lookup) => lookup.resource === 'stream' && lookup.id === id).length === 1;
    return Response.json({ streams: empty ? [] : [{ name: 'Episode Source', url: stream.url }] });
  };
  return lookups;
}

test.afterEach(async () => {
  await stopLinkedCast();
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
});

test('ids at or below 128 characters stay unchanged', () => {
  for (const id of ['tt100', 'sample-series:1:2', 'x'.repeat(128)]) {
    const ids = new CastItemIds([id]);
    assert.equal(ids.bridgeId(id), id);
    assert.equal(ids.originalId(id), id);
  }
});

test('long ids have bounded, deterministic, distinct stand-ins and reversible echoes', () => {
  const values = ['x'.repeat(129), longId('first'), longId('second'), '🦊'.repeat(100)];
  const ids = new CastItemIds(values);
  const aliases = values.map((id) => ids.bridgeId(id));
  assert.equal(new Set(aliases).size, values.length);
  for (const [index, id] of values.entries()) {
    assert.ok(aliases[index].length <= 128);
    assert.equal(new CastItemIds([id]).bridgeId(id), aliases[index]);
    assert.equal(ids.originalId(aliases[index]), id);
  }
  assert.equal(ids.originalId('unmapped-short-id'), 'unmapped-short-id');
});

test('a real short id cannot collide with a generated alias, regardless of queue order', () => {
  const id = longId('collision');
  const short = new CastItemIds([id]).bridgeId(id);
  for (const queue of [[id, short], [short, id]]) {
    const ids = new CastItemIds(queue);
    assert.equal(ids.bridgeId(short), short);
    assert.notEqual(ids.bridgeId(id), short);
    assert.equal(ids.originalId(ids.bridgeId(id)), id);
    assert.equal(ids.originalId(short), short);
  }
});

test('direct casts and the legacy movie fallback never send the full long id', async () => {
  const { calls, api } = bridge();
  const id = longId('direct-movie');
  directCast(movie(id), stream);
  api.capabilities.linkedCast = 0;
  assert.equal(await castMovie(movie(id), stream, 0), false);
  assert.deepEqual(calls.map((call) => call.method), ['cast', 'cast']);
  for (const call of calls) {
    assert.ok(call.payload.id.length <= 128);
    assert.notEqual(call.payload.id, id);
    assert.equal(JSON.stringify(call.payload).includes(id), false);
  }
  assert.equal(calls[0].payload.id, calls[1].payload.id);
});

for (const modern of [false, true]) {
  test(`${modern ? 'native' : 'linked'} movie progress uses the original id, including terminal progress`, async () => {
    const { calls, session } = bridge();
    const id = longId(modern ? 'native-movie' : 'linked-movie');
    const points = [];
    const lookups = addonFetch();
    await castMovie(movie(id), stream, 12_000, (point) => points.push(point), modern ? options : undefined);
    const item = calls[0].payload.items[0];
    assert.equal(calls[0].method, modern ? 'play' : 'linkCast');
    assert.ok(item.id.length <= 128);
    assert.equal(item.startPositionMs, 12_000);
    assert.equal(JSON.stringify(calls).includes(id), false);
    if (modern) assert.deepEqual(lookups, [{ resource: 'subtitles', id }]);
    progress(session, [item]);
    assert.equal(points[0].videoId, id);
    await stopLinkedCast();
    assert.equal(points.at(-1).videoId, id);
    assert.equal(points.at(-1).state, 'stopped');
  });
}

test('a mixed series queue keeps unique bridge ids and real ids for subtitles, lookups and progress', async () => {
  const { calls, session } = bridge();
  const second = longId('queue-second');
  const fourth = longId('queue-fourth');
  const third = new CastItemIds([second]).bridgeId(second);
  const originals = ['sample-series:1:1', second, third, fourth];
  const videos = originals.map((id, index) => ({ id, season: 1, episode: index + 1 }));
  const meta = { id: 'sample-series', type: 'series', name: 'Sample Series', videos };
  const lookups = addonFetch();
  const points = [];
  await lazyCastSeries(meta, [...videos, videos[1]], videos[0], stream, [addon], [], '', 0, () => {}, (point) => points.push(point), undefined, options);
  const first = calls[0].payload.items[0];
  assert.equal(first.id, originals[0]);
  session.dispatchEvent(new CustomEvent('needitems', { detail: { requestId: 'queue-demand', count: 10 } }));
  await until(() => calls.some((call) => call.method === 'provideItems'));
  const supplied = calls.find((call) => call.method === 'provideItems').payload;
  assert.equal(supplied.requestId, 'queue-demand');
  assert.equal(supplied.endOfList, true);
  assert.equal(supplied.items.length, 3);
  const items = [first, ...supplied.items];
  assert.equal(new Set(items.map((item) => item.id)).size, 4);
  assert.ok(items.every((item) => item.id.length <= 128));
  assert.equal(items[2].id, third);
  assert.notEqual(items[1].id, third);
  assert.deepEqual(lookups.filter((lookup) => lookup.resource === 'stream').map((lookup) => lookup.id), originals.slice(1));
  assert.deepEqual(lookups.filter((lookup) => lookup.resource === 'subtitles').map((lookup) => lookup.id), originals);
  for (const index of [0, 1, 2, 3]) progress(session, items, index);
  assert.deepEqual(points.map((point) => point.videoId), originals);
  assert.equal(JSON.stringify(calls).includes(second), false);
  assert.equal(JSON.stringify(calls).includes(fourth), false);
});

test('retrying a long next-episode id re-fetches the real id and supplies a stable bridge id', async () => {
  const { calls, session } = bridge();
  const next = longId('retry-episode');
  const videos = [{ id: 'retry-series:1:1', season: 1, episode: 1 }, { id: next, season: 1, episode: 2 }];
  const meta = { id: 'retry-series', type: 'series', name: 'Retry Series', videos };
  const lookups = addonFetch(next);
  const statuses = [];
  const points = [];
  await lazyCastSeries(meta, videos, videos[0], stream, [addon], [], '', 0, (status) => statuses.push(status), (point) => points.push(point));
  const demand = () => session.dispatchEvent(new CustomEvent('needitems', { detail: { requestId: 'retry-demand', count: 1 } }));
  demand();
  await until(() => statuses.some((status) => status.includes('will retry')));
  assert.equal(calls.filter((call) => call.method === 'provideItems').length, 0);
  demand();
  await until(() => calls.some((call) => call.method === 'provideItems'));
  const item = calls.find((call) => call.method === 'provideItems').payload.items[0];
  assert.equal(lookups.filter((lookup) => lookup.resource === 'stream' && lookup.id === next).length, 2);
  assert.equal(item.id, new CastItemIds([next]).bridgeId(next));
  progress(session, [item]);
  assert.equal(points.at(-1).videoId, next);
});
