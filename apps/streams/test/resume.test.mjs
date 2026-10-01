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

test('Next up uses addon coordinates and starts at zero instead of old partial progress', () => {
  const nuvio = [
    { content_id: meta.id, content_type: meta.type, video_id: 's1e1', season: 1, episode: 1,
      position: 1800000, duration: 2000000, last_watched: 1700000001000 },
    { content_id: meta.id, content_type: meta.type, video_id: 'other-addon-id', season: 1, episode: 2,
      position: 60000, duration: 2000000, last_watched: 1700000000000 }
  ];
  const selected = resumeEpisode(meta, [], [], nuvio);
  assert.equal(selected.id, 's1e2');
  assert.equal(resumePositionMs(meta, selected, [], nuvio), 0);
});

test('an episode manually marked watched selects Next up with no seek', () => {
  const nuvio = [{ content_id: meta.id, content_type: meta.type, video_id: 's1e1', season: 1, episode: 1,
    position: 60000, duration: 2000000, last_watched: 1700000000000 }];
  const watched = [{ content_id: meta.id, content_type: meta.type, season: 1, episode: 1, watched_at: 1700000001000 }];
  assert.equal(resumeEpisode(meta, [], [], nuvio, watched).id, 's1e2');
  assert.equal(resumePositionMs(meta, meta.videos[1], [], nuvio, watched), 0);
});

test('Next up ignores older Stremio progress but preserves a newer partial watch', () => {
  const nuvio = [{ content_id: meta.id, content_type: meta.type, video_id: 's1e1', season: 1, episode: 1,
    position: 2000000, duration: 2000000, last_watched: 1700000001000 }];
  const stremio = [{ id: meta.id, type: meta.type, lastVideoId: 's1e2',
    lastWatched: new Date(1700000000000).toISOString(), record: { state: { timeOffset: 60000, duration: 2000000 } } }];
  assert.equal(resumePositionMs(meta, meta.videos[2], stremio, nuvio), 0);
  stremio[0].lastWatched = new Date(1700000002000).toISOString();
  assert.equal(resumePositionMs(meta, meta.videos[2], stremio, nuvio), 60000);
});
