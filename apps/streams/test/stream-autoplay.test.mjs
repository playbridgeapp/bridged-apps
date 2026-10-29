import test from 'node:test';
import assert from 'node:assert/strict';
import { autoPlayEnabled, compileStreamRegex, defaultStreamSelection, evaluateAutoPlay, normalizeStreamSelection, REGEX_PRESETS, selectionContext, selectNextStream, TIMEOUT_SECONDS } from '../src/lib/stream-selection.ts';
import { matchesFingerprint, REUSE_KEY, streamContentKey, streamFingerprint, StreamReuseStore } from '../src/lib/stream-reuse.ts';

const prefs = (extra = {}) => ({ ...defaultStreamSelection(), mode: 'first', ...extra });
const stream = (name, id = 'a', extra = {}) => ({ addonName: id, addonUrl: id, name, url: 'https://media.test/video.mp4', ...extra });
const source = (id, streams = [], loading = false, kind = 'addon') => ({ id, streams, loading, kind });
const evaluate = (sources, settings = prefs(), now = 0, context = {}) => evaluateAutoPlay(sources, settings, { startedAt: 0, now, ...context });

test('v2 defaults, policy, migration and invalid numeric snapping', () => {
  const defaults = defaultStreamSelection();
  assert.equal(defaults.timeoutSeconds, 3);
  assert.equal(defaults.nextEpisodeAutoPlay, true);
  assert.equal(autoPlayEnabled(defaults), false);
  for (const extra of [{ mode: 'first' }, { mode: 'preferences' }, { mode: 'regex', regex: '1080p' }, { reuseLastLink: true }, { reuseBingeGroup: true }]) {
    assert.equal(autoPlayEnabled({ ...defaults, ...extra }), true);
  }
  assert.equal(autoPlayEnabled({ ...defaults, reuseBingeGroup: true, preferBingeGroup: false }), false);
  assert.equal(normalizeStreamSelection({ enabled: false, sortByPreference: true }, true).mode, 'manual');
  assert.equal(normalizeStreamSelection({ enabled: true }, true).mode, 'preferences');
  for (const [input, expected] of [[12, 10], [14, 15], [-1, 0], [100, 30], [NaN, 3], [2147483647, 'unlimited']]) {
    assert.equal(normalizeStreamSelection({ timeoutSeconds: input }).timeoutSeconds, expected);
  }
  assert.equal(normalizeStreamSelection({ lastLinkHours: 9 }).lastLinkHours, 6);
  assert.equal(normalizeStreamSelection({ lastLinkHours: 999 }).lastLinkHours, 168);
  assert.deepEqual(normalizeStreamSelection({ allowedPlugins: ['a', 'a', 7] }).allowedPlugins, ['a']);
});

test('manual, first, preferences and regex preserve provider order and never mutate sources', () => {
  const a = stream('720p'), b = stream('1080p WEB-DL', 'b');
  const sources = [source('a', [a]), source('b', [b])];
  assert.equal(evaluate(sources, prefs({ mode: 'manual' })).reason, 'manual');
  assert.equal(evaluate(sources).stream, a);
  assert.equal(evaluate(sources, prefs({ mode: 'preferences', resolution: '1080p' })).stream, b);
  assert.equal(evaluate(sources, prefs({ mode: 'regex', regex: 'WEB-DL' })).stream, b);
  assert.equal(evaluate(sources, prefs({ mode: 'regex', regex: 'remux' })).reason, 'no-match');
  assert.deepEqual(sources[0].streams, [a]);
});

test('regex searches every requested field case-insensitively and validates all 13 presets', () => {
  for (const field of ['addonName', 'name', 'title', 'description', 'url']) {
    assert.equal(compileStreamRegex('MATCH').matches(stream('other', 'a', { [field]: 'match' })), true);
  }
  for (const pattern of ['', '[', '.*', 'a'.repeat(501)]) assert.ok(compileStreamRegex(pattern).error);
  assert.equal(REGEX_PRESETS.length, 13);
  for (const [, pattern] of REGEX_PRESETS) assert.equal(compileStreamRegex(pattern).error, undefined);
  const exclusion = compileStreamRegex('^(?!.*(cam|ts)).*$');
  assert.equal(exclusion.matches(stream('HD CAM')), false);
  // Whole-word exclusion is applied even when the lookahead itself misses a newline.
  assert.equal(exclusion.matches(stream('1080p\nCAM')), false);
  const wholeWord = compileStreamRegex('^(?!.*\\b(cam|ts)\\b).*$');
  assert.equal(wholeWord.matches(stream('camera cats')), true);
  assert.equal(compileStreamRegex('(?is)hello.+world').matches(stream('hello\nworld')), true);
});

