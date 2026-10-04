import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeThisDevicePlayback, loadThisDevicePlayback, saveThisDevicePlayback, playbackOpeningOrientation } from '../src/lib/this-device-playback.ts';

test('This device defaults to the built-in player opening in landscape', () => {
  assert.deepEqual(normalizeThisDevicePlayback(null), { useNativePlayer: true, initialOrientation: 'landscape' });
});
test('preferences accept only booleans and the three explicit orientations', () => {
  for (const initialOrientation of ['auto', 'portrait', 'landscape']) {
    assert.deepEqual(normalizeThisDevicePlayback({ useNativePlayer: false, initialOrientation }), { useNativePlayer: false, initialOrientation });
  }
  for (const initialOrientation of [null, [], ['portrait'], {}, 1, 'sideways']) {
    assert.equal(normalizeThisDevicePlayback({ useNativePlayer: 'false', initialOrientation }).initialOrientation, 'landscape');
    assert.equal(normalizeThisDevicePlayback({ useNativePlayer: 'false', initialOrientation }).useNativePlayer, true);
  }
});
test('local persistence round trips only presentation preferences', () => {
  let raw;
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  saveThisDevicePlayback({ useNativePlayer: false, initialOrientation: 'portrait', extra: 'must-not-persist' }, storage);
  assert.deepEqual(JSON.parse(raw), { useNativePlayer: false, initialOrientation: 'portrait' });
  assert.deepEqual(loadThisDevicePlayback(storage), { useNativePlayer: false, initialOrientation: 'portrait' });
});
test('corrupt or blocked storage preserves usable landscape defaults', () => {
  assert.equal(loadThisDevicePlayback({ getItem: () => '{' }).initialOrientation, 'landscape');
  const blocked = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } };
  assert.equal(loadThisDevicePlayback(blocked).useNativePlayer, true);
  assert.doesNotThrow(() => saveThisDevicePlayback(normalizeThisDevicePlayback(null), blocked));
});
test('orientation is sent only to a supported native This device player', () => {
  const preferences = normalizeThisDevicePlayback(null);
  assert.equal(playbackOpeningOrientation('this-device', true, preferences), 'landscape');
  assert.equal(playbackOpeningOrientation('this-device', false, preferences), undefined);
  assert.equal(playbackOpeningOrientation('living-room', true, preferences), undefined);
  assert.equal(playbackOpeningOrientation('this-device', true, { ...preferences, useNativePlayer: false }), undefined);
});
