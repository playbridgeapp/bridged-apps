import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ageOn, discoverOrganizationTitles, filmographyDepartments, filterFilmography, personFilmography, tmdbTitlePreview
} from '../src/lib/tmdb-pages.ts';
import { applyTmdbMetadata } from '../src/lib/tmdb.ts';
import { defaultTmdbSettings } from '../src/lib/tmdb-settings.ts';
import { parseRoute, routeHash } from '../src/lib/router.ts';

const person = { id: 7, name: 'Pat Example', combined_credits: {
  cast: [
    { id: 10, media_type: 'movie', title: 'First Film', character: 'Hero', release_date: '2001-05-01', vote_count: 900, poster_path: '/a.jpg' },
    { id: 20, media_type: 'tv', name: 'Long Show', character: 'Detective', episode_count: 42, first_air_date: '2010-01-01', vote_count: 3000 },
    { id: 30, media_type: 'movie', title: 'Adult Film', adult: true, release_date: '2005-01-01', vote_count: 5 },
    { id: 40, media_type: 'person', name: 'Not a title' },
    { id: 50, media_type: 'movie', title: 'Upcoming', vote_count: 0 }
  ],
  crew: [
    { id: 10, media_type: 'movie', title: 'First Film', department: 'Directing', job: 'Director', release_date: '2001-05-01', vote_count: 900 },
    { id: 10, media_type: 'movie', title: 'First Film', department: 'Writing', job: 'Screenplay', release_date: '2001-05-01', vote_count: 900 },
    { id: 60, media_type: 'movie', title: 'Produced Film', department: 'Production', job: 'Producer', release_date: '2020-02-02', vote_count: 40 }
  ]
} };

test('a filmography merges cast and crew credits per title and hides adult titles by default', () => {
  const entries = personFilmography(person, false);
  assert.deepEqual(entries.map((entry) => entry.preview.id), ['tmdb:10', 'tmdb:20', 'tmdb:50', 'tmdb:60']);
  const first = entries.find((entry) => entry.preview.id === 'tmdb:10');
  assert.deepEqual(first.roles, ['as Hero', 'Director', 'Screenplay']);
  assert.deepEqual(first.departments, ['Acting', 'Directing', 'Writing']);
  assert.equal(first.preview.type, 'movie');
  assert.equal(first.preview.tmdbId, 10);
  assert.equal(first.preview.poster, 'https://image.tmdb.org/t/p/w342/a.jpg');
  const show = entries.find((entry) => entry.preview.id === 'tmdb:20');
  assert.equal(show.preview.type, 'series');
  assert.deepEqual(show.roles, ['as Detective (42 episodes)']);
  assert.ok(personFilmography(person, true).some((entry) => entry.preview.id === 'tmdb:30'));
});

test('filmography filters by type and department and sorts by votes or date', () => {
  const entries = personFilmography(person, false);
  assert.deepEqual(filmographyDepartments(entries), ['Acting', 'Directing', 'Writing', 'Production']);
  assert.deepEqual(filterFilmography(entries, 'all', 'all', 'popular').map((entry) => entry.preview.id),
    ['tmdb:20', 'tmdb:10', 'tmdb:60', 'tmdb:50']);
  assert.deepEqual(filterFilmography(entries, 'all', 'all', 'newest').map((entry) => entry.preview.id),
    ['tmdb:60', 'tmdb:20', 'tmdb:10', 'tmdb:50']);
  assert.deepEqual(filterFilmography(entries, 'movie', 'Directing', 'popular').map((entry) => entry.preview.id), ['tmdb:10']);
  assert.deepEqual(filterFilmography(entries, 'series', 'all', 'popular').map((entry) => entry.preview.id), ['tmdb:20']);
});

