import type { JellyfinItem, JellyfinMediaSource, PlaybackSelection, PreparedPlayback, ServerConfig } from '../types';
import { buildAudioStreamUrl, buildDirectStreamUrl, cleanServerUrl, getAuthHeaders, getDeviceId } from './jellyfin';

export function resumePositionMs(item: JellyfinItem): number {
  const ms = Number(item.UserData?.PlaybackPositionTicks || 0) / 10000;
  return Number.isFinite(ms) && ms > 0 ? Math.min(604800000, Math.floor(ms)) : 0;
}

export function mediaContentType(container = '', audio = false): string {
  const format = container.toLowerCase().split(',')[0];
  if (format === 'm3u8' || format === 'hls') return 'application/vnd.apple.mpegurl';
  if (format === 'mpd') return 'application/dash+xml';
  const types: Record<string, string> = audio
    ? { mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac', m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav' }
    : { mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', ts: 'video/mp2t' };
  return types[format] || 'application/octet-stream';
}

/** Never attach a server token to a different origin supplied by metadata. */
function authenticatedMediaUrl(config: ServerConfig, path: string): string {
  const base = cleanServerUrl(config.url);
  const basePath = new URL(base).pathname.replace(/\/$/, '');
  const normalized = path.startsWith('/') && !path.startsWith('//') && basePath
    && !path.startsWith(`${basePath}/`) ? `${basePath}${path}` : path;
  const url = new URL(normalized, `${base}/`);
  if (url.origin !== new URL(base).origin) throw new Error('Jellyfin returned a media URL on a different origin.');
  url.searchParams.set('api_key', config.token);
  return url.href;
}

export async function preparePlayback(config: ServerConfig, item: JellyfinItem,
  selection: PlaybackSelection = {}, target: 'browser' | 'local' | 'native' | 'external' = 'browser',
  positionMs = resumePositionMs(item)): Promise<PreparedPlayback> {
  if (config.isDemo || item.streamUrl) {
    const url = item.streamUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    const extension = new URL(url).pathname.split('.').pop();
    return { url, mediaSourceId: item.Id, contentType: mediaContentType(extension, item.Type === 'Audio'),
      playMethod: 'DirectPlay', startPositionMs: positionMs };
  }

  // Browser video uses Movi (WASM) when available. External receivers get a
  // conservative profile; do not advertise phone decoder support on a TV.
  const broad = target !== 'external';
  const deviceProfile = {
    Name: `PlayBridge ${target}`, MaxStreamingBitrate: 120000000,
    DirectPlayProfiles: [
      { Type: 'Video', Container: broad ? 'mp4,m4v,mkv,webm,mov,ts' : 'mp4,m4v',
        VideoCodec: broad ? 'h264,hevc,vp8,vp9,av1,mpeg2video' : 'h264',
        AudioCodec: broad ? 'aac,mp3,ac3,eac3,flac,opus,vorbis' : 'aac,mp3' },
      { Type: 'Audio', Container: target === 'browser' ? 'mp3,aac,m4a,mp4,wav,ogg,flac' : 'mp3,aac,m4a,mp4,wav,ogg,flac,opus' }
    ],
    TranscodingProfiles: [
      { Type: 'Video', Container: 'ts', Protocol: 'hls', VideoCodec: 'h264', AudioCodec: 'aac', Context: 'Streaming' },
      { Type: 'Audio', Container: 'mp3', AudioCodec: 'mp3', Context: 'Streaming', Protocol: 'http' }
    ],
    SubtitleProfiles: [{ Format: 'vtt', Method: 'External' }]
  };
  const res = await fetch(`${cleanServerUrl(config.url)}/Items/${item.Id}/PlaybackInfo`, {
    method: 'POST', headers: { ...getAuthHeaders(config.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ UserId: config.userId, DeviceId: getDeviceId(), IsPlayback: true,
      // Request a full timeline. The player/bridge applies resume by seeking,
      // avoiding a double offset on server-generated transcoding URLs.
      StartTimeTicks: 0, EnableDirectPlay: selection.audioStreamIndex === undefined && selection.subtitleStreamIndex === undefined, EnableDirectStream: true,
      MediaSourceId: selection.mediaSourceId, AudioStreamIndex: selection.audioStreamIndex,
      SubtitleStreamIndex: selection.subtitleStreamIndex, DeviceProfile: deviceProfile })
  });
  if (!res.ok) throw new Error(`Jellyfin playback preparation failed (HTTP ${res.status}).`);
  const info = await res.json();
  if (info.ErrorCode) throw new Error(`Jellyfin cannot play this item (${info.ErrorCode}).`);
  const sources: JellyfinMediaSource[] = info.MediaSources || [];
  const source = selection.mediaSourceId ? sources.find(s => s.Id === selection.mediaSourceId) : sources[0];
  if (!source) throw new Error('Jellyfin did not return a playable media source.');
  const audio = item.Type === 'Audio';
  let url: string;
  let playMethod: PreparedPlayback['playMethod'];
  let contentType: string;
  if (source.SupportsDirectPlay && selection.audioStreamIndex === undefined) {
    url = audio ? buildAudioStreamUrl(config.url, item.Id, config.token, source.Id)
      : buildDirectStreamUrl(config.url, item.Id, config.token, source.Id, source.Container?.split(',')[0]);
    playMethod = 'DirectPlay';
    contentType = mediaContentType(source.Container, audio);
  } else if (source.SupportsDirectStream && source.DirectStreamUrl) {
    url = authenticatedMediaUrl(config, source.DirectStreamUrl);
    playMethod = 'DirectStream';
    contentType = mediaContentType(new URL(url).pathname.split('.').pop(), audio);
  } else if (source.TranscodingUrl) {
    url = authenticatedMediaUrl(config, source.TranscodingUrl);
    playMethod = source.SupportsDirectStream ? 'DirectStream' : 'Transcode';
    contentType = mediaContentType(new URL(url).pathname.split('.').pop(), audio);
  } else if (source.SupportsDirectPlay) {
    throw new Error('The selected audio track requires a stream Jellyfin did not provide.');
  } else {
    throw new Error('No compatible direct or transcoded stream is available.');
  }
  const mediaUrl = new URL(url);
  if (info.PlaySessionId) mediaUrl.searchParams.set('PlaySessionId', info.PlaySessionId);
  url = mediaUrl.href;
  const subtitle = (source.MediaStreams || item.MediaStreams || []).find(s => s.Type === 'Subtitle'
    && s.Index === (selection.subtitleStreamIndex ?? source.DefaultSubtitleStreamIndex));
  const subtitleResources = subtitle?.DeliveryUrl && subtitle.DeliveryMethod === 'External'
    ? [{ url: authenticatedMediaUrl(config, subtitle.DeliveryUrl), language: subtitle.Language, label: subtitle.DisplayTitle }] : undefined;
  return { url, contentType, mediaSourceId: source.Id, playSessionId: info.PlaySessionId,
    playMethod, startPositionMs: positionMs, subtitleResources };
}
