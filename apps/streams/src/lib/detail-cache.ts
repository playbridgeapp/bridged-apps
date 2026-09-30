import type { MediaType, MetaPreview } from './types';

const CACHE_KEY = 'bridged-streams.detail-preview.v1';
const MAX_TITLES = 24;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
type Entry = { preview: MetaPreview; savedAt: number };

function read(): Entry[] {
  try {
    const entries: unknown = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '[]');
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry): entry is Entry => !!entry && typeof entry.savedAt === 'number'
      && Date.now() - entry.savedAt < MAX_AGE_MS && typeof entry.preview?.id === 'string'
      && typeof entry.preview?.name === 'string' && ['movie', 'series', 'sport', 'library'].includes(entry.preview?.type));
  } catch { return []; }
}

export function cachedDetailPreview(type: MediaType, id: string): MetaPreview | undefined {
  return read().find((entry) => entry.preview.type === type && entry.preview.id === id)?.preview;
}

export function saveDetailPreview(meta: MetaPreview): void {
  if (!meta.name || meta.name === meta.id) return;
  // Keep only display fields, never account data, streams, or playback state.
  const { id, type, name, poster, background, logo, description, releaseInfo, imdbRating, genres } = meta;
  const preview: MetaPreview = { id, type, name, poster, background, logo, description, releaseInfo, imdbRating, genres };
  const entries = [{ preview, savedAt: Date.now() }, ...read().filter((entry) => entry.preview.type !== type || entry.preview.id !== id)]
    .slice(0, MAX_TITLES);
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(entries)); }
  catch { /* Unavailable storage must not interrupt navigation. */ }
}
