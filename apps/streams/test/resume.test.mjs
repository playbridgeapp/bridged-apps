import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSeason, resumeEpisode, resumePositionMs } from '../src/lib/resume.ts';

const meta = { id: 'tt-series', type: 'series', name: 'Series', videos: [
  { id: 'special', season: 0, episode: 1 },
  { id: 's1e1', season: 1, episode: 1 },
  { id: 's1e2', season: 1, episode: 2 }
] };

test('untracked shows start on season 1 even when specials appear first', () => {
  assert.equal(defaultSeason(meta.videos), 1);
  assert.equal(defaultSeason([{ id: 'special', season: 0, episode: 1 }]), 0);
});

test('Nuvio progress selects the tracked episode by season when addon video IDs differ', () => {
  const nuvio = [{ progress_key: 'tt-series_s1e2', content_id: 'tt-series', content_type: 'series',
    video_id: 'other-addon-id', season: 1, episode: 2, position: 720_000, duration: 2_400_000,
    last_watched: 1_700_000_000_000 }];
  const selected = resumeEpisode(meta, [], [], nuvio);
  assert.equal(selected?.id, 's1e2');
  assert.equal(resumePositionMs(meta, selected, [], nuvio), 720_000);
  assert.equal(resumePositionMs(meta, meta.videos[1], [], nuvio), 0);
});

test('the latest active progress wins across Stremio and Nuvio', () => {
  const stremio = [{ id: 'tt-series', type: 'series', lastVideoId: 's1e1',
    lastWatched: '2024-01-01T00:00:00Z', record: { state: { timeOffset: 500_000, duration: 2_000_000 } } }];
  const nuvio = [{ progress_key: 'tt-series_s1e2', content_id: 'tt-series', content_type: 'series',
    video_id: 's1e2', season: 1, episode: 2, position: 800_000, duration: 2_000_000,
    last_watched: Date.parse('2024-01-02T00:00:00Z') }];
  assert.equal(resumeEpisode(meta, stremio, [], nuvio)?.id, 's1e2');
  assert.equal(resumePositionMs(meta, meta.videos[1], stremio, nuvio), 500_000);
});

test('Stremio episode coordinates work when another addon uses different IDs', () => {
  const stremio = [{ id: 'tt-series', type: 'series', lastVideoId: 'tt-series:1:2',
    lastWatched: '2024-01-01T00:00:00Z', record: { state: { timeOffset: 650_000, duration: 2_000_000 } } }];
  const selected = resumeEpisode(meta, stremio, [], []);
  assert.equal(selected?.id, 's1e2');
  assert.equal(resumePositionMs(meta, selected, stremio, []), 650_000);
});

test('completed progress is not used as a resume position', () => {
  const movie = { id: 'tt-movie', type: 'movie', name: 'Movie' };
  const nuvio = [{ progress_key: 'tt-movie', content_id: 'tt-movie', content_type: 'movie',
    video_id: 'tt-movie', position: 1_980_000, duration: 2_000_000, last_watched: 1_700_000_000_000 }];
  assert.equal(resumePositionMs(movie, null, [], nuvio), 0);
});

test('a completed Nuvio episode can still select its season without seeking near the end', () => {
  const nuvio = [{ progress_key: 'tt-series_s1e2', content_id: 'tt-series', content_type: 'series',
    video_id: 's1e2', season: 1, episode: 2, position: 1_980_000, duration: 2_000_000,
    last_watched: 1_700_000_000_000 }];
  assert.equal(resumeEpisode(meta, [], [], nuvio)?.id, 's1e2');
  assert.equal(resumePositionMs(meta, meta.videos[2], [], nuvio), 0);
});
