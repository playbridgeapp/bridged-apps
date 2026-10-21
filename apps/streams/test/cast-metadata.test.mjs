import assert from 'node:assert/strict';
import test from 'node:test';
import { castMetadata } from '../src/lib/cast-metadata.ts';

test('movie casts carry the IMDb id from the meta id and the TMDB id as a string', () => {
  const metadata = castMetadata({ id: 'tt100', type: 'movie', name: 'Sample Film', tmdbId: 321 });
  assert.equal(metadata.imdbId, 'tt100');
  assert.equal(metadata.tmdbId, '321');
  assert.equal(metadata.season, undefined);
});

test('episode casts carry series ids alongside season and episode', () => {
  const metadata = castMetadata({ id: 'tt200', type: 'series', name: 'Sample Series', tmdbId: 900 },
    { id: 'tt200:1:2', season: 1, episode: 2, title: 'Next Episode' });
  assert.deepEqual({ imdbId: metadata.imdbId, tmdbId: metadata.tmdbId, season: metadata.season, episode: metadata.episode,
    episodeTitle: metadata.episodeTitle }, { imdbId: 'tt200', tmdbId: '900', season: 1, episode: 2, episodeTitle: 'Next Episode' });
});

test('explicit IMDb fields win over the meta id and TMDB previews supply a TMDB id', () => {
  assert.equal(castMetadata({ id: 'tt1', type: 'movie', name: 'A', imdb_id: 'tt2', imdbId: 'tt3' }).imdbId, 'tt2');
  assert.equal(castMetadata({ id: 'tmdb:55', type: 'movie', name: 'B', imdbId: 'tt3' }).imdbId, 'tt3');
  const preview = castMetadata({ id: 'tmdb:55', type: 'series', name: 'C' });
  assert.equal(preview.tmdbId, '55');
  assert.equal('imdbId' in preview, false);
});

test('ids are omitted when none are available', () => {
  const metadata = castMetadata({ id: 'kitsu:1', type: 'series', name: 'D' });
  assert.equal('imdbId' in metadata, false);
  assert.equal('tmdbId' in metadata, false);
});
