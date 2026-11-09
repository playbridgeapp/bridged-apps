import type { Thumbnail } from './types';

const INSTANCE_KEY = 'bridged-invidious.instance.v1';

/** Scheme, host and port of an http(s) URL without a path, or null when invalid. */
export function normalizeInstance(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function savedInstance(fallback = ''): string {
  try {
    return normalizeInstance(localStorage.getItem(INSTANCE_KEY) || '') || normalizeInstance(fallback) || '';
  } catch {
    return normalizeInstance(fallback) || '';
  }
}

export function saveInstance(origin: string): void {
  try { localStorage.setItem(INSTANCE_KEY, origin); } catch { /* Storage may be unavailable. */ }
}

/**
 * Where API requests go. A page served from the instance's origin, or a dev
 * server relaying it, uses its own origin so signed-in requests stay same-origin.
 */
export function apiBase(instance: string, pageOrigin: string, relayTarget: string): string {
  if (instance === pageOrigin) return pageOrigin;
  if (relayTarget && normalizeInstance(relayTarget) === instance) return pageOrigin;
  return instance;
}

/** An instance-relative or protocol-relative URL made absolute on the instance. */
export function instanceUrl(instance: string, value: string): string {
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `${instance}${value}`;
  return value;
}

/** Channel artwork from Google's image host, relayed by the instance so it never contacts Google. */
export function imageUrl(instance: string, value: string): string {
  const absolute = instanceUrl(instance, value);
  try {
    const url = new URL(absolute);
    if (/^yt\d*\.(ggpht|googleusercontent)\.com$/.test(url.hostname)) return `${instance}/ggpht${url.pathname}${url.search}`;
  } catch { /* Fall through. */ }
  return absolute;
}

const PREFERRED_THUMBS = ['medium', 'high', 'sddefault', 'maxres', 'maxresdefault', 'default'];

export function videoThumbnail(instance: string, videoId: string, thumbnails?: Thumbnail[]): string {
  for (const quality of PREFERRED_THUMBS) {
    const match = thumbnails?.find((thumb) => thumb.quality === quality);
    if (match) return imageUrl(instance, match.url);
  }
  return `${instance}/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

/** The largest thumbnail at or under [maxWidth], else the smallest one. */
export function avatar(instance: string, thumbnails?: Thumbnail[], maxWidth = 176): string {
  if (!thumbnails?.length) return '';
  const sorted = [...thumbnails].sort((a, b) => (a.width || 0) - (b.width || 0));
  const fit = sorted.filter((thumb) => (thumb.width || 0) <= maxWidth).pop() || sorted[0];
  return imageUrl(instance, fit.url);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function formatCount(count: number | undefined, noun: string): string {
  if (count == null || !Number.isFinite(count) || count < 0) return '';
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(count);
  return `${compact} ${noun}${count === 1 ? '' : 's'}`;
}