test('scope and allow lists exclude pending providers before timeout and selection', () => {
  const addon = stream('addon');
  const plugin = stream('plugin', 'p', { selectionSource: { id: 'p', kind: 'plugin' } });
  const sources = [source('a', [addon]), source('p', [plugin], false, 'plugin'), source('excluded', [], true)];
  assert.equal(evaluate(sources, prefs({ scope: 'plugins' })).stream, plugin);
  assert.equal(evaluate(sources, prefs({ allowedAddons: ['a'], allowedPlugins: ['missing'] })).stream, addon);
  assert.equal(evaluate(sources, prefs({ scope: 'plugins', allowedPlugins: ['missing'] })).reason, 'no-match');
});

test('each bounded timeout waits until its deadline, then selects or shows the list', () => {
  const ready = stream('ready');
  for (const seconds of TIMEOUT_SECONDS.filter((value) => typeof value === 'number' && value > 0)) {
    const pending = [source('a', [], true), source('b', [ready])];
    assert.equal(evaluate(pending, prefs({ timeoutSeconds: seconds }), seconds * 1000 - 1).waiting, true);
    assert.equal(evaluate(pending, prefs({ timeoutSeconds: seconds }), seconds * 1000).stream, ready);
    assert.equal(evaluate([source('a', [], true)], prefs({ timeoutSeconds: seconds }), seconds * 1000).reason, 'timeout');
    assert.equal(evaluate([source('a', [ready])], prefs({ timeoutSeconds: seconds }), 1).stream, ready);
  }
});

test('instant selects arriving results; Unlimited waits for all eligible sources and has a hard cap', () => {
  const ready = stream('1080p', 'b');
  const pending = [source('a', [], true), source('b', [ready])];
  assert.equal(evaluate(pending, prefs({ timeoutSeconds: 0 })).stream, ready);
  assert.equal(evaluate([source('a', [], true)], prefs({ timeoutSeconds: 0 })).waiting, true);
  assert.equal(evaluate(pending, prefs({ timeoutSeconds: 'unlimited', mode: 'preferences', provider: 'b' }), 59_999).waiting, true);
  assert.equal(evaluate(pending, prefs({ timeoutSeconds: 'unlimited' }), 60_000).reason, 'timeout');
  assert.equal(evaluate([source('b', [ready])], prefs({ timeoutSeconds: 'unlimited' }), 59_999).stream, ready);
  assert.equal(evaluate([source('a', [], true)], prefs({ timeoutSeconds: 0 }), 60_000).reason, 'timeout');
});

test('bounded preferred-provider selection waits only for sources that can outrank a ready match', () => {
  const ready = stream('1080p', 'b');
  const pending = [source('a', [], true), source('b', [ready]), source('c', [], true)];
  assert.equal(evaluate(pending, prefs({ mode: 'preferences', provider: 'b' }), 0, { restoring: true }).stream, ready);
  assert.equal(evaluate(pending, prefs({ mode: 'preferences', provider: 'c' })).waiting, true);
  pending[0].loading = false;
  assert.equal(evaluate(pending, prefs({ mode: 'preferences', provider: 'missing' })).stream, ready);
});

test('refetched fingerprint beats remembered binge group, which beats mode rules', () => {
  const first = stream('first'), group = stream('group', 'b', { behaviorHints: { bingeGroup: 'series' } }), reused = stream('reused', 'c');
  const sources = [source('a', [first]), source('b', [group]), source('c', [reused])];
  const settings = prefs({ reuseLastLink: true });
  assert.equal(evaluate(sources, settings, 0, { preferredBingeGroup: 'series', lastLink: streamFingerprint(reused) }).stream, reused);
  assert.equal(evaluate(sources, settings, 0, { preferredBingeGroup: 'series' }).stream, group);
  assert.equal(evaluate(sources, prefs({ preferBingeGroup: false }), 0, { preferredBingeGroup: 'series' }).stream, first);
});