test('title previews only show a TMDB rating with enough votes', () => {
  assert.equal(tmdbTitlePreview({ id: 1, title: 'Few', vote_average: 9.9, vote_count: 3 }, 'movie').imdbRating, undefined);
  assert.equal(tmdbTitlePreview({ id: 1, title: 'Many', vote_average: 7.25, vote_count: 300 }, 'movie').imdbRating, '7.3');
  assert.equal(tmdbTitlePreview({ id: 1, name: 'Show', first_air_date: '1999-09-09' }, 'series').releaseInfo, '1999');
});

test('company and network discovery send the right filters and cap TMDB pages', async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    requests.push(new URL(url));
    return new Response(JSON.stringify({ page: 2, total_pages: 900, total_results: 18000,
      results: [{ id: 5, title: 'Studio Film' }, { id: 6, title: 'Adult', adult: true }, { id: 0, title: 'Broken' }] }));
  };
  const movies = await discoverOrganizationTitles('company', 33, 'movie', 'newest', 2, 'key', 'en-US', false, '2026-11-01');
  assert.equal(requests[0].pathname, '/3/discover/movie');
  assert.equal(requests[0].searchParams.get('with_companies'), '33');
  assert.equal(requests[0].searchParams.get('sort_by'), 'primary_release_date.desc');
  assert.equal(requests[0].searchParams.get('primary_release_date.lte'), '2026-11-01');
  assert.equal(requests[0].searchParams.get('include_adult'), 'false');
  assert.equal(requests[0].searchParams.get('page'), '2');
  assert.deepEqual(movies.items.map((item) => item.id), ['tmdb:5']);
  assert.equal(movies.totalPages, 500);
  assert.equal(movies.totalResults, 18000);

  const shows = await discoverOrganizationTitles('network', 49, 'series', 'popular', 1, 'key', 'en-US', true);
  assert.equal(requests[1].pathname, '/3/discover/tv');
  assert.equal(requests[1].searchParams.get('with_networks'), '49');
  assert.equal(requests[1].searchParams.get('sort_by'), 'popularity.desc');
  assert.equal(requests[1].searchParams.get('include_adult'), 'true');
  assert.deepEqual(shows.items.map((item) => [item.id, item.type]), [['tmdb:5', 'series'], ['tmdb:6', 'series']]);
});

test('ages count completed years, up to a death date when there is one', () => {
  assert.equal(ageOn('1964-09-02', null, new Date('2026-09-01T00:00:00Z')), 61);
  assert.equal(ageOn('1964-09-02', null, new Date('2026-09-02T00:00:00Z')), 62);
  assert.equal(ageOn('1930-01-10', '2001-01-09'), 70);
  assert.equal(ageOn('', null), undefined);
});

test('person, company and network routes round-trip and reject invalid ids', () => {
  for (const route of [{ kind: 'person', id: 287 }, { kind: 'company', id: 33 }, { kind: 'network', id: 49 }]) {
    assert.equal(routeHash(route), `#/${route.kind}/${route.id}`);
    assert.deepEqual(parseRoute(routeHash(route)), route);
  }
  assert.deepEqual(parseRoute('#/person/abc'), { kind: 'tab', tab: 'home' });
  assert.deepEqual(parseRoute('#/company/0'), { kind: 'tab', tab: 'home' });
  assert.deepEqual(parseRoute('#/network/12/extra'), { kind: 'tab', tab: 'home' });
});

test('enrichment keeps TMDB ids for directors and writers', () => {
  const settings = { ...defaultTmdbSettings(), enabled: true };
  const meta = { id: 'tt1', type: 'movie', name: 'Film' };
  const enriched = applyTmdbMetadata(meta, { id: 1, data: { id: 1, credits: { cast: [], crew: [
    { id: 11, name: 'Dee Rector', job: 'Director' }, { id: 11, name: 'Dee Rector', job: 'Director' },
    { id: 12, name: 'Wri Ter', job: 'Screenplay' }
  ] } } }, settings);
  assert.deepEqual(enriched.director, ['Dee Rector']);
  assert.deepEqual(enriched.directorPeople, [{ id: 11, name: 'Dee Rector' }]);
  assert.deepEqual(enriched.writerPeople, [{ id: 12, name: 'Wri Ter' }]);
});
