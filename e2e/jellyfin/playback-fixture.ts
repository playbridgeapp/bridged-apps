import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectLiveSession } from '../helpers/app';

export const server = 'https://jellyfin.test/base';
export const movie = { Id: 'movie', Name: 'Fixture Movie', Type: 'Movie', Container: 'mp4',
  RunTimeTicks: 1300000000, UserData: { PlaybackPositionTicks: 523450000, IsFavorite: false },
  MediaSources: [{ Id: 'source-movie', Container: 'mp4' }] };
export const episodes = Array.from({ length: 4 }, (_, index) => ({ Id: `ep-${index + 1}`, Name: `Episode ${index + 1}`,
  Type: 'Episode', SeriesId: 'series', SeriesName: 'Fixture Series', IndexNumber: index + 1, ParentIndexNumber: 1,
  Container: 'mp4', RunTimeTicks: 1300000000, UserData: { PlaybackPositionTicks: index === 2 ? 942500000 : 0 } }));
export const series = { Id: 'series', Name: 'Fixture Series', Type: 'Series', seasons: [
  { Id: 'season', Name: 'Season 1', IndexNumber: 1, SeriesId: 'series', Episodes: episodes }
] };

export async function mockBridge(page: Page, mode: 'modern' | 'linked' | 'direct' = 'modern') {
  await page.addInitScript((mode) => {
    const state = (window as any).__jellyfinBridge = {
      destination: { id: 'this-device', name: 'This device', kind: 'local', connected: true },
      calls: [] as any[], supplies: [] as any[], sessions: [] as any[], unlinks: 0, jumps: [] as number[], fail: false, endOnListen: false
    };
    const open = async (payload: any) => {
      state.calls.push(JSON.parse(JSON.stringify(payload)));
      if (state.fail || (payload.destinationId && (payload.destinationId !== state.destination.id || !state.destination.connected))) throw new Error('destination_changed');
      const target = new EventTarget();
      const session = {
        sessionId: `mock-${state.sessions.length + 1}`,
        addEventListener: (type: string, listener: EventListener) => {
          target.addEventListener(type, listener);
          if (type === 'ended' && state.endOnListen) target.dispatchEvent(new CustomEvent('ended', { detail: { reason: 'ended' } }));
        }, removeEventListener: target.removeEventListener.bind(target),
        emit: (type: string, detail: any) => target.dispatchEvent(new CustomEvent(type, { detail })),
        provideItems: async (id: string, batch: any) => { state.supplies.push({ id, ...batch }); },
        unlink: async () => { state.unlinks++; }, jump: async (index: number) => { state.jumps.push(index); }
      };
      state.sessions.push(session);
      return session;
    };
    (window as any).__bridgedTest = { playbridge: {
      capabilities: { playback: mode === 'modern' ? 1 : 0, linkedCast: mode !== 'direct' },
      cast: async (payload: any) => { state.calls.push(payload); if (state.fail) throw new Error('cast failed'); },
      ...(mode !== 'direct' ? { linkCast: open } : {}),
      ...(mode === 'modern' ? {
        play: open, getPlaybackDestination: async () => ({ destination: { ...state.destination } }),
        choosePlaybackDestination: async (options: any) => {
          state.destination = options?.destinationId === 'this-device'
            ? { id: 'this-device', name: 'This device', kind: 'local', connected: true }
            : { id: 'living-room', name: 'Living room TV', kind: 'native', connected: true };
          return { destination: { ...state.destination } };
        }
      } : {})
    } };
  }, mode);
}

