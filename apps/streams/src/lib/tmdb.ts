import type { MediaType, Meta, MetaPreview, Video } from './types';
import type { TmdbSettings } from './tmdb-settings';

const CACHE_KEY = 'bridged-streams.tmdb-cache.v1';
const CACHE_MS = 6 * 60 * 60_000;
const MAX_ENTRIES = 60;
type Entry = { value: unknown; expiresAt: number };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();
let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const entries: unknown = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '[]');
    if (Array.isArray(entries)) for (const [key, entry] of entries.slice(-MAX_ENTRIES)) {
      if (typeof key === 'string' && entry?.expiresAt > Date.now()) cache.set(key, entry);
    }
  } catch { /* Storage is optional. */ }
}

async function request<T>(path: string, key: string, params: Record<string, string> = {}): Promise<T> {
  hydrate();
  const query = new URLSearchParams(params);
  const cacheId = `${path}?${query}`; // Only public metadata; credentials never enter the stored cache.
  const stored = cache.get(cacheId);
  if (stored && stored.expiresAt > Date.now()) return stored.value as T;
  const pendingId = `${cacheId}:${key}`;
  if (pending.has(pendingId)) return pending.get(pendingId) as Promise<T>;
  const load = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      query.set('api_key', key.trim());
      const response = await fetch(`https://api.themoviedb.org/3/${path}?${query}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`TMDB returned HTTP ${response.status}. Check your key or try again later.`);
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object') throw new Error('TMDB returned invalid metadata.');
      cache.delete(cacheId);
      cache.set(cacheId, { value, expiresAt: Date.now() + CACHE_MS });
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify([...cache])); } catch { /* Full storage must not affect playback. */ }
      }, 250);
      return value as T;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('TMDB enrichment timed out. Addon details are still available.');
      if (error instanceof TypeError) throw new Error('TMDB could not be reached. Addon details are still available.');
      throw error;
    } finally { clearTimeout(timer); }
  })();
  pending.set(pendingId, load);
  try { return await load; } finally { if (pending.get(pendingId) === load) pending.delete(pendingId); }
}

export async function resolveTmdbId(id: string, type: MediaType, key: string, fallbackImdbId?: string): Promise<number | null> {
  if (type !== 'movie' && type !== 'series') return null;
  const normalized = id.replace(/^(tmdb|movie|series):/i, '').split(/[:/]/)[0];
  if (/^\d+$/.test(normalized) && Number(normalized) > 0) return Number(normalized);
  const imdb = /^tt\d+$/i.test(normalized) ? normalized : fallbackImdbId?.match(/^tt\d+/i)?.[0];
  if (!imdb || !key.trim()) return null;
  const data = await request<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(`find/${imdb}`, key,
    { external_source: 'imdb_id' });
  const result = (type === 'movie' ? data.movie_results : data.tv_results)?.[0]?.id;
  return typeof result === 'number' && result > 0 ? result : null;
}

type Image = { file_path?: string; iso_639_1?: string | null; vote_average?: number };
type Company = { id: number; name?: string; logo_path?: string };
type Person = { id: number; name?: string; profile_path?: string; character?: string; roles?: { character: string }[];
  job?: string; jobs?: { job: string }[] };
type Result = { id: number; title?: string; name?: string; overview?: string; poster_path?: string; backdrop_path?: string;
  release_date?: string; first_air_date?: string; vote_average?: number; media_type?: string };
export type TmdbDetails = Result & {
  imdb_id?: string; external_ids?: { imdb_id?: string }; genres?: { name: string }[]; runtime?: number;
  episode_run_time?: number[]; status?: string; original_language?: string;
  production_countries?: { name: string }[]; origin_country?: string[]; production_companies?: Company[]; networks?: Company[];
  created_by?: Person[]; credits?: { cast?: Person[]; crew?: Person[] }; aggregate_credits?: { cast?: Person[]; crew?: Person[] };
  images?: { logos?: Image[]; backdrops?: Image[]; posters?: Image[] };
  videos?: { results?: { key: string; name: string; site: string; type: string; official?: boolean }[] };
  recommendations?: { results?: Result[] };
  release_dates?: { results?: { iso_3166_1: string; release_dates: { certification: string }[] }[] };
  content_ratings?: { results?: { iso_3166_1: string; rating: string }[] };
  seasons?: { season_number: number; poster_path?: string }[];
  belongs_to_collection?: { id: number; name: string };
};
export type TmdbMetadata = { id: number; data: TmdbDetails; collection?: { name?: string; parts?: Result[] } };
export type TmdbSeason = { poster_path?: string; episodes?: {
  episode_number: number; name?: string; overview?: string; still_path?: string; runtime?: number
}[] };

export function tmdbImage(path?: string, size = 'w500'): string | undefined {
  return path?.startsWith('/') && !path.startsWith('//') ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

function localizedImage(images: Image[] = [], language: string): string | undefined {
  const preferred = language.split('-')[0];
  const rank = (image: Image) => image.iso_639_1 === preferred ? 3 : image.iso_639_1 === 'en' ? 2 : !image.iso_639_1 ? 1 : 0;
  return [...images].filter((image) => image.file_path).sort((a, b) => rank(b) - rank(a)
    || (b.vote_average || 0) - (a.vote_average || 0))[0]?.file_path;
}

export async function fetchTmdbMetadata(meta: MetaPreview, key: string, settings: TmdbSettings): Promise<TmdbMetadata | null> {
  if (!settings.enabled || !key.trim() || (meta.type !== 'movie' && meta.type !== 'series')) return null;
  const id = meta.tmdbId || await resolveTmdbId(meta.id, meta.type, key, meta.imdb_id || meta.imdbId);
  if (!id) return null;
  const type = meta.type === 'series' ? 'tv' : 'movie';
  const append = ['external_ids'];
  if (settings.artwork) append.push('images');
  if (settings.credits) append.push(type === 'tv' ? 'aggregate_credits' : 'credits');
  if (settings.details) append.push(type === 'tv' ? 'content_ratings' : 'release_dates');
  if (settings.trailers) append.push('videos');
  if (settings.moreLikeThis) append.push('recommendations');
  const data = await request<TmdbDetails>(`${type}/${id}`, key, { language: settings.language,
    append_to_response: append.join(','), include_image_language: `${settings.language.split('-')[0]},en,null` });
  if (data.id !== id) throw new Error('TMDB returned metadata for a different title.');
  const collection = settings.collections && type === 'movie' && data.belongs_to_collection?.id
    ? await request<TmdbMetadata['collection']>(`collection/${data.belongs_to_collection.id}`, key, { language: settings.language })
      .catch(() => undefined) : undefined;
  return { id, data, collection };
}

export function fetchTmdbSeason(id: number, season: number, key: string, language: string): Promise<TmdbSeason> {
  return request(`tv/${id}/season/${season}`, key, { language });
}

function previews(results: Result[] = [], type: MediaType): MetaPreview[] {
  return results.filter((item) => item.id > 0 && (item.title || item.name)).slice(0, 16).map((item) => ({
    id: `tmdb:${item.id}`, tmdbId: item.id, type: item.media_type === 'tv' ? 'series' : item.media_type === 'movie' ? 'movie' : type,
    name: item.title || item.name!, description: item.overview, poster: tmdbImage(item.poster_path),
    background: tmdbImage(item.backdrop_path, 'w1280'), releaseInfo: (item.release_date || item.first_air_date)?.slice(0, 4)
  }));
}

export function applyTmdbMetadata(meta: Meta, enrichment: TmdbMetadata, settings: TmdbSettings): Meta {
  if (!settings.enabled) return meta;
  const { data, id, collection } = enrichment;
  const updated: Meta = { ...meta, tmdbId: id };
  const present = (value?: string) => value?.trim() || undefined;
  if (settings.artwork) {
    updated.poster = tmdbImage(localizedImage(data.images?.posters, settings.language) || data.poster_path) || meta.poster;
    updated.background = tmdbImage(localizedImage(data.images?.backdrops, settings.language) || data.backdrop_path, 'w1280') || meta.background;
    updated.logo = tmdbImage(localizedImage(data.images?.logos, settings.language)) || meta.logo;
  }
  if (settings.basicInfo) {
    updated.name = present(data.title || data.name) || meta.name;
    updated.description = present(data.overview) || meta.description;
    if (data.genres?.length) updated.genres = data.genres.map((genre) => genre.name);
    if (!meta.imdbRating?.trim() && data.vote_average && data.vote_average > 0) {
      updated.imdbRating = data.vote_average.toFixed(1);
      updated.ratingSource = 'TMDB';
    }
  }
  if (settings.details) {
    const runtime = data.runtime || data.episode_run_time?.find((minutes) => minutes > 0);
    if (runtime) updated.runtime = `${runtime} min`;
    updated.status = present(data.status) || meta.status;
    updated.country = data.production_countries?.map((country) => country.name).filter(Boolean).join(', ')
      || data.origin_country?.join(', ') || meta.country;
    updated.language = present(data.original_language) || meta.language;
    const region = settings.language.split('-')[1] || 'US';
    const countries = data.content_ratings?.results || data.release_dates?.results || [];
    const rating = (entry: typeof countries[number]) => 'rating' in entry ? present(entry.rating)
      : entry.release_dates.map((release) => present(release.certification)).find(Boolean);
    updated.ageRating = [countries.find((entry) => entry.iso_3166_1 === region),
      countries.find((entry) => entry.iso_3166_1 === 'US'), ...countries].filter((entry) => !!entry).map(rating).find(Boolean) || meta.ageRating;
  }
  if (settings.credits) {
    const credits = data.aggregate_credits || data.credits;
    const people = (credits?.cast || []).filter((person) => person.name).slice(0, 24).map((person) => ({
      id: person.id, name: person.name!, character: person.character || person.roles?.map((role) => role.character).filter(Boolean).join(', '),
      photo: tmdbImage(person.profile_path, 'w185')
    }));
    if (people.length) { updated.people = people; updated.cast = people.map((person) => person.name); }
    const crew = credits?.crew || [];
    const hasJob = (person: Person, jobs: string[]) => jobs.includes(person.job || '') || person.jobs?.some((job) => jobs.includes(job.job));
    const directors = [...new Set(crew.filter((person) => hasJob(person, ['Director'])).map((person) => person.name).filter(Boolean))] as string[];
    const writers = [...new Set(crew.filter((person) => hasJob(person, ['Writer', 'Screenplay', 'Story'])).map((person) => person.name).filter(Boolean))] as string[];
    if (directors.length) updated.director = directors;
    else if (data.created_by?.length && meta.type === 'series') updated.director = data.created_by.map((person) => person.name!).filter(Boolean);
    if (writers.length) updated.writer = writers;
  }
  const companies = (items: Company[] = []) => items.filter((item) => item.name).map((item) => ({
    id: item.id, name: item.name!, logo: tmdbImage(item.logo_path, 'w300')
  }));
  if (settings.productions && data.production_companies?.length) updated.productionCompanies = companies(data.production_companies);
  if (settings.networks && data.networks?.length) updated.networks = companies(data.networks);
  if (settings.trailers) updated.trailers = (data.videos?.results || [])
    .filter((video) => video.site === 'YouTube' && /^[\w-]{11}$/.test(video.key) && ['Trailer', 'Teaser'].includes(video.type))
    .sort((a, b) => Number(b.official) - Number(a.official)).slice(0, 6).map((video) => ({ id: video.key, name: video.name,
      url: `https://www.youtube.com/watch?v=${video.key}`, thumbnail: `https://i.ytimg.com/vi/${video.key}/hqdefault.jpg` }));
  if (settings.moreLikeThis) updated.moreLikeThis = previews(data.recommendations?.results, meta.type).filter((item) => item.tmdbId !== id);
  if (settings.collections) {
    updated.collectionName = collection?.name || data.belongs_to_collection?.name;
    updated.collectionItems = previews([...(collection?.parts || [])].sort((a, b) =>
      (a.release_date || '9999').localeCompare(b.release_date || '9999')), 'movie').filter((item) => item.tmdbId !== id);
  }
  if (settings.seasonPosters && data.seasons?.length) updated.videos = meta.videos?.map((video) => ({ ...video,
    seasonPoster: tmdbImage(data.seasons?.find((season) => season.season_number === video.season)?.poster_path) || video.seasonPoster }));
  return updated; // Addon title ID, episode IDs, release dates, and progress identity remain intact.
}

export function applyTmdbSeason(videos: Video[], number: number, details: TmdbSeason, settings: TmdbSettings): Video[] {
  if (!settings.enabled) return videos;
  return videos.map((video) => {
    if (video.season !== number) return video;
    const info = details.episodes?.find((episode) => episode.episode_number === video.episode);
    return { ...video, ...(settings.episodes && info ? {
      title: info.name?.trim() || video.title, description: info.overview?.trim() || video.description,
      thumbnail: tmdbImage(info.still_path) || video.thumbnail, runtime: info.runtime || video.runtime
    } : {}), ...(settings.seasonPosters ? { seasonPoster: tmdbImage(details.poster_path) || video.seasonPoster } : {}) };
  });
}
