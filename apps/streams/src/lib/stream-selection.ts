import type { Stream } from './types';
import { matchesFingerprint } from './stream-reuse.ts';
import type { StreamFingerprint } from './stream-reuse.ts';

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
export const AUTO_PLAY_MODES = ['manual', 'first', 'regex', 'preferences'] as const;
export const TIMEOUT_SECONDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 'unlimited'] as const;
export const LAST_LINK_HOURS = [1, 2, 3, 6, 12, 24, 48, 72, 168] as const;
export type AutoPlayMode = typeof AUTO_PLAY_MODES[number];
export type StreamSelectionPreferences = {
  mode: AutoPlayMode; sortByPreference: boolean; resolution: Resolution; provider: string; releaseTypes: ReleaseType[];
  regex: string; timeoutSeconds: typeof TIMEOUT_SECONDS[number]; scope: 'all' | 'addons' | 'plugins';
  allowedAddons: string[]; allowedPlugins: string[]; reuseLastLink: boolean; lastLinkHours: number;
  nextEpisodeAutoPlay: boolean; preferBingeGroup: boolean; bingeFallback: boolean; reuseBingeGroup: boolean;
};
export type StreamSelectionContext = { preferences: StreamSelectionPreferences; manual: boolean; initialStream: Stream; reuseScope?: string };
export const STREAM_SELECTION_KEY = 'bridged-streams.stream-selection.v2';
const LEGACY_KEY = 'bridged-streams.stream-selection.v1';
export const defaultStreamSelection = (): StreamSelectionPreferences => ({
  mode: 'manual', sortByPreference: false, resolution: 'any', provider: '', releaseTypes: [], regex: '', timeoutSeconds: 3,
  scope: 'all', allowedAddons: [], allowedPlugins: [], reuseLastLink: false, lastLinkHours: 24,
  nextEpisodeAutoPlay: true, preferBingeGroup: true, bingeFallback: true, reuseBingeGroup: false
});

function nearest(value: unknown, values: readonly number[], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return values.reduce((best, next) => Math.abs(value - next) < Math.abs(value - best) ? next : best);
}

export function normalizeStreamSelection(raw: unknown, legacy = false): StreamSelectionPreferences {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && !!id))].slice(0, 200) : [];
  return {
    mode: legacy ? value.enabled === true ? 'preferences' : 'manual' : AUTO_PLAY_MODES.includes(value.mode as AutoPlayMode) ? value.mode as AutoPlayMode : 'manual',
    sortByPreference: value.sortByPreference === true,
    resolution: RESOLUTIONS.includes(value.resolution as Resolution) ? value.resolution as Resolution : 'any',
    provider: typeof value.provider === 'string' ? value.provider : '',
    releaseTypes: RELEASE_TYPES.filter((type) => Array.isArray(value.releaseTypes) && value.releaseTypes.includes(type.key)).map((type) => type.key),
    regex: typeof value.regex === 'string' ? value.regex : '',
    timeoutSeconds: value.timeoutSeconds === 'unlimited' || value.timeoutSeconds === 2147483647 ? 'unlimited'
      : nearest(value.timeoutSeconds, TIMEOUT_SECONDS.filter((value) => value !== 'unlimited'), 3) as StreamSelectionPreferences['timeoutSeconds'],
    scope: value.scope === 'addons' || value.scope === 'plugins' ? value.scope : 'all',
    allowedAddons: ids(value.allowedAddons), allowedPlugins: ids(value.allowedPlugins), reuseLastLink: value.reuseLastLink === true,
    lastLinkHours: nearest(value.lastLinkHours, LAST_LINK_HOURS, 24),
    nextEpisodeAutoPlay: value.nextEpisodeAutoPlay !== false, preferBingeGroup: value.preferBingeGroup !== false,
    bingeFallback: value.bingeFallback !== false, reuseBingeGroup: value.reuseBingeGroup === true
  };
}

export function savedStreamSelection(): StreamSelectionPreferences {
  try {
    const stored = localStorage.getItem(STREAM_SELECTION_KEY);
    if (stored !== null) return normalizeStreamSelection(JSON.parse(stored));
    const value = normalizeStreamSelection(JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}'), true);
    saveStreamSelection(value);
    return value;
  } catch { return defaultStreamSelection(); }
}