export async function fixture(page: Page, options: { bridge?: 'modern' | 'linked' | 'direct'; nativeVideo?: boolean; localPlayer?: 'native'; library?: boolean } = {}) {
  if (options.bridge) await mockBridge(page, options.bridge);
  if (options.nativeVideo) await page.route('**/*movi-player*element*', route => route.abort());
  const video = readFileSync(join(__dirname, '../streams/fixtures/resume.mp4'));
  const audio = readFileSync(join(__dirname, 'fixtures/queue.m4a'));
  const state = { requests: [] as { path: string; method: string; query: string; body: any }[],
    failNext: '' as string, failPreparationIds: new Set<string>(), failFavorite: false, transcode: false, holdPreparation: null as Promise<void> | null,
    nextUpCalls: 0 };
  await page.route('https://jellyfin.test/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/base/, '');
    const body = request.postDataJSON();
    state.requests.push({ path, method: request.method(), query: url.search, body });
    if (path.includes('/stream')) {
      const media = path.startsWith('/Audio/') ? audio : video;
      const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0;
      const end = range ? Math.min(range[2] ? Number(range[2]) : media.length - 1, media.length - 1) : media.length - 1;
      return route.fulfill({ status: range ? 206 : 200, body: media.subarray(start, end + 1), headers: {
        'content-type': path.startsWith('/Audio/') ? 'audio/mp4' : 'video/mp4', 'content-length': String(end - start + 1), 'accept-ranges': 'bytes',
        'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Length,Content-Range,Accept-Ranges',
        ...(range ? { 'content-range': `bytes ${start}-${end}/${media.length}` } : {})
      } });
    }
    if (path.endsWith('/PlaybackInfo')) {
      if (state.holdPreparation) await state.holdPreparation;
      const id = path.split('/')[2];
      if (id === state.failNext || state.failPreparationIds.has(id)) { state.failNext = ''; return route.fulfill({ status: 503, json: {} }); }
      return route.fulfill({ json: { PlaySessionId: `play-${id}`, MediaSources: [{ Id: body.MediaSourceId || `source-${id}`, Container: body.MediaSourceId === 'alternate' ? 'mkv' : 'mp4',
        SupportsDirectPlay: !state.transcode, SupportsDirectStream: false,
        ...(state.transcode ? { TranscodingUrl: `/Videos/${id}/master.m3u8?PlaySessionId=play-${id}` } : {}),
        MediaStreams: [{ Type: 'Audio', Index: 0, DisplayTitle: 'English' },
          { Type: 'Subtitle', Index: 2, Language: 'en', DisplayTitle: 'English CC', DeliveryMethod: 'External',
            DeliveryUrl: `/base/Videos/${id}/Subtitles/2/Stream.vtt` }] }] } });
    }
    if (path.includes('/FavoriteItems/')) return route.fulfill({ status: state.failFavorite ? 500 : 200, json: {} });
    if (path.startsWith('/Sessions/Playing')) return route.fulfill({ json: {} });
    if (path.endsWith('/Views')) return route.fulfill({ json: { Items: options.library
      ? [{ Id: 'shared-library', Name: 'Shared music', CollectionType: 'music' }] : [] } });
    if (path.endsWith('/Resume')) return route.fulfill({ json: { Items: [movie] } });
    if (path.endsWith('/Latest')) return route.fulfill({ json: [movie] });
    if (path === '/Shows/NextUp') { state.nextUpCalls++; return route.fulfill({ json: { Items: [episodes[2]] } }); }
    if (path.endsWith('/Items')) {
      const type = url.searchParams.get('IncludeItemTypes');
      if (options.library && url.searchParams.get('ParentId') === 'shared-library') {
        const owner = path.startsWith('/Users/other-user/') ? 'B' : 'A';
        return route.fulfill({ json: { Items: [{ Id: `song-${owner}`, Name: `Account ${owner} song`, Type: 'Audio' }], TotalRecordCount: 1 } });
      }
      const items = url.searchParams.has('SearchTerm') || url.searchParams.has('Filters')
        ? [{ Id: 'old-song', Name: 'Older Favorite Song', Type: 'Audio', UserData: { IsFavorite: true } }]
        : type === 'Series' ? [series] : [movie];
      return route.fulfill({ json: { Items: items, TotalRecordCount: items.length } });
    }
    if (path.endsWith('/Items/movie')) return route.fulfill({ json: { ...movie, MediaSources: [
      { Id: 'source-movie', Container: 'mp4', MediaStreams: [{ Type: 'Audio', Index: 0, DisplayTitle: 'English' },
        { Type: 'Subtitle', Index: 2, DisplayTitle: 'English CC' }] }, { Id: 'alternate', Container: 'mkv' }
    ] } });
    if (path.endsWith('/Items/series')) return route.fulfill({ json: series });
    if (path.endsWith('/Stream.vtt')) return route.fulfill({ body: 'WEBVTT\n\n00:00:00.000 --> 00:02:00.000\nFixture subtitle\n', contentType: 'text/vtt' });
    if (path.includes('/Images/')) return route.fulfill({ status: 404 });
    return route.fulfill({ json: {} });
  });
  await connectLiveSession(page, { id: 'mock', url: server, userId: 'user', token: 'mock-token', username: 'Test user', serverName: 'Fixture server', isDemo: false, connected: true, lastActive: 0 });
  if (options.localPlayer) await page.getByLabel('This device player', { exact: true }).selectOption(options.localPlayer);
  return state;
}
