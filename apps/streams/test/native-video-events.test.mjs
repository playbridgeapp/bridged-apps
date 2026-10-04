import assert from 'node:assert/strict';
import test from 'node:test';
import { forwardNativeVideoEvents } from '../src/lib/native-video-events.ts';

const forwarded = ['loadedmetadata', 'canplay', 'playing', 'seeked', 'waiting', 'stalled', 'timeupdate', 'pause'];
class Media extends EventTarget { readyState = 0; }
function hostEvents(host) {
  const events = [];
  for (const type of [...forwarded, 'ended', 'error']) host.addEventListener(type, (event) => events.push({ type, currentTarget: event.currentTarget }));
  return events;
}

test('native fallback relays readiness, seek, playback and progress events on the owning host', () => {
  const host = new EventTarget(), video = new Media(), events = hostEvents(host);
  const cleanup = forwardNativeVideoEvents(host, video, () => true);
  for (const type of forwarded) video.dispatchEvent(new Event(type));
  assert.deepEqual(events.map((event) => event.type), forwarded);
  assert.ok(events.every((event) => event.currentTarget === host));
  cleanup();
});

test('already-ready media replays only the readiness events that were reached', () => {
  for (const state of [0, 1, 2, 3, 4]) {
    const host = new EventTarget(), video = new Media(), events = hostEvents(host);
    video.readyState = state;
    const cleanup = forwardNativeVideoEvents(host, video, () => true);
    assert.deepEqual(events.map((event) => event.type), state >= 3 ? ['loadedmetadata', 'canplay'] : state >= 1 ? ['loadedmetadata'] : []);
    cleanup();
  }
});

test('ended and error are not duplicated because Movi already forwards them', () => {
  const host = new EventTarget(), video = new Media(), events = hostEvents(host);
  const cleanup = forwardNativeVideoEvents(host, video, () => true);
  video.dispatchEvent(new Event('ended'));
  video.dispatchEvent(new Event('error'));
  assert.deepEqual(events, []);
  cleanup();
});

test('a closed or replaced playback cannot relay late events', () => {
  const host = new EventTarget(), video = new Media(), events = hostEvents(host);
  let current = true;
  const cleanup = forwardNativeVideoEvents(host, video, () => current);
  video.dispatchEvent(new Event('timeupdate'));
  current = false;
  for (const type of forwarded) video.dispatchEvent(new Event(type));
  assert.deepEqual(events.map((event) => event.type), ['timeupdate']);
  cleanup();
});

test('cleanup is idempotent and removes every listener', () => {
  const host = new EventTarget(), video = new Media(), events = hostEvents(host);
  const cleanup = forwardNativeVideoEvents(host, video, () => true);
  cleanup(); cleanup();
  for (const type of forwarded) video.dispatchEvent(new Event(type));
  assert.deepEqual(events, []);
});

test('ownership is checked again if a readiness callback closes playback', () => {
  const host = new EventTarget(), video = new Media(), events = hostEvents(host);
  let current = true;
  video.readyState = 4;
  host.addEventListener('loadedmetadata', () => { current = false; });
  const cleanup = forwardNativeVideoEvents(host, video, () => current);
  assert.deepEqual(events.map((event) => event.type), ['loadedmetadata']);
  cleanup();
});
