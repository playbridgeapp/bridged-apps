import assert from 'node:assert/strict';
import test from 'node:test';
import { streamContentType } from '../src/lib/stream-content-type.ts';

test('the URL path names the type', () => {
  assert.equal(streamContentType({ url: 'https://cdn.test/show/index.m3u8?token=x' }), 'application/vnd.apple.mpegurl');
  assert.equal(streamContentType({ url: 'https://cdn.test/a/Movie.MKV' }), 'video/x-matroska');
  assert.equal(streamContentType({ url: 'https://cdn.test/a/clip.mp4' }), 'video/mp4');
  assert.equal(streamContentType({ url: 'https://cdn.test/a/manifest.mpd' }), 'application/dash+xml');
  assert.equal(streamContentType({ url: 'https://cdn.test/a/My%20Film.webm' }), 'video/webm');
});

test('a link without an extension uses the addon file name', () => {
  assert.equal(streamContentType({ url: 'https://debrid.test/d/ABC123', behaviorHints: { filename: 'Show.S01E02.1080p.mkv' } }), 'video/x-matroska');
  assert.equal(streamContentType({ url: 'https://debrid.test/d/ABC123', behaviorHints: { filename: 'Movie.2020.mp4' } }), 'video/mp4');
});

test('the URL wins over the file name', () => {
  assert.equal(streamContentType({ url: 'https://cdn.test/a/index.m3u8', behaviorHints: { filename: 'Movie.mkv' } }), 'application/vnd.apple.mpegurl');
});

test('unknown stays unknown instead of claiming MP4', () => {
  assert.equal(streamContentType({ url: 'https://debrid.test/d/ABC123' }), undefined);
  assert.equal(streamContentType({ url: 'https://resolver.test/play.php?id=1' }), undefined);
  assert.equal(streamContentType({ url: 'https://debrid.test/d/ABC123', behaviorHints: { filename: 'Movie' } }), undefined);
  assert.equal(streamContentType({ url: 'not a url' }), undefined);
  assert.equal(streamContentType({}), undefined);
});
