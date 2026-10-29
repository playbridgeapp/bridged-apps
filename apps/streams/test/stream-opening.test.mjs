import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamLookups } from '../src/lib/stream-lookups.ts';
import { OpeningCandidates } from '../src/lib/opening-candidates.ts';
import { defaultStreamSelection, normalizeStreamSelection, evaluateAutoPlay, rankAutoPlayCandidates } from '../src/lib/stream-selection.ts';
import { detailPlayEpisode, resumePositionMs } from '../src/lib/resume.ts';
import { streamFingerprint } from '../src/lib/stream-reuse.ts';

const stream = (name, extra = {}) => ({ name, addonName: 'Provider', addonUrl: 'a', url: `https://media.test/${name}.mp4`, ...extra });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('prefetch is adopted in flight and after completion until the five-minute expiry', async () => {
  let now = 0, calls = 0;
  const pool = new StreamLookups(() => now);
  const gate = deferred();
  const load = async () => { calls++; await gate.promise; return [stream('ready')]; };
  const entry = pool.start('movie:tt1', [{ key: 'a' }], load);
  assert.equal(pool.adopt('movie:tt1'), entry);
  assert.equal(pool.start('movie:tt1', [{ key: 'a' }], load), entry);
  pool.cancelUnadopted();
  assert.equal(entry.controller.signal.aborted, false);
  gate.resolve(); await entry.promise;
  assert.equal(pool.adopt('movie:tt1'), entry);
  assert.equal(calls, 1);
  now = 300_000;
  assert.equal(pool.get('movie:tt1'), undefined);
  assert.notEqual(pool.start('movie:tt1', [{ key: 'a' }], load), entry);
});

test('departure cancels unadopted work, fences late responses and permits a fresh attempt', async () => {
  let cancellations = 0, notifications = 0;
  const pool = new StreamLookups(Date.now, () => cancellations++);
  const gate = deferred();
  const entry = pool.start('series:tt1:e1', [{ key: 'a' }], async () => { await gate.promise; return [stream('late')]; });
  entry.listeners.add(() => notifications++);
  pool.cancelUnadopted(); gate.resolve(); await entry.promise;
  assert.equal(entry.controller.signal.aborted, true);
  assert.equal(pool.get(entry.key), undefined);
  assert.equal(cancellations, 1);
  assert.equal(notifications, 0);
  const retry = pool.start(entry.key, [{ key: 'a' }], async () => [stream('new')]);
  await retry.promise;
  assert.equal(retry.results[0].streams[0].name, 'new');
});

test('source work has bounded concurrency, stable order and appends restored sources once', async () => {
  const pool = new StreamLookups(); const gate = deferred();
  let active = 0, maximum = 0;
  const entry = pool.start('movie:tt1', Array.from({ length: 8 }, (_, index) => ({ key: String(index) })), async (source) => {
    active++; maximum = Math.max(maximum, active); await gate.promise; active--; return [stream(source.key)];
  }, async () => [{ key: '0' }, { key: 'restored' }]);
  assert.equal(active, 4);
  gate.resolve(); await entry.promise;
  assert.equal(maximum, 4);
  assert.deepEqual(entry.results.map((result) => result.source.key), ['0', '1', '2', '3', '4', '5', '6', '7', 'restored']);
});

test('candidate ranking is last link, group, then mode, with three unique attempts and no retry after start', () => {
  const first = stream('first'), reused = stream('reused'), grouped = stream('grouped', { behaviorHints: { bingeGroup: 'group' } });
  const preferences = { ...defaultStreamSelection(), mode: 'first', reuseLastLink: true };
  const candidates = rankAutoPlayCandidates([first, grouped, reused, stream('fourth')], preferences,
    { lastLink: streamFingerprint(reused), preferredBingeGroup: 'group' });
  assert.deepEqual(candidates, [reused, grouped, first]);
  const attempt = new OpeningCandidates(candidates);
  assert.equal(attempt.next(), reused);
  assert.equal(attempt.next(), grouped);
  attempt.markStarted(); assert.equal(attempt.next(), undefined);
  const failed = new OpeningCandidates(candidates);
  assert.deepEqual([failed.next(), failed.next(), failed.next(), failed.next()], [reused, grouped, first, undefined]);
});

test('opening timeout is measured from tap, independent of prefetch age; settled results decide immediately', () => {
  const preferences = { ...defaultStreamSelection(), mode: 'first', timeoutSeconds: 3 };
  const pending = [{ id: 'a', kind: 'addon', loading: true, streams: [] }];
  assert.equal(evaluateAutoPlay(pending, preferences, { startedAt: 10_000, now: 12_999 }).waiting, true);
  assert.equal(evaluateAutoPlay(pending, preferences, { startedAt: 10_000, now: 13_000 }).reason, 'timeout');
  assert.equal(evaluateAutoPlay([{ ...pending[0], loading: false, streams: [stream('ready')] }], preferences,
    { startedAt: 10_000, now: 10_000 }).stream.name, 'ready');
});

test('prefetch and direct-resume settings normalize missing and malformed values', () => {
  assert.equal(normalizeStreamSelection({}).prefetchStreamsOnDetail, true);
  assert.equal(normalizeStreamSelection({}).resumeDirectlyFromContinueWatching, false);
  assert.equal(normalizeStreamSelection({ prefetchStreamsOnDetail: false, resumeDirectlyFromContinueWatching: true }).prefetchStreamsOnDetail, false);
  assert.equal(normalizeStreamSelection({ resumeDirectlyFromContinueWatching: 'true' }).resumeDirectlyFromContinueWatching, false);
});

test('detail action and prefetch share the resume episode, position, explicit selection and initial aired target', () => {
  const meta = { type: 'series', id: 'tt1', name: 'Series', videos: [
    { id: 'special', season: 0, episode: 1 }, { id: 'e1', season: 1, episode: 1 },
    { id: 'e2', season: 2, episode: 5 }, { id: 'future', season: 1, episode: 0, released: '2099-01-01' }
  ] };
  const progress = [{ progress_key: 'tt1_s2e5', content_id: 'tt1', content_type: 'series', video_id: 'other-provider',
    season: 2, episode: 5, position: 1_394_000, duration: 3_000_000, last_watched: 1700000000000 }];
  const target = detailPlayEpisode(meta, null, [], [], progress);
  assert.equal(target.id, 'e2'); assert.equal(resumePositionMs(meta, target, [], progress), 1_394_000);
  assert.equal(detailPlayEpisode(meta, meta.videos[1], [], [], progress).id, 'e1');
  assert.equal(detailPlayEpisode(meta, null, [], [], []).id, 'e1');
});

test('duplicate source declarations are resolved only once', async () => {
  const pool = new StreamLookups(); let calls = 0;
  const entry = pool.start('duplicates', [{ key: 'a' }, { key: 'a' }], async () => { calls++; return []; });
  await entry.promise;
  assert.equal(calls, 1); assert.equal(entry.results.length, 1);
});
