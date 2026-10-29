import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedStreamLookup, STREAM_CACHE_MS } from '../src/lib/stream-cache.ts';

test('stream lookups share an in-flight request and reuse its result', async () => {
  let calls = 0;
  const load = async () => { calls++; return [{ addonName: 'A', addonUrl: 'a', url: 'https://example.com/video' }]; };
  const [first, second] = await Promise.all([
    cachedStreamLookup('shared-stream', load), cachedStreamLookup('shared-stream', load)
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(await cachedStreamLookup('shared-stream', load), first);
  assert.equal(calls, 1);
});

test('force refresh replaces the cached stream result', async () => {
  let calls = 0;
  const load = async () => [{ addonName: 'A', addonUrl: 'a', url: `https://example.com/${++calls}` }];
  await cachedStreamLookup('refresh-stream', load);
  const fresh = await cachedStreamLookup('refresh-stream', load, true);
  assert.equal(fresh[0].url, 'https://example.com/2');
  assert.equal((await cachedStreamLookup('refresh-stream', load))[0].url, fresh[0].url);
  assert.equal(calls, 2);
});

test('cached streams expire after five minutes', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    let calls = 0;
    const load = async () => [{ addonName: 'A', addonUrl: 'a', url: `https://example.com/${++calls}` }];
    await cachedStreamLookup('expiring-stream', load);
    now += STREAM_CACHE_MS + 1;
    assert.equal((await cachedStreamLookup('expiring-stream', load))[0].url, 'https://example.com/2');
  } finally { Date.now = originalNow; }
});

test('a partial lookup marked unsuccessful can be retried', async () => {
  let calls = 0;
  const load = async () => { calls++; return []; };
  await cachedStreamLookup('failed-stream', load, false, () => false);
  await cachedStreamLookup('failed-stream', load);
  assert.equal(calls, 2);
});

test('an aborted pending prefetch cannot poison the next lookup or replace its result', async () => {
  const { cachedStreamLookup } = await import('../src/lib/stream-cache.ts');
  const controller = new AbortController();
  let release;
  const old = cachedStreamLookup('cancelled-prefetch', () => new Promise((resolve) => { release = resolve; }), false, undefined, controller.signal);
  controller.abort();
  const fresh = [{ name: 'Fresh', addonName: 'Test', addonUrl: 'test', url: 'https://media.test/fresh.mp4' }];
  assert.equal(await cachedStreamLookup('cancelled-prefetch', async () => fresh), fresh);
  release([]); await old;
  assert.equal(await cachedStreamLookup('cancelled-prefetch', async () => []), fresh);
});
