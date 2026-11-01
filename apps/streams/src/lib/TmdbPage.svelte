<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowLeft, ArrowRight, Building2, ExternalLink, LoaderCircle, Tv, UserRound } from 'lucide-svelte';
  import MediaTile from './MediaTile.svelte';
  import { screenTransition } from './screen-transition';
  import type { NavigationMotion } from './screen-transition';
  import { tmdbImage } from './tmdb.ts';
  import {
    ageOn, discoverOrganizationTitles, fetchTmdbOrganization, fetchTmdbPerson, filmographyDepartments, filterFilmography,
    formatTmdbDate, personFilmography
  } from './tmdb-pages.ts';
  import type { FilmographyEntry, TitleFilter, TitleSort, TmdbOrganization, TmdbPerson } from './tmdb-pages.ts';
  import type { TmdbPageRoute } from './router.ts';
  import type { TmdbSettings } from './tmdb-settings';
  import type { MetaPreview } from './types';

  export let route: TmdbPageRoute;
  export let motion: NavigationMotion;
  export let apiKey: string;
  export let settings: TmdbSettings;
  export let hidden = false;
  export let onSelect: (item: MetaPreview) => void;
  export let onOpen: (route: TmdbPageRoute) => void;
  export let onBack: () => void;
  export let onSettings: () => void;
  export let onTitle: (title: string) => void = () => {};

  const PAGE_SIZE = 60;
  const kindLabel = { person: 'PERSON', company: 'PRODUCTION COMPANY', network: 'TV NETWORK' } as const;

  let loading = true;
  let error = '';
  let person: TmdbPerson | null = null;
  let filmography: FilmographyEntry[] = [];
  let organization: TmdbOrganization | null = null;
  let titles: MetaPreview[] = [];
  let page = 0;
  let totalPages = 0;
  let totalResults = 0;
  let loadingMore = false;
  let generation = 0;
  let bioExpanded = false;

  // Person filters
  let typeFilter: TitleFilter = 'all';
  let department = 'all';
  let sort: TitleSort = 'popular';
  let limit = PAGE_SIZE;
  // Organization filter: TMDB discovers movies and TV separately.
  let orgType: 'movie' | 'series' = route.kind === 'network' ? 'series' : 'movie';

  $: ready = settings.enabled && !!apiKey.trim();
  $: title = person?.name || organization?.name || '';
  $: onTitle(title);
  $: departments = filmographyDepartments(filmography);
  $: typeCounts = { all: filmography.length, movie: filmography.filter((entry) => entry.preview.type === 'movie').length,
    series: filmography.filter((entry) => entry.preview.type === 'series').length };
  $: filtered = filterFilmography(filmography, typeFilter, department, sort);
  $: visible = filtered.slice(0, limit);
  $: if (typeFilter || department || sort) limit = PAGE_SIZE;
  $: photo = tmdbImage(person?.profile_path || undefined, 'h632');
  $: logo = tmdbImage(organization?.logo_path || undefined, 'w500');
  $: age = person ? ageOn(person.birthday, person.deathday) : undefined;

  function message(value: unknown) {
    return value instanceof Error ? value.message : 'TMDB could not load this page.';
  }

  async function load() {
    const request = ++generation;
    loading = true;
    error = '';
    if (!ready) { loading = false; return; }
    try {
      if (route.kind === 'person') {
        const data = await fetchTmdbPerson(route.id, apiKey, settings.language);
        if (request !== generation) return;
        person = data;
        filmography = personFilmography(data, settings.includeAdult);
      } else {
        const data = await fetchTmdbOrganization(route.kind, route.id, apiKey);
        if (request !== generation) return;
        organization = data;
        await loadTitles(true);
      }
    } catch (failure) {
      if (request === generation) error = message(failure);
    } finally {
      if (request === generation) loading = false;
    }
  }

  async function loadTitles(reset = false) {
    if (route.kind === 'person' || (loadingMore && !reset) || (!reset && page >= totalPages)) return;
    const request = reset ? ++generation : generation;
    const next = reset ? 1 : page + 1;
    loadingMore = true;
    if (reset) { titles = []; page = 0; totalPages = 0; totalResults = 0; error = ''; }
    try {
      const result = await discoverOrganizationTitles(route.kind, route.id, orgType, sort, next, apiKey, settings.language, settings.includeAdult);
      if (request !== generation) return;
      const seen = new Set(titles.map((item) => item.id));
      titles = [...titles, ...result.items.filter((item) => !seen.has(item.id))];
      page = result.page;
      totalPages = result.totalPages;
      totalResults = result.totalResults;
    } catch (failure) {
      if (request === generation) error = message(failure);
    } finally {
      if (request === generation) loadingMore = false;
    }
  }

  function chooseOrgType(next: 'movie' | 'series') {
    if (orgType === next) return;
    orgType = next;
    void loadTitles(true);
  }

  function chooseSort(next: TitleSort) {
    if (sort === next) return;
    sort = next;
    if (route.kind !== 'person') void loadTitles(true);
  }

  function subtitle(entry: FilmographyEntry) {
    const roles = entry.roles.length > 2 ? `${entry.roles.slice(0, 2).join(', ')} +${entry.roles.length - 2}` : entry.roles.join(', ');
    return [entry.preview.releaseInfo, roles].filter(Boolean).join(' · ');
  }

  /** Reveals more of a person's titles, or loads the next discover page, as the end comes into view. */
  function observeEnd(node: HTMLElement) {
    const root = node.closest('.tmdb-page-panel');
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || hidden) return;
      if (route.kind === 'person') limit += PAGE_SIZE;
      else void loadTitles();
    }, { root, rootMargin: '600px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  onMount(() => { void load(); });
</script>

<div class="catalog-page-overlay tmdb-page-overlay" role="presentation" aria-hidden={hidden ? 'true' : undefined} in:screenTransition={{ direction: motion }} out:screenTransition={{ direction: motion, outgoing: true }}>
  <div class="catalog-page-panel tmdb-page-panel" role="dialog" aria-modal="true" aria-label={title || 'TMDB page'}>
    <header class="catalog-page-header"><button class="catalog-page-back" onclick={onBack} aria-label="Back"><ArrowLeft size={21} /></button><div><span class="section-type">{kindLabel[route.kind]}</span><h1>{title || (loading ? 'Loading…' : 'TMDB')}</h1></div></header>
    <div class="catalog-page-content">
      {#if !ready}
        <div class="tmdb-page-message" role="status"><p>Person, company and network pages use TMDB. Turn on TMDB enrichment and add your API key to see them.</p><button class="tmdb-page-button" onclick={onSettings}>Open TMDB settings <ArrowRight size={16} /></button></div>
      {:else if loading && !person && !organization}
        <div class="catalog-page-skeletons"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      {:else if error && !person && !organization}
        <div class="catalog-page-message" role="alert">{error} <button onclick={() => void load()}>Retry</button></div>
      {:else if person}
        <section class="tmdb-profile" aria-label="About">
          <div class="tmdb-photo">{#if photo}<img src={photo} alt={person.name} />{:else}<UserRound size={46} />{/if}</div>
          <div class="tmdb-about">
            {#if person.known_for_department}<span class="tmdb-known">Known for {person.known_for_department}</span>{/if}
            <dl class="tmdb-facts">
              {#if person.birthday}<div><dt>Born</dt><dd>{formatTmdbDate(person.birthday, settings.language)}{#if age !== undefined && !person.deathday} (age {age}){/if}{#if person.place_of_birth}<br /><span>{person.place_of_birth}</span>{/if}</dd></div>{/if}
              {#if person.deathday}<div><dt>Died</dt><dd>{formatTmdbDate(person.deathday, settings.language)}{#if age !== undefined} (aged {age}){/if}</dd></div>{/if}
            </dl>
            {#if person.biography?.trim()}<p class="tmdb-bio" class:expanded={bioExpanded}>{person.biography}</p>{#if person.biography.length > 320}<button class="tmdb-link" onclick={() => bioExpanded = !bioExpanded}>{bioExpanded ? 'Show less' : 'Read more'}</button>{/if}{/if}
          </div>
        </section>
        <section class="tmdb-titles" aria-label="Filmography">
          <div class="tmdb-controls">
            <div class="tmdb-chips" role="group" aria-label="Type">
              {#each [['all', 'All'], ['movie', 'Movies'], ['series', 'TV']] as [value, label]}<button class:active={typeFilter === value} aria-pressed={typeFilter === value} onclick={() => typeFilter = value as TitleFilter} disabled={value !== 'all' && !typeCounts[value as 'movie' | 'series']}>{label} <small>{typeCounts[value as TitleFilter]}</small></button>{/each}
            </div>
            <label class="tmdb-select">Role<select bind:value={department}><option value="all">All roles</option>{#each departments as item}<option value={item}>{item}</option>{/each}</select></label>
            <div class="tmdb-chips" role="group" aria-label="Sort">
              <button class:active={sort === 'popular'} aria-pressed={sort === 'popular'} onclick={() => chooseSort('popular')}>Popular</button>
              <button class:active={sort === 'newest'} aria-pressed={sort === 'newest'} onclick={() => chooseSort('newest')}>Newest</button>
            </div>
          </div>
          <p class="tmdb-count">{filtered.length} {filtered.length === 1 ? 'title' : 'titles'}</p>
          {#if visible.length}<div class="poster-grid catalog-page-grid">{#each visible as entry (entry.preview.type + entry.preview.id)}<MediaTile item={entry.preview} subtitle={subtitle(entry)} onSelect={() => onSelect(entry.preview)} />{/each}</div>
          {:else}<div class="row-empty">No titles match these filters.</div>{/if}
          {#if visible.length < filtered.length}<div class="catalog-page-footer" use:observeEnd><button onclick={() => limit += PAGE_SIZE}>Show more <ArrowRight size={17} /></button></div>{/if}
        </section>
      {:else if organization}
        <section class="tmdb-profile tmdb-organization" aria-label="About">
          <div class="tmdb-logo">{#if logo}<img src={logo} alt={organization.name} />{:else if route.kind === 'network'}<Tv size={42} />{:else}<Building2 size={42} />{/if}</div>
          <div class="tmdb-about">
            <dl class="tmdb-facts">
              {#if organization.headquarters}<div><dt>Headquarters</dt><dd>{organization.headquarters}</dd></div>{/if}
              {#if organization.origin_country}<div><dt>Country</dt><dd>{organization.origin_country}</dd></div>{/if}
              {#if organization.parent_company?.id && organization.parent_company.name}<div><dt>Parent company</dt><dd><button class="tmdb-link" onclick={() => onOpen({ kind: 'company', id: organization!.parent_company!.id })}>{organization.parent_company.name}</button></dd></div>{/if}
            </dl>
            {#if organization.description?.trim()}<p class="tmdb-bio" class:expanded={bioExpanded}>{organization.description}</p>{#if organization.description.length > 320}<button class="tmdb-link" onclick={() => bioExpanded = !bioExpanded}>{bioExpanded ? 'Show less' : 'Read more'}</button>{/if}{/if}
            {#if organization.homepage && /^https:\/\//.test(organization.homepage)}<a class="tmdb-link" href={organization.homepage} target="_blank" rel="noopener noreferrer">Website <ExternalLink size={14} /></a>{/if}
          </div>
        </section>
        <section class="tmdb-titles" aria-label="Titles">
          <div class="tmdb-controls">
            {#if route.kind === 'company'}<div class="tmdb-chips" role="group" aria-label="Type">
              <button class:active={orgType === 'movie'} aria-pressed={orgType === 'movie'} onclick={() => chooseOrgType('movie')}>Movies</button>
              <button class:active={orgType === 'series'} aria-pressed={orgType === 'series'} onclick={() => chooseOrgType('series')}>TV</button>
            </div>{/if}
            <div class="tmdb-chips" role="group" aria-label="Sort">
              <button class:active={sort === 'popular'} aria-pressed={sort === 'popular'} onclick={() => chooseSort('popular')}>Popular</button>
              <button class:active={sort === 'newest'} aria-pressed={sort === 'newest'} onclick={() => chooseSort('newest')}>Newest</button>
            </div>
          </div>
          {#if totalResults}<p class="tmdb-count">{totalResults.toLocaleString()} {totalResults === 1 ? 'title' : 'titles'}</p>{/if}
          {#if titles.length}<div class="poster-grid catalog-page-grid">{#each titles as item (item.type + item.id)}<MediaTile {item} onSelect={() => onSelect(item)} />{/each}</div>{/if}
          {#if loadingMore && !titles.length}<div class="catalog-page-skeletons"><span></span><span></span><span></span><span></span><span></span><span></span></div>{/if}
          {#if error}<div class="catalog-page-message" role="alert">{error} <button onclick={() => void loadTitles(!titles.length)}>Retry</button></div>{/if}
          {#if !loadingMore && !error && !titles.length}<div class="row-empty">TMDB lists no {orgType === 'series' ? 'TV shows' : 'movies'} here.</div>{/if}
          {#if page < totalPages && !error}<div class="catalog-page-footer" use:observeEnd>{#if loadingMore}<LoaderCircle size={22} class="spin" />{:else}<button onclick={() => void loadTitles()}>Load more <ArrowRight size={17} /></button>{/if}</div>{/if}
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .tmdb-page-overlay{z-index:29}
  .tmdb-profile{display:flex;gap:clamp(20px,4vw,48px);align-items:flex-start;margin:6px 0 34px}
  .tmdb-photo{flex:none;width:clamp(120px,18vw,220px);aspect-ratio:2/3;overflow:hidden;display:grid;place-items:center;border-radius:16px;background:#ffffff0d;color:#8fa0aa}
  .tmdb-photo img{width:100%;height:100%;object-fit:cover}
  .tmdb-logo{flex:none;display:grid;place-items:center;width:clamp(150px,22vw,260px);aspect-ratio:16/9;padding:18px;border-radius:16px;background:#eef0ef;color:#4b5358}
  .tmdb-logo img{max-width:100%;max-height:100%;object-fit:contain}
  .tmdb-about{min-width:0;flex:1;max-width:820px}
  .tmdb-known{display:inline-block;margin-bottom:12px;padding:5px 11px;border:1px solid #ffffff2e;border-radius:999px;color:#d9e2df;font-size:12px;font-weight:700}
  .tmdb-facts{display:flex;flex-wrap:wrap;gap:14px 34px;margin:0 0 16px}
  .tmdb-facts dt{color:#93a3ab;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
  .tmdb-facts dd{margin:5px 0 0;color:#eef3f1;font-size:14px;line-height:1.5}.tmdb-facts dd span{color:#a8b5bb}
  .tmdb-bio{margin:0;color:#c3ccd0;font-size:14px;line-height:1.7;white-space:pre-line;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden}
  .tmdb-bio.expanded{display:block}
  .tmdb-link{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:0;border:0;background:none;color:#86e0c4;font:inherit;font-size:13px;font-weight:700;text-decoration:none;cursor:pointer}
  dd .tmdb-link{margin:0;font-size:14px}
  .tmdb-controls{display:flex;flex-wrap:wrap;align-items:center;gap:12px 18px}
  .tmdb-chips{display:flex;flex-wrap:wrap;gap:6px}
  .tmdb-chips button{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 14px;border:1px solid #ffffff2b;border-radius:999px;background:#ffffff0a;color:#dce4e1;font-size:13px;font-weight:700}
  .tmdb-chips button small{color:#93a3ab;font-size:11px}
  .tmdb-chips button.active{border-color:#fff;background:#fff;color:#101113}.tmdb-chips button.active small{color:#4b5358}
  .tmdb-chips button:disabled{opacity:.4}
  .tmdb-select{display:inline-flex;align-items:center;gap:8px;color:#93a3ab;font-size:12px;font-weight:700}
  .tmdb-select select{min-height:36px;padding:0 12px;border:1px solid #ffffff2b;border-radius:999px;background:#151a1e;color:#eef3f1;font:inherit;font-size:13px}
  .tmdb-count{margin:16px 0 14px;color:#93a3ab;font-size:12px}
  .tmdb-page-message{max-width:560px;margin:30px 0;color:#c3ccd0;font-size:14px;line-height:1.7}
  .tmdb-page-button{display:inline-flex;align-items:center;gap:8px;min-height:42px;margin-top:10px;padding:0 18px;border:0;border-radius:999px;background:#fff;color:#101113;font-size:14px;font-weight:800}
  @media(max-width:700px){
    .tmdb-profile{flex-direction:column;align-items:center;text-align:center}
    .tmdb-facts{justify-content:center}
    .tmdb-controls{justify-content:center}
    .tmdb-count{text-align:center}
  }
</style>
