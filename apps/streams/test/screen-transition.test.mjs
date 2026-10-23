import test from 'node:test';
import assert from 'node:assert/strict';
import { screenMotion } from '../src/lib/screen-transition.ts';

test('push and explicit back move in opposite directions in one short transition', () => {
  const push = screenMotion('push', false, 390);
  const back = screenMotion('back', false, 390, true);
  assert.equal(push.duration, 220);
  assert.equal(back.duration, 220);
  assert.equal(push.x, back.x);
  assert.ok(screenMotion('push', false, 390, true).x < 0);
  assert.ok(screenMotion('back', false, 390).x < 0);
});

test('history gestures and reduced motion never replay an entrance', () => {
  for (const outgoing of [false, true]) {
    assert.equal(screenMotion('history', false, 390, outgoing).duration, 0);
    assert.equal(screenMotion('push', true, 390, outgoing).duration, 0);
  }
  assert.ok(screenMotion('push', false, 1280).x <= 48);
});
