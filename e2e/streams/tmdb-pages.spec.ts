import { expect, test, type Page } from '@playwright/test';

const addon = 'https://tmdb-pages-addon.test';
const json = (data: unknown) => ({ json: data, headers: { 'access-control-allow-origin': '*' } });

const filmography = {
  id: 1, name: 'Example Actor', known_for_department: 'Acting', birthday: '1970-03-04', place_of_birth: 'Toronto, Canada',
  biography: 'An actor and director. '.repeat(30),
  combined_credits: {
    cast: [
      { id: 321, media_type: 'movie', title: 'Enriched Film', character: 'Hero', release_date: '2020-01-01', vote_count: 900 },
      { id: 700, media_type: 'tv', name: 'Person Show', character: 'Lead', episode_count: 24, first_air_date: '2015-06-01', vote_count: 400 },
      { id: 701, media_type: 'movie', title: 'Hidden Adult Film', adult: true, release_date: '2019-01-01', vote_count: 2 },
      ...Array.from({ length: 70 }, (_, index) => ({ id: 1000 + index, media_type: 'movie', title: `Bit Part ${index}`,
        character: 'Extra', release_date: `${1990 + (index % 30)}-01-01`, vote_count: 10 }))
    ],
    crew: [{ id: 702, media_type: 'movie', title: 'Directed Film', department: 'Directing', job: 'Director', release_date: '2022-01-01', vote_count: 300 }]
  }
};

