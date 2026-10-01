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
export type StreamSelectionPreferences = { enabled: boolean; sortByPreference: boolean; resolution: Resolution; provider: string; releaseTypes: ReleaseType[] };
export type StreamSelectionContext = { preferences: StreamSelectionPreferences; manual: boolean; initialStream: Stream };
const SETTINGS_KEY = 'bridged-streams.stream-selection.v1';
export const defaultStreamSelection = (): StreamSelectionPreferences => ({ enabled: false, sortByPreference: false, resolution: 'any', provider: '', releaseTypes: [] });

export function savedStreamSelection(): StreamSelectionPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<StreamSelectionPreferences> | null;
    return { enabled: value?.enabled === true, sortByPreference: value?.sortByPreference === true,
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

export function matchesAllStreamPreferences(stream: Stream, preferences: StreamSelectionPreferences): boolean {
  return !!(preferences.resolution !== 'any' || preferences.releaseTypes.length || preferences.provider)
    && matchesStreamPreferences(stream, preferences)
    && (!preferences.provider || stream.addonUrl === preferences.provider);
}

// Sort only the displayed list; automatic playback continues to use its original order.
export function sortStreamsByPreference(streams: Stream[], preferences: StreamSelectionPreferences): Stream[] {
  if (!preferences.sortByPreference) return streams;
  return streams.map((stream, index) => {
    const providerMatch = !!preferences.provider && stream.addonUrl === preferences.provider;
    const fullMatch = matchesStreamPreferences(stream, preferences);
    const score = Number(providerMatch)
      + Number(preferences.resolution !== 'any' && streamResolution(stream) === preferences.resolution)
      + Number(!!preferences.releaseTypes.length && preferences.releaseTypes.includes(streamReleaseType(stream)!));
    return { stream, index, group: fullMatch ? (providerMatch ? 3 : 2) : 1, score };
  }).sort((a, b) => b.group - a.group || b.score - a.score || a.index - b.index)
    .map(({ stream }) => stream);
}

// Callers supply only streams eligible for playback/casting, in stable provider order.
export function selectPreferredStream(streams: Stream[], preferences: StreamSelectionPreferences): Stream | undefined {
  const matches = streams.filter((stream) => matchesStreamPreferences(stream, preferences));
  return matches.find((stream) => preferences.provider && stream.addonUrl === preferences.provider) || matches[0];
}

// A ready preferred provider wins immediately. Otherwise wait only for providers
// that could still outrank the first match, preserving the normal provider order.
export function selectReadyPreferredStream(providers: { id: string; streams: Stream[]; loading: boolean }[],
  preferences: StreamSelectionPreferences, restoring = false): Stream | undefined {
  const preferred = providers.find((provider) => provider.id === preferences.provider);
  if (preferred && !preferred.loading) {
    const match = selectPreferredStream(preferred.streams, preferences);
    if (match) return match;
  }
  if (restoring || preferred?.loading) return;
  for (const provider of providers) {
    if (provider.loading) return;
    const match = selectPreferredStream(provider.streams, preferences);
    if (match) return match;
  }
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
