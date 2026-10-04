import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserResume } from '../src/lib/browser-resume.ts';

const source = 'https://resume-media.test/video.mp4';
const playback = (resumePositionMs = 52345) => Object.freeze({ stream: Object.freeze({ url: source }), resumePositionMs });
class Media {
  src = source;
  duration = 130;
  seeking = false;
  position = 0;
  requests = [];
  fail = false;
  getAttribute(name) { return name === 'src' ? this.src : null; }
  get currentTime() { return this.position; }
  set currentTime(seconds) {
    this.requests.push(seconds);
    if (this.fail) throw new Error('Not ready');
    // Model Movi's asynchronous setter: requesting a seek is not landing it.
  }
}

test('resume bookkeeping never mutates the reactive playback object', () => {
  const resume = new BrowserResume(), media = new Media(), session = playback();
  resume.apply(media, session);
  assert.deepEqual(media.requests, [52.345]);
  assert.equal(resume.observe(media, session), false);
  media.position = 52.345;
  assert.equal(resume.observe(media, session), true);
  assert.deepEqual(session, { stream: { url: source }, resumePositionMs: 52345 });
});

test('a queued seek is not confirmed or duplicated while seeking', () => {
  const resume = new BrowserResume(), media = new Media(), session = playback();
  resume.apply(media, session);
  media.seeking = true;
  media.position = 52.345;
  resume.apply(media, session);
  assert.equal(resume.observe(media, session), false);
  assert.deepEqual(media.requests, [52.345]);
  media.seeking = false;
  assert.equal(resume.observe(media, session), true);
  resume.apply(media, session);
  assert.deepEqual(media.requests, [52.345]);
});

test('a silent failed seek retries on readiness and cannot report zero-time progress', () => {
  const resume = new BrowserResume(), media = new Media(), session = playback();
  resume.apply(media, session);
  assert.equal(resume.observe(media, session), false);
  media.position = .2;
  assert.equal(resume.observe(media, session), false);
  resume.apply(media, session);
  assert.deepEqual(media.requests, [52.345, 52.345]);
  media.position = 52.5;
  assert.equal(resume.observe(media, session), true);
});

test('a thrown seek remains retryable', () => {
  const resume = new BrowserResume(), media = new Media(), session = playback();
  media.fail = true;
  assert.doesNotThrow(() => resume.apply(media, session));
  assert.equal(resume.observe(media, session), false);
  media.fail = false;
  resume.apply(media, session);
  assert.deepEqual(media.requests, [52.345, 52.345]);
  media.position = 52.345;
  assert.equal(resume.observe(media, session), true);
});

test('a seeked event at the wrong position remains retryable', () => {
  const resume = new BrowserResume(), media = new Media(), session = playback();
  resume.apply(media, session);
  media.position = 0;
  resume.apply(media, session);
  assert.equal(resume.observe(media, session), false);
  assert.deepEqual(media.requests, [52.345, 52.345]);
});

test('confirmation is scoped to the playback identity, even with the same source URL', () => {
  const resume = new BrowserResume(), media = new Media(), movie = playback(), episode = playback(94250);
  resume.apply(media, movie);
  media.position = 52.345;
  assert.equal(resume.observe(media, movie), true);
  assert.equal(resume.observe(media, episode), false);
  resume.apply(media, episode);
  assert.deepEqual(media.requests, [52.345, 94.25]);
  media.position = 94.25;
  assert.equal(resume.observe(media, episode), true);
});

test('a replacement media element must resume independently', () => {
  const resume = new BrowserResume(), media = new Media(), replacement = new Media(), session = playback();
  media.position = 52.345;
  assert.equal(resume.observe(media, session), true);
  assert.equal(resume.observe(replacement, session), false);
  resume.apply(replacement, session);
  assert.deepEqual(replacement.requests, [52.345]);
});

test('stale or absent sources and closed sessions cannot seek or report', () => {
  const resume = new BrowserResume(), media = new Media(), session = playback();
  media.src = 'https://resume-media.test/other.mp4';
  resume.apply(media, session);
  assert.equal(resume.observe(media, session), false);
  media.src = null;
  resume.apply(media, session);
  assert.equal(resume.observe(media, session), false);
  resume.apply(media, null);
  assert.equal(resume.observe(media, null), false);
  assert.deepEqual(media.requests, []);
});

test('zero and invalid resume positions start normally without seeking', () => {
  for (const position of [0, -1, NaN, Infinity]) {
    const resume = new BrowserResume(), media = new Media(), session = playback(position);
    resume.apply(media, session);
    assert.equal(resume.observe(media, session), true);
    assert.deepEqual(media.requests, []);
  }
});

test('the actual media duration still prevents seeking at or beyond completion', () => {
  for (const position of [123500, 130000, 600000]) {
    const resume = new BrowserResume(), media = new Media(), session = playback(position);
    resume.apply(media, session);
    assert.deepEqual(media.requests, []);
    assert.equal(resume.observe(media, session), true);
  }
});

test('an unknown duration does not discard the saved position', () => {
  const resume = new BrowserResume(), media = new Media(), session = playback();
  media.duration = NaN;
  resume.apply(media, session);
  assert.deepEqual(media.requests, [52.345]);
  assert.equal(resume.observe(media, session), false);
  media.duration = 130;
  media.position = 52.345;
  assert.equal(resume.observe(media, session), true);
});

test('later user seeking does not reapply the original resume position', () => {
  const resume = new BrowserResume(), media = new Media(), session = playback();
  media.position = 52.345;
  assert.equal(resume.observe(media, session), true);
  media.position = 12;
  resume.apply(media, session);
  assert.equal(resume.observe(media, session), true);
  assert.deepEqual(media.requests, []);
});