test('next-episode flags, scope, current group and mode fallback cover all branches', () => {
  const original = stream('Original 1080p', 'a', { behaviorHints: { bingeGroup: 'group' } });
  const grouped = stream('Other 720p', 'b', { behaviorHints: { bingeGroup: 'group' } });
  const fallback = stream('Fallback 1080p', 'b');
  const choose = (extra, candidates = [fallback, grouped]) => selectNextStream(candidates, selectionContext(original, prefs(extra)));
  assert.equal(choose({ nextEpisodeAutoPlay: false }), undefined);
  assert.equal(choose({ bingeFallback: false }), grouped);
  assert.equal(choose({ bingeFallback: false }, [fallback]), undefined);
  assert.equal(choose({ preferBingeGroup: false }), fallback);
  assert.equal(choose({ scope: 'plugins' }), undefined);
  assert.equal(choose({ mode: 'regex', regex: 'Fallback', preferBingeGroup: false }), fallback);
  assert.equal(choose({ mode: 'preferences', resolution: '1080p', preferBingeGroup: false }), fallback);
  assert.equal(choose({ mode: 'manual', preferBingeGroup: false }), fallback);
});

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}

test('reuse stores hashes, not media URLs or headers; expires and matches only freshly fetched links', () => {
  const storage = memoryStorage(); let now = 1000;
  const store = new StreamReuseStore(storage, () => now);
  store.useScope('profile:1');
  const item = stream('Release', 'https://addon.test/manifest.json', { headers: { Authorization: 'synthetic' } });
  const key = streamContentKey('series', 'tt1', 'tt1:1:1');
  store.remember('profile:1', key, item, 'series:tt1');
  assert.equal(matchesFingerprint(item, store.lastLink(key, 1)), true);
  assert.equal(matchesFingerprint({ ...item, url: 'https://media.test/changed.mp4' }, store.lastLink(key, 1)), false);
  assert.equal(storage.getItem(REUSE_KEY).includes(item.url), false);
  assert.equal(storage.getItem(REUSE_KEY).includes('Authorization'), false);
  now += 3_600_000;
  assert.equal(store.lastLink(key, 1), undefined);
  assert.equal(JSON.parse(storage.getItem(REUSE_KEY)).links.length, 0);
});

test('reuse reloads the same scope, clears on profile switch, bounds entries and fences late callbacks', () => {
  const storage = memoryStorage(); const store = new StreamReuseStore(storage, () => 10);
  store.useScope('one');
  for (let index = 0; index < 120; index++) store.remember('one', String(index), stream('item', 'a', { behaviorHints: { bingeGroup: 'g' } }), String(index));
  assert.equal(JSON.parse(storage.getItem(REUSE_KEY)).links.length, 100);
  assert.equal(JSON.parse(storage.getItem(REUSE_KEY)).groups.length, 100);
  const restored = new StreamReuseStore(storage, () => 10);
  restored.useScope('one');
  assert.ok(restored.lastLink('119', 24));
  assert.equal(restored.bingeGroup('119'), 'g');
  restored.useScope('two');
  restored.remember('one', '119', stream('late'), '119');
  assert.equal(restored.lastLink('119', 24), undefined);
  assert.equal(restored.bingeGroup('119'), undefined);
  restored.remember('two', 'item', stream('current'));
  restored.clear();
  assert.equal(restored.lastLink('item', 24), undefined);
});


test('preferred provider uses trusted plugin identity rather than a returned provider URL', () => {
  const first = stream('1080p', 'other');
  const native = stream('1080p', 'returned-label', { selectionSource: { kind: 'plugin', id: 'repo:scraper' } });
  assert.equal(evaluate([source('other', [first]), source('repo:scraper', [native], false, 'plugin')],
    prefs({ mode: 'preferences', provider: 'repo:scraper' })).stream, native);
});