async function setup(page: Page, { key = true, includeAdult = false } = {}) {
  const requests: string[] = [];
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://image.tmdb.org/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.addInitScript(({ url, key, includeAdult }) => {
    localStorage.setItem('bridged-streams.addons.v1', JSON.stringify([`${url}/manifest.json`]));
    if (key) {
      localStorage.setItem('bridged-streams.tmdb-key.v1', 'test-tmdb-key');
      localStorage.setItem('bridged-streams.tmdb-enrichment.v1', JSON.stringify({ enabled: true, includeAdult }));
    }
  }, { url: addon, key, includeAdult });
  await page.route(`${addon}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/manifest.json') return route.fulfill(json({ id: 'tmdb-pages', name: 'Pages Addon', version: '1.0.0', types: ['movie', 'series'],
      idPrefixes: ['tt'], resources: ['catalog', 'meta'], catalogs: [{ type: 'movie', id: 'top', name: 'Top' }] }));
    if (path.startsWith('/catalog/')) return route.fulfill(json({ metas: [{ id: 'tt100', type: 'movie', name: 'Sample Film' }] }));
    const id = path.match(/\/meta\/\w+\/(tt\d+)\.json$/)?.[1];
    const names: Record<string, string> = { tt100: 'Sample Film', tt700: 'Person Show', tt800: 'Studio Film 0' };
    return route.fulfill(json({ meta: { id, type: path.includes('/series/') ? 'series' : 'movie', name: names[id || ''] || id } }));
  });
  await page.route('https://api.themoviedb.org/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    requests.push(`${path}?${url.searchParams.get('page') || ''}`);
    let data: unknown = {};
    if (path === '/3/find/tt100') data = { movie_results: [{ id: 321 }] };
    else if (path === '/3/movie/321') data = { id: 321, title: 'Enriched Film',
      credits: { cast: [{ id: 1, name: 'Example Actor', character: 'Hero' }], crew: [{ id: 2, name: 'Example Director', job: 'Director' }] },
      production_companies: [{ id: 4, name: 'Example Studio' }] };
    else if (path === '/3/person/1') data = filmography;
    else if (path === '/3/person/2') data = { id: 2, name: 'Example Director', combined_credits: { crew: [
      { id: 702, media_type: 'movie', title: 'Directed Film', department: 'Directing', job: 'Director', vote_count: 300 }] } };
    else if (path === '/3/tv/700') data = { id: 700, name: 'Person Show', external_ids: { imdb_id: 'tt700' } };
    else if (path === '/3/company/4') data = { id: 4, name: 'Example Studio', headquarters: 'Los Angeles, California', origin_country: 'US',
      parent_company: { id: 5, name: 'Parent Group' }, description: 'A studio.' };
    else if (path === '/3/company/5') data = { id: 5, name: 'Parent Group' };
    else if (path === '/3/discover/movie' && url.searchParams.get('with_companies') === '4') {
      const pageNumber = Number(url.searchParams.get('page'));
      data = { page: pageNumber, total_pages: 2, total_results: 40, results: Array.from({ length: 20 }, (_, index) => ({
        id: 800 + (pageNumber - 1) * 20 + index, title: `Studio Film ${(pageNumber - 1) * 20 + index}` })) };
    } else if (path === '/3/discover/tv' && url.searchParams.get('with_companies') === '4') {
      data = { page: 1, total_pages: 1, total_results: 1, results: [{ id: 900, name: 'Studio Show' }] };
    } else if (path.startsWith('/3/discover/')) data = { page: 1, total_pages: 0, total_results: 0, results: [] };
    return route.fulfill(json(data));
  });
  return requests;
}

async function openSampleFilm(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'View details for Sample Film' }).first().click();
  await expect(page.getByRole('heading', { name: 'Enriched Film', exact: true })).toBeVisible();
}

test('a cast member opens a filtered filmography, and titles return to it', async ({ page }) => {
  await setup(page);
  await openSampleFilm(page);
  await page.getByRole('region', { name: 'Cast', exact: true }).getByRole('button', { name: 'View Example Actor' }).click();
  await expect(page).toHaveURL(/#\/person\/1$/);
  const person = page.getByRole('dialog', { name: 'Example Actor', exact: true });
  await expect(person.getByRole('heading', { name: 'Example Actor', exact: true })).toBeVisible();
  await expect(person).toContainText('Known for Acting');
  await expect(person).toContainText('Toronto, Canada');
  // Every title is listed: 73 visible credits, with the adult title hidden by default.
  await expect(person.locator('.tmdb-count')).toHaveText('73 titles');
  await expect(person.getByRole('button', { name: 'View details for Hidden Adult Film' })).toHaveCount(0);
  await expect(person.locator('.media-card')).toHaveCount(60);
  await person.locator('.catalog-page-footer').scrollIntoViewIfNeeded();
  await expect(person.locator('.media-card')).toHaveCount(73);

  await person.getByRole('group', { name: 'Type' }).getByRole('button', { name: /^TV/ }).click();
  await expect(person.locator('.tmdb-count')).toHaveText('1 title');
  await expect(person.locator('.media-card')).toContainText('as Lead (24 episodes)');
  await person.getByRole('group', { name: 'Type' }).getByRole('button', { name: /^All/ }).click();
  await person.getByLabel('Role').selectOption('Directing');
  await expect(person.locator('.media-card')).toHaveCount(1);
  await expect(person.locator('.media-card')).toContainText('Directed Film');
  await person.getByLabel('Role').selectOption('all');
  await person.getByRole('group', { name: 'Type' }).getByRole('button', { name: /^TV/ }).click();

  await person.getByRole('button', { name: 'View details for Person Show' }).click();
  await expect(page).toHaveURL(/#\/series\/tmdb%3A700$/);
  await expect(page.getByRole('heading', { name: 'Person Show', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/person\/1$/);
  // The page stayed mounted beneath the title, with its filter.
  await expect(person.getByRole('group', { name: 'Type' }).getByRole('button', { name: /^TV/ })).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/#\/movie\/tt100$/);
  await expect(page.getByRole('heading', { name: 'Enriched Film', exact: true })).toBeVisible();
});

test('the facts card links directors to their page', async ({ page }) => {
  await setup(page);
  await openSampleFilm(page);
  await page.locator('.detail-facts-card').getByRole('button', { name: 'Example Director' }).click();
  await expect(page).toHaveURL(/#\/person\/2$/);
  await expect(page.getByRole('dialog', { name: 'Example Director', exact: true }).locator('.media-card')).toContainText('Directed Film');
  await page.getByRole('dialog', { name: 'Example Director', exact: true }).getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/movie\/tt100$/);
});

test('a production company lists all its titles page by page, with movies and TV', async ({ page }) => {
  const requests = await setup(page);
  await openSampleFilm(page);
  await page.getByRole('region', { name: 'Production companies' }).getByRole('button', { name: 'View Example Studio' }).click();
  await expect(page).toHaveURL(/#\/company\/4$/);
  const company = page.getByRole('dialog', { name: 'Example Studio', exact: true });
  await expect(company).toContainText('PRODUCTION COMPANY');
  await expect(company).toContainText('Los Angeles, California');
  await expect(company.locator('.tmdb-count')).toHaveText('40 titles');
  // The second discover page loads as the end of the grid comes into view.
  await expect(company.locator('.media-card')).toHaveCount(40);
  expect(requests).toContain('/3/discover/movie?2');
  await expect(company.locator('.catalog-page-footer')).toHaveCount(0);

  await company.getByRole('group', { name: 'Type' }).getByRole('button', { name: 'TV' }).click();
  await expect(company.locator('.media-card')).toHaveCount(1);
  await expect(company.locator('.media-card')).toContainText('Studio Show');

  await company.getByRole('button', { name: 'Parent Group' }).click();
  await expect(page).toHaveURL(/#\/company\/5$/);
  await expect(page.getByRole('dialog', { name: 'Parent Group', exact: true })).toContainText('TMDB lists no movies here.');
  await page.goBack();
  await expect(page).toHaveURL(/#\/company\/4$/);
});

test('adult titles appear when the setting allows them', async ({ page }) => {
  await setup(page, { includeAdult: true });
  await page.goto('/#/person/1');
  const person = page.getByRole('dialog', { name: 'Example Actor', exact: true });
  await expect(person.locator('.tmdb-count')).toHaveText('74 titles');
  await person.getByLabel('Role').selectOption('Acting');
  await person.getByRole('group', { name: 'Sort' }).getByRole('button', { name: 'Newest' }).click();
  await expect(person.locator('.media-card').first()).toContainText('Enriched Film');
});

test('a shared page link without TMDB asks for the key instead of failing', async ({ page }) => {
  const requests = await setup(page, { key: false });
  await page.goto('/#/person/1');
  await expect(page.getByText('Turn on TMDB enrichment and add your API key')).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Open TMDB settings' }).click();
  await expect(page).toHaveURL(/#\/settings\/integrations$/);
  await expect(page.getByRole('dialog', { name: 'Integrations' }).getByRole('checkbox', { name: 'Show adult titles' })).toBeDisabled();
});
