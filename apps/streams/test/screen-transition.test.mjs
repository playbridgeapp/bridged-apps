import test from 'node:test';
import assert from 'node:assert/strict';
import { screenMotion, screenTransition } from '../src/lib/screen-transition.ts';

test('top screens travel their full width while underlying screens parallax', () => {
  for (const width of [320, 390, 1280]) {
    const push = screenMotion('push', false, width);
    const back = screenMotion('back', false, width, true);
    assert.equal(push.duration, 280);
    assert.equal(back.duration, 280);
    assert.equal(push.x, width);
    assert.equal(back.x, width);
    assert.equal(screenMotion('push', false, width, true).x, -width * 0.28);
    assert.equal(screenMotion('back', false, width).x, -width * 0.28);
  }
});

test('history gestures and reduced motion never replay an entrance', () => {
  for (const outgoing of [false, true]) {
    assert.equal(screenMotion('history', false, 390, outgoing).duration, 0);
    for (const direction of ['push', 'back', 'history']) {
      assert.equal(screenMotion(direction, true, 390, outgoing).duration, 0);
    }
  }
});

test('screen transitions only translate, keeping the sliding screen opaque', (t) => {
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  t.after(() => { delete globalThis.window; });
  const transition = screenTransition({ clientWidth: 390 }, { direction: 'back', outgoing: true });
  assert.equal(transition.css(0), 'transform: translate3d(390px,0,0)');
  assert.equal(transition.css(0.5), 'transform: translate3d(195px,0,0)');
  assert.equal(transition.css(1), 'transform: translate3d(0px,0,0)');
});
