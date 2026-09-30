import type { Stream } from './types';

export const RESOLUTIONS = ['any', '2160p', '1080p', '720p'] as const;
export const RELEASE_TYPES = [
  { key: 'remux', label: 'Remux', pattern: /\bremux\b/ },
  { key: 'bluray', label: 'BluRay', pattern: /\b(?:blu[\s.-]?ray|bd[\s.-]?rip|br[\s.-]?rip)\b/ },
  { key: 'web-dl', label: 'WEB-DL', pattern: /\bweb[\s.-]?dl\b/ },
  { key: 'webrip', label: 'WEBRip', pattern: /\bweb[\s.-]?rip\b/ },
  { key: 'hdtv', label: 'HDTV', pattern: /\b(?:hdtv|pdtv|dsr)\b/ },
  { key: 'dvd', label: 'DVD', pattern: /\b(?:dvd[\s.-]?rip|dvdscr|dvd)\b/ },
  { key: 'cam', label: 'CAM/TS', pattern: /\b(?:cam|hdcam|hdts|telesync|telecine|ts|tc)\b/ }
] as const;
export type Resolution = typeof RESOLUTIONS[number];
export type ReleaseType = typeof RELEASE_TYPES[number]['key'];
export type StreamSelectionPreferences = { enabled: boolean; resolution: Resolution; provider: string; releaseTypes: ReleaseType[] };
export type StreamSelectionContext = { preferences: StreamSelectionPreferences; manual: boolean; initialStream: Stream };
const SETTINGS_KEY = 'bridged-streams.stream-selection.v1';
export const defaultStreamSelection = (): StreamSelectionPreferences => ({ enabled: false, resolution: 'any', provider: '', releaseTypes: [] });

export function savedStreamSelection(): StreamSelectionPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<StreamSelectionPreferences> | null;
    return { enabled: value?.enabled === true,
      resolution: RESOLUTIONS.includes(value?.resolution as Resolution) ? value!.resolution! : 'any',
      provider: typeof value?.provider === 'string' ? value.provider : '',
      releaseTypes: Array.isArray(value?.releaseTypes)
        ? RELEASE_TYPES.filter((type) => value!.releaseTypes!.includes(type.key)).map((type) => type.key) : [] };
  } catch { return defaultStreamSelection(); }
}

export function saveStreamSelection(preferences: StreamSelectionPreferences): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences)); }
  catch { /* Selection works in memory when browser storage is unavailable. */ }
}

function streamText(stream: Stream): string {
  return [stream.name, stream.title, stream.description].filter(Boolean).join(' ').normalize('NFKC')
    .replace(/\p{Cf}/gu, '').toLowerCase().replace(/[–—−]/g, '-').replace(/_/g, ' ');
}

export function streamResolution(stream: Stream): Exclude<Resolution, 'any'> | undefined {
  const text = streamText(stream);
  if (/\b(?:2160p?|4k|uhd)\b/.test(text)) return '2160p';
  if (/\b1080p?\b/.test(text)) return '1080p';
  if (/\b720p?\b/.test(text)) return '720p';
  return undefined;
}

export function streamReleaseType(stream: Stream): ReleaseType | undefined {
  return RELEASE_TYPES.find((type) => type.pattern.test(streamText(stream)))?.key;
}

export function matchesStreamPreferences(stream: Stream, preferences: StreamSelectionPreferences): boolean {
  return (preferences.resolution === 'any' || streamResolution(stream) === preferences.resolution)
    && (!preferences.releaseTypes.length || preferences.releaseTypes.includes(streamReleaseType(stream)!));
}

// Callers supply only streams eligible for playback/casting, in stable provider order.
export function selectPreferredStream(streams: Stream[], preferences: StreamSelectionPreferences): Stream | undefined {
  const matches = streams.filter((stream) => matchesStreamPreferences(stream, preferences));
  return matches.find((stream) => preferences.provider && stream.addonUrl === preferences.provider) || matches[0];
}

export function selectionContext(stream: Stream, preferences: StreamSelectionPreferences, manual = true): StreamSelectionContext {
  return { initialStream: stream, manual, preferences: { ...preferences, releaseTypes: [...preferences.releaseTypes] } };
}

export function selectNextStream(streams: Stream[], context: StreamSelectionContext, allowAnyFallback = false): Stream | undefined {
  const { initialStream: selected, preferences, manual } = context;
  const candidates = !manual && preferences.enabled ? streams.filter((stream) => matchesStreamPreferences(stream, preferences)) : streams;
  const group = selected.behaviorHints?.bingeGroup;
  const sameGroup = candidates.find((stream) => group && stream.behaviorHints?.bingeGroup === group);
  const resolution = streamResolution(selected);
  const releaseType = streamReleaseType(selected);
  const sameSignature = (stream: Stream) => (!resolution || streamResolution(stream) === resolution)
    && (!releaseType || streamReleaseType(stream) === releaseType);
  const sameName = candidates.find((stream) => selected.name && stream.addonUrl === selected.addonUrl
    && stream.name === selected.name && (!preferences.enabled || sameSignature(stream)));
  const sameRelease = resolution || releaseType ? candidates.find((stream) => stream.addonUrl === selected.addonUrl && sameSignature(stream)) : undefined;
  const continuation = sameGroup || sameName || sameRelease;
  if (continuation) return continuation;
  if (preferences.enabled) return selectPreferredStream(streams, preferences);
  return streams.find((stream) => stream.addonUrl === selected.addonUrl) || (allowAnyFallback ? streams[0] : undefined);
}
