import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultStreamSelection, matchesStreamPreferences, selectPreferredStream, selectReadyPreferredStream, selectNextStream,
  selectionContext, streamReleaseType, streamResolution, sortStreamsByPreference, matchesAllStreamPreferences,
  savedStreamSelection, saveStreamSelection } from '../src/lib/stream-selection.ts';

const stream = (name, provider = 'a', extra = {}) => ({ name, addonName: provider, addonUrl: provider, url: 'https://media.test/video', ...extra });
const settings = (extra = {}) => ({ ...defaultStreamSelection(), enabled: true, resolution: '1080p', releaseTypes: ['web-dl'], ...extra });

test('quality and release parsing handles filename separators, aliases, and invisible characters', () => {
  const source = stream('Film.1\u200d0\u200d8\u200d0\u200dp.Web\u200d-\u200ddl');
  assert.equal(streamResolution(source), '1080p');
  assert.equal(streamReleaseType(source), 'web-dl');
  assert.equal(streamResolution(stream('UHD Blu-Ray')), '2160p');
  assert.equal(streamReleaseType(stream('BluRay REMUX')), 'remux');
  assert.equal(streamReleaseType(stream('HD CAM')), 'cam');
  assert.equal(streamReleaseType(stream('camera documentary')), undefined);
});

test('provider preference cannot bypass quality or release requirements', () => {
  const wrongResolution = stream('720p WEB-DL', 'preferred');
  const wrongRelease = stream('1080p BluRay', 'preferred');
  const fallback = stream('1080p WEB-DL', 'other');
  assert.equal(selectPreferredStream([wrongResolution, wrongRelease, fallback], settings({ provider: 'preferred' })), fallback);
  const preferred = stream('1080p WEB-DL', 'preferred');
  assert.equal(selectPreferredStream([fallback, preferred], settings({ provider: 'preferred' })), preferred);
});

test('unknown values do not satisfy a selected filter and no match stays manual', () => {
  assert.equal(matchesStreamPreferences(stream('Unknown quality'), settings()), false);
  assert.equal(matchesStreamPreferences(stream('1080p'), settings()), false);
  assert.equal(selectPreferredStream([stream('720p WEB-DL')], settings()), undefined);
  assert.equal(selectPreferredStream([stream('Unknown quality')], settings({ resolution: 'any', releaseTypes: [] }))?.name, 'Unknown quality');
  assert.equal(matchesStreamPreferences(stream('1080p WEBRip'), settings({ releaseTypes: ['web-dl', 'webrip'] })), true);
});

test('a matching preferred provider can start while unrelated providers and account restore are pending', () => {
  const preferred = stream('1080p WEB-DL', 'preferred');
  const providers = [
    { id: 'slow', loading: true, streams: [] },
    { id: 'preferred', loading: false, streams: [preferred] }
  ];
  assert.equal(selectReadyPreferredStream(providers, settings({ provider: 'preferred' }), true), preferred);
  assert.equal(selectReadyPreferredStream(providers, settings()), undefined);
});

test('incremental selection preserves provider priority and falls back after higher priorities finish', () => {
  const fallback = stream('1080p WEB-DL', 'other');
  const providers = [
    { id: 'first', loading: true, streams: [] },
    { id: 'other', loading: false, streams: [fallback] },
    { id: 'last', loading: true, streams: [] }
  ];
  assert.equal(selectReadyPreferredStream(providers, settings()), undefined);
  providers[0].loading = false;
  providers[0].streams = [stream('720p WEB-DL', 'first')];
  assert.equal(selectReadyPreferredStream(providers, settings()), fallback);
  assert.equal(selectReadyPreferredStream(providers, settings(), true), undefined);
  assert.equal(selectReadyPreferredStream(providers, settings({ provider: 'last' })), undefined);
  providers[2].loading = false;
  assert.equal(selectReadyPreferredStream(providers, settings({ provider: 'last' })), fallback);
});

test('manual episode choice overrides saved filters and preserves its release when names are generic', () => {
  const original = stream('Provider', 'a', { title: '720p WEBRip', behaviorHints: { bingeGroup: 'chosen' } });
  const group = stream('720p WEBRip', 'b', { behaviorHints: { bingeGroup: 'chosen' } });
  const preferred = stream('1080p WEB-DL');
  const context = selectionContext(original, settings());
  assert.equal(selectNextStream([preferred, group], context), group);
  const sameRelease = stream('Provider', 'a', { title: '720p WEBRip' });
  const wrongRelease = stream('Provider', 'a', { title: '1080p WEB-DL' });
  assert.equal(selectNextStream([wrongRelease, sameRelease], context), sameRelease);
  assert.equal(selectNextStream([preferred], context), preferred);
});

