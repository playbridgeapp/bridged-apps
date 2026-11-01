import { request, tmdbImage } from './tmdb.ts';
import type { MediaType, MetaPreview } from './types';

/** A TMDB title in a person's filmography or a company/network listing. */
export type TmdbTitle = {
  id: number; media_type?: string; title?: string; name?: string; overview?: string; poster_path?: string; backdrop_path?: string;
  release_date?: string; first_air_date?: string; vote_average?: number; vote_count?: number; popularity?: number; adult?: boolean;
  character?: string; episode_count?: number; department?: string; job?: string;
};

export type TmdbPerson = {
  id: number; name?: string; biography?: string; birthday?: string | null; deathday?: string | null; place_of_birth?: string | null;
  known_for_department?: string; profile_path?: string | null;
  combined_credits?: { cast?: TmdbTitle[]; crew?: TmdbTitle[] };
};

export type TmdbOrganization = {
  id: number; name?: string; description?: string; headquarters?: string; homepage?: string; logo_path?: string | null;
  origin_country?: string; parent_company?: { id: number; name?: string } | null;
};

export type OrganizationKind = 'company' | 'network';
export type TitleFilter = 'all' | 'movie' | 'series';
export type TitleSort = 'popular' | 'newest';

/** One title with every role the person had in it. */
export type FilmographyEntry = {
  preview: MetaPreview; roles: string[]; departments: string[]; date: string; votes: number; adult: boolean;
};

/** Departments in the order a filmography lists them; anything else follows alphabetically. */
const DEPARTMENT_ORDER = ['Acting', 'Directing', 'Writing', 'Creator', 'Production', 'Sound', 'Camera', 'Editing'];

export function tmdbTitlePreview(item: TmdbTitle, fallback: MediaType): MetaPreview {
  const type: MediaType = item.media_type === 'tv' ? 'series' : item.media_type === 'movie' ? 'movie' : fallback;
  return {
    id: `tmdb:${item.id}`, tmdbId: item.id, type, name: item.title || item.name || `TMDB ${item.id}`,
    description: item.overview, poster: tmdbImage(item.poster_path || undefined, 'w342'),
    background: tmdbImage(item.backdrop_path || undefined, 'w1280'),
    releaseInfo: (item.release_date || item.first_air_date)?.slice(0, 4) || undefined,
    imdbRating: item.vote_average && item.vote_count && item.vote_count >= 10 ? item.vote_average.toFixed(1) : undefined
  };
}

/** Merge a person's cast and crew credits into one entry per title. */
export function personFilmography(person: TmdbPerson, includeAdult: boolean): FilmographyEntry[] {
  const entries = new Map<string, FilmographyEntry>();
  const credits = [
    ...(person.combined_credits?.cast || []).map((credit) => ({ credit, department: 'Acting',
      role: credit.character?.trim() ? `as ${credit.character.trim()}` : 'Acting' })),
    ...(person.combined_credits?.crew || []).map((credit) => ({ credit, department: credit.department || 'Crew',
      role: credit.job?.trim() || credit.department || 'Crew' }))
  ];
  for (const { credit, department, role } of credits) {
    if (!(credit.id > 0) || (credit.media_type !== 'movie' && credit.media_type !== 'tv') || !(credit.title || credit.name)) continue;
    if (credit.adult && !includeAdult) continue;
    const key = `${credit.media_type}:${credit.id}`;
    const entry = entries.get(key) || {
      preview: tmdbTitlePreview(credit, 'movie'), roles: [], departments: [],
      date: credit.release_date || credit.first_air_date || '', votes: credit.vote_count || 0, adult: !!credit.adult
    };
    const episodes = credit.episode_count && credit.episode_count > 1 ? ` (${credit.episode_count} episodes)` : '';
    const label = `${role}${episodes}`;
    if (!entry.roles.includes(label)) entry.roles.push(label);
    if (!entry.departments.includes(department)) entry.departments.push(department);
    entries.set(key, entry);
  }
  return [...entries.values()];
}

export function filmographyDepartments(entries: FilmographyEntry[]): string[] {
  const present = new Set(entries.flatMap((entry) => entry.departments));
  const rank = (department: string) => { const index = DEPARTMENT_ORDER.indexOf(department); return index < 0 ? DEPARTMENT_ORDER.length : index; };
  return [...present].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function filterFilmography(entries: FilmographyEntry[], type: TitleFilter, department: string, sort: TitleSort): FilmographyEntry[] {
  return entries
    .filter((entry) => (type === 'all' || entry.preview.type === type) && (department === 'all' || entry.departments.includes(department)))
    .sort((a, b) => sort === 'newest'
      ? (b.date || '0000').localeCompare(a.date || '0000') || b.votes - a.votes
      : b.votes - a.votes || (b.date || '').localeCompare(a.date || ''));
}

export function fetchTmdbPerson(id: number, key: string, language: string): Promise<TmdbPerson> {
  return request<TmdbPerson>(`person/${id}`, key, { language, append_to_response: 'combined_credits' }, { persist: false });
}

export function fetchTmdbOrganization(kind: OrganizationKind, id: number, key: string): Promise<TmdbOrganization> {
  return request<TmdbOrganization>(`${kind}/${id}`, key);
}

export type DiscoverPage = { items: MetaPreview[]; page: number; totalPages: number; totalResults: number };

/** TMDB serves at most 500 discover pages. */
const MAX_DISCOVER_PAGES = 500;

export async function discoverOrganizationTitles(kind: OrganizationKind, id: number, type: 'movie' | 'series', sort: TitleSort,
  page: number, key: string, language: string, includeAdult: boolean, today = new Date().toISOString().slice(0, 10)): Promise<DiscoverPage> {
  const media = type === 'series' ? 'tv' : 'movie';
  const dateField = media === 'tv' ? 'first_air_date' : 'primary_release_date';
  const params: Record<string, string> = {
    language, page: String(page), include_adult: String(includeAdult),
    sort_by: sort === 'newest' ? `${dateField}.desc` : 'popularity.desc',
    [kind === 'network' ? 'with_networks' : 'with_companies']: String(id)
  };
  // Newest first should start with released titles, not far-future placeholders.
  if (sort === 'newest') params[`${dateField}.lte`] = today;
  const data = await request<{ page?: number; total_pages?: number; total_results?: number; results?: TmdbTitle[] }>(
    `discover/${media}`, key, params, { persist: false });
  return {
    items: (data.results || []).filter((item) => item.id > 0 && (item.title || item.name) && (includeAdult || !item.adult))
      .map((item) => tmdbTitlePreview({ ...item, media_type: media }, type)),
    page: data.page || page,
    totalPages: Math.min(data.total_pages || 0, MAX_DISCOVER_PAGES),
    totalResults: data.total_results || 0
  };
}

/** "1964-09-02" → "September 2, 1964", in the viewer's TMDB language. */
export function formatTmdbDate(value: string | null | undefined, language: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  try { return new Intl.DateTimeFormat(language, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date); }
  catch { return value; }
}

export function ageOn(birthday: string | null | undefined, until: string | null | undefined, today = new Date()): number | undefined {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return undefined;
  const end = until && /^\d{4}-\d{2}-\d{2}$/.test(until) ? new Date(`${until}T00:00:00Z`) : today;
  const start = new Date(`${birthday}T00:00:00Z`);
  let age = end.getUTCFullYear() - start.getUTCFullYear();
  if (end.getUTCMonth() < start.getUTCMonth() || (end.getUTCMonth() === start.getUTCMonth() && end.getUTCDate() < start.getUTCDate())) age--;
  return age >= 0 && age < 130 ? age : undefined;
}
