import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTmdbMetadata, applyTmdbSeason, resolveTmdbId, fetchTmdbMetadata } from '../src/lib/tmdb.ts';
import { defaultTmdbSettings } from '../src/lib/tmdb-settings.ts';

const settings = { ...defaultTmdbSettings(), enabled: true };
const base = { id: 'tt200', type: 'series', name: 'Addon title', releaseInfo: '2020–', imdbRating: '8.8',
  poster: 'https://addon.test/poster.jpg', description: 'Addon overview', videos: [
    { id: 'addon-specific-pilot', season: 1, episode: 1, title: 'Addon pilot', released: '2020-01-01' },
    { id: 'addon-specific-second', season: 2, episode: 1, title: 'Addon second', released: '2021-01-01' }
  ] };
const payload = { id: 900, data: { id: 900, name: 'Localized series', overview: 'Localized overview', vote_average: 7.5,
  poster_path: '/poster.jpg', backdrop_path: '/background.jpg', genres: [{ name: 'Drama' }], status: 'Ended',
  episode_run_time: [45], content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-14' }] },
  aggregate_credits: { cast: [{ id: 1, name: 'Actor', roles: [{ character: 'Detective' }], profile_path: '/actor.jpg' }],
    crew: [{ id: 2, name: 'Writer', jobs: [{ job: 'Writer' }] }] },
  networks: [{ id: 5, name: 'Network' }], production_companies: [{ id: 6, name: 'Studio', logo_path: '/studio.png' }],
  seasons: [{ season_number: 1, poster_path: '/season.jpg' }],
  videos: { results: [{ key: 'abcdef12345', name: 'Trailer', type: 'Trailer', site: 'YouTube' },
    { key: 'javascript:bad', name: 'Invalid', type: 'Trailer', site: 'YouTube' }] },
  recommendations: { results: [{ id: 901, name: 'Another series', first_air_date: '2022-01-01' }] }
} };

test('TMDB enrichment preserves addon identity, IMDb rating, episode IDs, and release dates', () => {
  const enriched = applyTmdbMetadata(base, payload, settings);
  assert.equal(enriched.id, base.id);
  assert.equal(enriched.imdbRating, '8.8');
  assert.equal(enriched.releaseInfo, '2020–');
  assert.equal(enriched.name, 'Localized series');
  assert.equal(enriched.runtime, '45 min');
  assert.equal(enriched.ageRating, 'TV-14');
  assert.deepEqual(enriched.cast, ['Actor']);
  assert.deepEqual(enriched.writer, ['Writer']);
  assert.equal(enriched.people[0].character, 'Detective');
  assert.equal(enriched.networks[0].name, 'Network');
  assert.equal(enriched.productionCompanies[0].name, 'Studio');
  assert.equal(enriched.trailers.length, 1);
  assert.equal(enriched.moreLikeThis[0].id, 'tmdb:901');
  assert.equal(enriched.moreLikeThis[0].type, 'series');
  assert.deepEqual(enriched.videos.map(({ id, released }) => ({ id, released })), base.videos.map(({ id, released }) => ({ id, released })));
  assert.equal(base.name, 'Addon title');
});

test('disabled modules retain addon fields and a missing IMDb rating is labeled TMDB', () => {
  const enriched = applyTmdbMetadata(base, payload, { ...settings, artwork: false, basicInfo: false, credits: false,
    details: false, trailers: false, moreLikeThis: false, productions: false, networks: false, seasonPosters: false });
  assert.equal(enriched.name, base.name);
  assert.equal(enriched.poster, base.poster);
  assert.equal(enriched.description, base.description);
  assert.equal(enriched.cast, undefined);
  assert.equal(enriched.trailers, undefined);
  assert.equal(enriched.networks, undefined);
  assert.equal(applyTmdbMetadata(base, payload, { ...settings, enabled: false }), base);
  const fallback = applyTmdbMetadata({ ...base, imdbRating: undefined }, payload, settings);
  assert.equal(fallback.imdbRating, '7.5');
  assert.equal(fallback.ratingSource, 'TMDB');
});

test('episode enrichment only modifies matching addon episodes and never substitutes TMDB dates or IDs', () => {
  const details = { poster_path: '/season.jpg', episodes: [{ episode_number: 1, name: 'Enriched pilot', overview: 'Overview',
    still_path: '/still.jpg', runtime: 43, air_date: '1990-01-01', id: 123 }, { episode_number: 3, name: 'Extra episode' }] };
  const videos = applyTmdbSeason(base.videos, 1, details, settings);
  assert.equal(videos.length, 2);
  assert.equal(videos[0].id, 'addon-specific-pilot');
  assert.equal(videos[0].released, '2020-01-01');
  assert.equal(videos[0].runtime, 43);
  assert.equal(videos[0].title, 'Enriched pilot');
  assert.equal(videos[1], base.videos[1]);
  const artworkOnly = applyTmdbSeason(base.videos, 1, details, { ...settings, episodes: false });
  assert.equal(artworkOnly[0].title, 'Addon pilot');
  assert.equal(artworkOnly[0].seasonPoster, 'https://image.tmdb.org/t/p/w500/season.jpg');
});

test('collection ordering puts missing dates last and removes the current title', () => {
  const meta = applyTmdbMetadata({ id: 'tt100', type: 'movie', name: 'Film' }, { id: 1, data: { id: 1 }, collection: {
    name: 'Collection', parts: [{ id: 3, title: 'Undated' }, { id: 2, title: 'Earlier', release_date: '2000-01-01' },
      { id: 1, title: 'Current', release_date: '2001-01-01' }]
  } }, settings);
  assert.deepEqual(meta.collectionItems.map((item) => item.id), ['tmdb:2', 'tmdb:3']);
});

test('TMDB IDs resolve without searching by title and unavailable enrichment stays optional', async () => {
  assert.equal(await resolveTmdbId('tmdb:123:1:2', 'series', ''), 123);
  assert.equal(await resolveTmdbId('movie:123', 'movie', ''), 123);
  assert.equal(await resolveTmdbId('sports:123', 'sport', 'key'), null);
  assert.equal(await resolveTmdbId('unknown-title', 'movie', ''), null);
  assert.equal(await fetchTmdbMetadata(base, '', settings), null);
  assert.equal(await fetchTmdbMetadata(base, 'key', { ...settings, enabled: false }), null);
});