test('automatic continuation keeps required filters and stops instead of choosing an arbitrary cast source', () => {
  const original = stream('1080p WEB-DL', 'a', { behaviorHints: { bingeGroup: 'chosen' } });
  const context = selectionContext(original, settings(), false);
  const wrong = stream('720p WEB-DL', 'a', { behaviorHints: { bingeGroup: 'chosen' } });
  const fallback = stream('1080p WEB-DL', 'b');
  assert.equal(selectNextStream([wrong, fallback], context, true), fallback);
  assert.equal(selectNextStream([wrong], context, true), undefined);
});

test('playback sessions retain their settings snapshot and original manual choice', () => {
  const preferences = settings();
  const original = stream('720p WEBRip');
  const context = selectionContext(original, preferences);
  preferences.releaseTypes.push('remux');
  preferences.resolution = '2160p';
  assert.deepEqual(context.preferences.releaseTypes, ['web-dl']);
  assert.equal(context.preferences.resolution, '1080p');
  assert.equal(context.initialStream, original);
});

test('display sorting prioritizes full matches before partial matches and preserves ties and input order', () => {
  const none = stream('Unknown quality', 'other');
  const one = stream('720p WEB-DL', 'other');
  const two = stream('1080p BluRay', 'preferred');
  const fullOther = stream('1080p WEB-DL', 'other');
  const fullPreferred = stream('1080p WEB-DL', 'preferred');
  const tied = stream('1080p WEB-DL second', 'preferred');
  const unknownPreferred = stream('Unknown quality', 'preferred');
  const input = [none, one, two, fullOther, fullPreferred, tied, unknownPreferred];
  const preferences = settings({ enabled: false, sortByPreference: true, provider: 'preferred' });
  assert.deepEqual(sortStreamsByPreference(input, preferences), [fullPreferred, tied, fullOther, two, one, unknownPreferred, none]);
  assert.deepEqual(input, [none, one, two, fullOther, fullPreferred, tied, unknownPreferred]);
  assert.equal(selectPreferredStream(input, preferences), fullPreferred);
  assert.equal(matchesAllStreamPreferences(fullPreferred, preferences), true);
  assert.equal(matchesAllStreamPreferences(fullOther, preferences), false);
  assert.equal(matchesAllStreamPreferences(two, preferences), false);
});

test('sorting can be disabled, handles provider-only and multiple release preferences, and keeps unfiltered order', () => {
  const input = [stream('Unknown quality', 'other'), stream('1080p WEBRip'), stream('1080p WEB-DL'), stream('720p WEB-DL')];
  assert.equal(sortStreamsByPreference(input, settings()), input);
  assert.deepEqual(sortStreamsByPreference(input, { ...defaultStreamSelection(), sortByPreference: true }), input);
  assert.equal(matchesAllStreamPreferences(input[0], defaultStreamSelection()), false);
  const providerOnly = { ...defaultStreamSelection(), sortByPreference: true, provider: 'other' };
  assert.deepEqual(sortStreamsByPreference([...input.slice(1), input[0]], providerOnly), input);
  assert.equal(matchesAllStreamPreferences(input[0], providerOnly), true);
  assert.deepEqual(sortStreamsByPreference(input, settings({ sortByPreference: true, releaseTypes: ['web-dl', 'webrip'] })),
    [input[1], input[2], input[3], input[0]]);
});

test('existing saved preferences keep sorting off and the two switches persist independently', () => {
  const oldStorage = globalThis.localStorage;
  let stored = JSON.stringify({ enabled: true, resolution: '1080p', releaseTypes: ['web-dl'], provider: 'a' });
  globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  try {
    assert.equal(savedStreamSelection().sortByPreference, false);
    assert.equal(savedStreamSelection().enabled, true);
    saveStreamSelection({ ...savedStreamSelection(), enabled: false, sortByPreference: true });
    assert.deepEqual(savedStreamSelection(), settings({ enabled: false, sortByPreference: true, provider: 'a' }));
  } finally {
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});