export function saveStreamSelection(preferences: StreamSelectionPreferences): void {
  try { localStorage.setItem(STREAM_SELECTION_KEY, JSON.stringify(normalizeStreamSelection(preferences))); }
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

export function selectionContext(stream: Stream, preferences: StreamSelectionPreferences, manual = true, reuseScope?: string): StreamSelectionContext {
  return { initialStream: stream, manual, reuseScope, preferences: { ...preferences, releaseTypes: [...preferences.releaseTypes],
    allowedAddons: [...preferences.allowedAddons], allowedPlugins: [...preferences.allowedPlugins] } };
}

export function streamSource(stream: Stream): { id: string; kind: 'addon' | 'plugin' } {
  return stream.selectionSource || { id: stream.addonUrl, kind: 'addon' };
}

export function sourceAllowed(source: { id: string; kind: 'addon' | 'plugin' }, preferences: StreamSelectionPreferences): boolean {
  if (preferences.scope === 'addons' && source.kind !== 'addon' || preferences.scope === 'plugins' && source.kind !== 'plugin') return false;
  const allowed = source.kind === 'addon' ? preferences.allowedAddons : preferences.allowedPlugins;
  return !allowed.length || allowed.includes(source.id);
}

export function selectNextStream(streams: Stream[], context: StreamSelectionContext): Stream | undefined {
  const { initialStream: selected, preferences } = context;
  if (!preferences.nextEpisodeAutoPlay) return;
  const candidates = streams.filter((stream) => sourceAllowed(streamSource(stream), preferences));
  if (preferences.preferBingeGroup) {
    const group = selected.behaviorHints?.bingeGroup;
    const sameGroup = candidates.find((stream) => group && stream.behaviorHints?.bingeGroup === group);
    if (sameGroup) return sameGroup;
    const resolution = streamResolution(selected), release = streamReleaseType(selected);
    const sameSignature = (stream: Stream) => (!resolution || streamResolution(stream) === resolution) && (!release || streamReleaseType(stream) === release);
    const sameName = candidates.find((stream) => selected.name && stream.addonUrl === selected.addonUrl && stream.name === selected.name && sameSignature(stream));
    const sameRelease = resolution || release ? candidates.find((stream) => stream.addonUrl === selected.addonUrl && sameSignature(stream)) : undefined;
    if (sameName || sameRelease) return sameName || sameRelease;
  }
  if (!preferences.bingeFallback) return;
  return selectModeStream(candidates, preferences) || (preferences.mode === 'manual' ? candidates[0] : undefined);
}

export const REGEX_PRESETS = [
  ['1080p or higher', '(2160p|4k|1080p)'], ['4K / Remux', '(2160p|4k|remux)'],
  ['1080p standard', '(1080p|full\\s*hd)'], ['720p / smaller', '(720p|webrip|web-dl)'],
  ['Web sources', '(web[-\\s]?dl|webrip)'], ['BluRay quality', '(bluray|b[dr]rip|remux)'],
  ['HEVC / x265', '(hevc|x265|h\\.265)'], ['AVC / x264', '(x264|h\\.264|avc)'],
  ['HDR / Dolby Vision', '(hdr|hdr10\\+?|dv|dolby\\s*vision)'], ['Atmos / DTS', '(atmos|truehd|dts[-\\s]?hd|dtsx?)'],
  ['English', '(\\beng\\b|english)'], ['No CAM / TS', '^(?!.*\\b(cam|hdcam|ts|telesync)\\b).*$'],
  ['No Remux / HDR', '(?is)^(?!.*\\b(hdr|hdr10|dv|dolby|vision|hevc|remux|2160p)\\b).+$']
] as const;

export function compileStreamRegex(pattern: string): { matches: (stream: Stream) => boolean; error?: string } {
  if (pattern.length > 500) return { matches: () => false, error: 'Use a pattern of 500 characters or fewer.' };
  if (!/[\p{L}\p{N}]/u.test(pattern)) return { matches: () => false, error: 'Include a letter or digit in the pattern.' };
  try {
    // Mobile's presets use leading Kotlin inline flags; JavaScript takes them separately.
    const normalized = pattern.trim().replace(/^\(\?[is]+\)/, '');
    const regex = new RegExp(normalized, /^\(\?[is]*s[is]*\)/.test(pattern.trim()) ? 'is' : 'i');
    const excluded = [...pattern.matchAll(/\(\?![^)]*?\(([^)]+)\)/g)].flatMap((match) => match[1].split('|')).map((word) => word.trim()).filter(Boolean);
    const exclusions = excluded.length ? new RegExp(`\\b(?:${excluded.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i') : null;
    return { matches: (stream) => {
      const text = [stream.addonName, stream.name, stream.title, stream.description, stream.url].filter(Boolean).join(' ');
      return regex.test(text) && !exclusions?.test(text);
    } };
  } catch { return { matches: () => false, error: 'Invalid regular expression.' }; }
}

export function autoPlayEnabled(preferences: StreamSelectionPreferences): boolean {
  return preferences.reuseLastLink || preferences.reuseBingeGroup && preferences.preferBingeGroup
    || preferences.mode === 'first' || preferences.mode === 'preferences'
    || preferences.mode === 'regex' && !compileStreamRegex(preferences.regex).error;
}

function selectModeStream(streams: Stream[], preferences: StreamSelectionPreferences): Stream | undefined {
  if (preferences.mode === 'first') return streams[0];
  if (preferences.mode === 'preferences') return selectPreferredStream(streams, preferences);
  if (preferences.mode === 'regex') return streams.find(compileStreamRegex(preferences.regex).matches);
}

export type AutoPlaySource = { id: string; kind: 'addon' | 'plugin'; streams: Stream[]; loading: boolean };
export type AutoPlayContext = { startedAt: number; now: number; restoring?: boolean; preferredBingeGroup?: string; lastLink?: StreamFingerprint };
export type AutoPlayEvaluation = { stream?: Stream; waiting: boolean; reason: 'manual' | 'waiting' | 'last-link' | 'binge-group' | 'match' | 'no-match' | 'timeout' | 'invalid-regex' };

export function evaluateAutoPlay(sources: AutoPlaySource[], preferences: StreamSelectionPreferences, context: AutoPlayContext): AutoPlayEvaluation {
  if (!autoPlayEnabled(preferences)) return { waiting: false, reason: preferences.mode === 'regex' ? 'invalid-regex' : 'manual' };
  const eligible = sources.filter((source) => sourceAllowed(source, preferences));
  const streams = eligible.flatMap((source) => source.streams);
  const pending = !!context.restoring || eligible.some((source) => source.loading);
  const elapsed = Math.max(0, context.now - context.startedAt);
  if (elapsed >= 60_000 && (pending || preferences.timeoutSeconds === 'unlimited')) return { waiting: false, reason: 'timeout' };
  const reused = preferences.reuseLastLink && context.lastLink ? streams.find((stream) => matchesFingerprint(stream, context.lastLink!)) : undefined;
  const group = preferences.preferBingeGroup && context.preferredBingeGroup ? streams.find((stream) => stream.behaviorHints?.bingeGroup === context.preferredBingeGroup) : undefined;
  const stream = reused || group || selectModeStream(streams, preferences);
  const deadline = preferences.timeoutSeconds !== 'unlimited' && elapsed >= preferences.timeoutSeconds * 1000;
  if (pending && preferences.timeoutSeconds !== 0 && !deadline) {
    if (preferences.timeoutSeconds !== 'unlimited' && preferences.mode === 'preferences' && preferences.provider && !context.lastLink && !context.preferredBingeGroup) {
      const ready = selectReadyPreferredStream(eligible, preferences, context.restoring);
      if (ready) return { stream: ready, waiting: false, reason: 'match' };
    }
    return { waiting: true, reason: 'waiting' };
  }
  if (stream) return { stream, waiting: false, reason: reused ? 'last-link' : group ? 'binge-group' : 'match' };
  if (pending && preferences.timeoutSeconds === 0) return { waiting: true, reason: 'waiting' };
  return { waiting: false, reason: deadline && pending ? 'timeout' : 'no-match' };
}
