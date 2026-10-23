import { expect, test, type Page, type Route } from '@playwright/test';

const definitions = ['a', 'b'].map(id => ({ manifestUrl: `https://search-${id}.test/manifest.json`, manifest: {
  id, name: `Search ${id.toUpperCase()}`, version: '1.0.0', resources: ['catalog'], types: ['movie'],
  catalogs: [{ id: 'titles', name: 'Titles', type: 'movie', extra: [{ name: 'search', isRequired: true }] }]
} }));
const meta = (id: string, name = id) => ({ id, type: 'movie', name });
const headers = { 'access-control-allow-origin': '*' };
function gate() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
async function answer(route: Route, items: ReturnType<typeof meta>[]) { try { await route.fulfill({ json: { metas: items }, headers }); } catch { /* Request may already be cancelled. */ } }
async function submit(page: Page, query = 'Sample') { await page.getByRole('textbox', { name: 'Search movies, TV shows, and sports', exact: true }).fill(query); await page.locator('.search-submit').click(); }
async function settings(page: Page) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
}
async function returnToSearch(page: Page) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Search', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(defs => {
    localStorage.setItem('bridged-streams.addons.v1', JSON.stringify(defs.map(d => d.manifestUrl)));
    localStorage.setItem('bridged-streams.startup-cache.v1.local-addons', JSON.stringify({ scope: 'browser', value: defs }));
  }, definitions);
  for (const def of definitions) await page.route(`${new URL(def.manifestUrl).origin}/**`, async route => {
    if (route.request().url().endsWith('/manifest.json')) await route.fulfill({ json: def.manifest, headers });
    else await answer(route, [meta(def.manifest.id.toUpperCase())]);
  });
  await page.goto('/#/search');
  await expect(page.locator('.search-submit')).toBeVisible();
});

test('streams early cards, appends late titles and upgrades duplicates without moving or remounting cards', async ({ page }) => {
  const held = gate();
  await page.route('https://search-a.test/catalog/**', async route => { await held.promise; await answer(route, [meta('early', 'Earlier catalog'), meta('dup', 'Preferred duplicate')]); });
  await page.route('https://search-b.test/catalog/**', route => answer(route, [meta('fast', 'Fast title'), meta('dup', 'Fallback duplicate')]));
  try {
    await submit(page);
    const cards = page.locator('.search-results .media-card');
    await expect(cards).toHaveCount(2);
    await expect(page.getByText('Still searching…', { exact: true })).toBeVisible();
    await expect(cards.nth(0)).toHaveAttribute('aria-label', 'View details for Fast title');
    const first = await cards.nth(0).elementHandle(), duplicate = await cards.nth(1).elementHandle();
    held.release();
    await expect(cards).toHaveCount(3);
    expect(await cards.nth(0).evaluate((node, old) => node === old, first)).toBe(true);
    expect(await cards.nth(1).evaluate((node, old) => node === old, duplicate)).toBe(true);
    await expect(cards.nth(1)).toHaveAttribute('aria-label', 'View details for Preferred duplicate');
    await expect(cards.nth(2)).toHaveAttribute('aria-label', 'View details for Earlier catalog');
    await expect(page.getByText('Still searching…', { exact: true })).toHaveCount(0);
  } finally { held.release(); }
});

test('deadline ends partial search, aborts the request, and a retry never treats partial previews as cached', async ({ page }) => {
  await page.clock.install();
  const held = gate(); let aborted = 0;
  page.on('requestfailed', r => { if (r.url().startsWith('https://search-b.test/catalog/')) aborted++; });
  await page.route('https://search-b.test/catalog/**', async route => { await held.promise; await answer(route, [meta('late')]); });
  try {
    await submit(page);
    await page.clock.runFor(100);
    await expect(page.locator('.search-results .media-card')).toHaveCount(1);
    await page.clock.fastForward(8100);
    await expect(page.getByText(/Some catalogs timed out/)).toBeVisible();
    await expect(page.locator('.search-pending')).toHaveCount(0);
    await expect.poll(() => aborted).toBe(1);
    await page.route('https://search-a.test/catalog/**', async route => { await held.promise; await answer(route, []); });
    await page.getByRole('button', { name: 'Retry search' }).click();
    await expect(page.locator('.search-results .media-card')).toHaveCount(0);
    await expect(page.getByLabel('Searching addon catalogs')).toBeVisible();
  } finally { held.release(); }
});

test('cache refresh and repeated Enter preserve existing nodes and deduplicate in-flight requests', async ({ page }) => {
  await submit(page);
  const cards = page.locator('.search-results .media-card');
  await expect(cards).toHaveCount(2); await expect(page.locator('.search-pending')).toHaveCount(0);
  const first = await cards.first().elementHandle();
  const held = gate(); let requests = 0;
  for (const id of ['a','b']) await page.route(`https://search-${id}.test/catalog/**`, async route => {
    requests++; await held.promise; await answer(route, [meta(id.toUpperCase()), meta('new')]);
  });
  try {
    await submit(page);
    await expect(page.locator('.search-pending')).toBeVisible();
    await expect(page.getByLabel('Searching addon catalogs')).toHaveCount(0);
    await expect(cards).toHaveCount(2);
    expect(await cards.first().evaluate((node, old) => node === old, first)).toBe(true);
    await expect.poll(() => requests).toBe(2);
    await page.locator('.search-submit').click(); await page.waitForTimeout(100);
    expect(requests).toBe(2);
    held.release(); await expect(cards).toHaveCount(3);
    expect(await cards.first().evaluate((node, old) => node === old, first)).toBe(true);
    let returned = 0;
    page.on('request', r => { if (r.url().includes('/catalog/') && r.url().includes('search=')) returned++; });
    await settings(page); await returnToSearch(page);
    await expect(cards).toHaveCount(3); expect(returned).toBe(0);
  } finally { held.release(); }
});

test('recent search uses its exact cached previews while both catalogs refresh', async ({ page }) => {
  await page.clock.install(); await submit(page, 'First'); await page.clock.runFor(100);
  await expect(page.locator('.search-results .media-card')).toHaveCount(2);
  await page.clock.fastForward(2600);
  await submit(page, 'Second'); await page.clock.runFor(100);
  await expect(page.locator('.search-pending')).toHaveCount(0);
  const held = gate();
  for (const id of ['a','b']) await page.route(`https://search-${id}.test/catalog/**`, async route => { await held.promise; await answer(route, []); });
  try {
    await page.getByRole('button', { name: 'Recent searches', exact: true }).click();
    await page.getByRole('group', { name: 'Recent searches' }).getByRole('button', { name: 'First', exact: true }).click();
    await expect(page.locator('.search-results .media-card')).toHaveCount(2);
    await expect(page.locator('.search-pending')).toBeVisible();
    await expect(page.getByLabel('Searching addon catalogs')).toHaveCount(0);
  } finally { held.release(); }
});

test('failed, complete-empty and unsupported searches have distinct states', async ({ page }) => {
  for (const id of ['a','b']) await page.route(`https://search-${id}.test/catalog/**`, route => route.fulfill({ status:503, body:'Synthetic unavailable', headers }));
  await submit(page);
  await expect(page.getByText(/Some catalogs could not be searched/)).toBeVisible();
  await expect(page.getByText('No results.', { exact:true })).toHaveCount(0);
  for (const id of ['a','b']) await page.route(`https://search-${id}.test/catalog/**`, route => answer(route, []));
  await page.getByRole('button', { name:'Retry search' }).click();
  await expect(page.getByText('No results.', { exact:true })).toBeVisible();
  await settings(page); await page.getByRole('button', { name:/Addons and playback/ }).click();
  await page.getByRole('checkbox', { name:'Disable Search A', exact:true }).uncheck();
  await page.getByRole('checkbox', { name:'Disable Search B', exact:true }).uncheck();
  await page.getByRole('dialog', { name:'Manage addons' }).getByRole('button', { name:'Close', exact:true }).click();
  await returnToSearch(page); await submit(page);
  await expect(page.getByText(/No installed catalog supports search/)).toBeVisible();
});

test('new query and clear abort prior transports and prevent late results', async ({ page }) => {
  const held = gate(); let aborted = 0, requests = 0;
  page.on('requestfailed', r => { if (r.url().includes('/catalog/')) aborted++; });
  for (const id of ['a','b']) await page.route(`https://search-${id}.test/catalog/**`, async route => {
    requests++;
    if (decodeURIComponent(route.request().url()).includes('search=Old')) await held.promise;
    await answer(route, [meta('only-'+(decodeURIComponent(route.request().url()).includes('search=Old')?'old':'new'))]);
  });
  try {
    await submit(page,'Old'); await expect.poll(() => requests).toBe(2);
    await submit(page,'New'); await expect(page.locator('.search-results .media-card')).toHaveCount(1);
    await expect.poll(() => aborted).toBe(2);
    held.release(); await page.waitForTimeout(100);
    await expect(page.locator('.search-results .media-card')).toHaveAttribute('aria-label','View details for only-new');
    await page.getByRole('button', {name:'Clear search',exact:true}).click();
    await expect(page.locator('.search-results')).toHaveCount(0);
  } finally { held.release(); }
});

test('source changes abort a refresh and invalidate the completed query cache', async ({ page }) => {
  await submit(page); await expect(page.locator('.search-results .media-card')).toHaveCount(2);
  await expect(page.locator('.search-pending')).toHaveCount(0);
  const held=gate(); let aborted=0;
  page.on('requestfailed',r=>{if(r.url().includes('/catalog/'))aborted++;});
  for(const id of ['a','b'])await page.route(`https://search-${id}.test/catalog/**`,async route=>{await held.promise;await answer(route,[meta('updated')]);});
  try {
    await submit(page); await expect(page.locator('.search-pending')).toBeVisible();
    await settings(page); await page.getByRole('button',{name:/Addons and playback/}).click();
    await page.getByRole('checkbox',{name:'Disable Search A',exact:true}).uncheck();
    await expect.poll(()=>aborted).toBe(2);
    await page.getByRole('dialog',{name:'Manage addons'}).getByRole('button',{name:'Close',exact:true}).click();
    await returnToSearch(page); await submit(page);
    await expect(page.locator('.search-results .media-card')).toHaveCount(0);
    await expect(page.getByLabel('Searching addon catalogs')).toBeVisible();
  }finally{held.release();}
});

test('sign-out invalidates a query cache even when its local catalog targets stay the same', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bridged-streams.stremio-session.v1', JSON.stringify({authKey:'synthetic-not-a-real-key',user:{_id:'synthetic-user',email:'synthetic@example.invalid'}})));
  await page.route('https://api.strem.io/api/**', route => {
    const method=route.request().url().split('/').pop();
    const result=method==='getUser'?{_id:'synthetic-user',email:'synthetic@example.invalid'}:method==='addonCollectionGet'?{addons:[]}:[];
    return route.fulfill({json:{result},headers});
  });
  await page.reload(); await submit(page);
  await expect(page.locator('.search-results .media-card')).toHaveCount(2); await expect(page.locator('.search-pending')).toHaveCount(0);
  const held=gate();
  for(const id of ['a','b'])await page.route(`https://search-${id}.test/catalog/**`,async route=>{await held.promise;await answer(route,[]);});
  try {
    await settings(page); await page.getByRole('button',{name:/Accounts and profiles/}).click();
    await page.getByRole('button',{name:'Disconnect this account',exact:true}).click();
    await page.getByRole('dialog',{name:'Accounts'}).getByRole('button',{name:'Close account',exact:true}).click();
    await returnToSearch(page); await submit(page);
    await expect(page.locator('.search-results .media-card')).toHaveCount(0);
    await expect(page.getByLabel('Searching addon catalogs')).toBeVisible();
  }finally{held.release();}
});

test('profile and PIN unlock invalidate cached local previews without persisting search results', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('bridged-streams.nuvio-session.v1',JSON.stringify({backendUrl:'https://cloud.search.test',publishableKey:'synthetic-public-key',accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,user:{id:'synthetic-user',email:'synthetic@example.invalid'}}));
    localStorage.setItem('bridged-streams.nuvio-profile.v1',JSON.stringify({userId:'synthetic-user',index:1}));
  });
  await page.route('https://cloud.search.test/**',route=>route.fulfill({json:route.request().url().includes('sync_pull_profiles')?[{profile_index:1,name:'Main'},{profile_index:2,name:'Locked',pin_enabled:true}]:route.request().url().includes('verify_profile_pin')?{unlocked:true}:[],headers}));
  await page.reload();
  await submit(page); await expect(page.locator('.search-results .media-card')).toHaveCount(2); await expect(page.locator('.search-pending')).toHaveCount(0);
  await settings(page); await page.getByRole('button',{name:/Accounts and profiles/}).click();
  const accounts=page.getByRole('dialog',{name:'Accounts'});
  await accounts.locator('.profile-select select').selectOption('2');
  await expect(accounts.getByRole('button',{name:'Unlock profile',exact:true})).toBeVisible();
  await accounts.getByRole('button',{name:'Close account',exact:true}).click(); await returnToSearch(page);
  const held=gate();
  for(const id of ['a','b'])await page.route(`https://search-${id}.test/catalog/**`,async route=>{await held.promise;await answer(route,[meta(id)]);});
  try {
    await submit(page); await expect(page.locator('.search-results .media-card')).toHaveCount(0);
    await expect(page.getByLabel('Searching addon catalogs')).toBeVisible();
    held.release(); await expect(page.locator('.search-results .media-card')).toHaveCount(2); await expect(page.locator('.search-pending')).toHaveCount(0);
    await settings(page); await page.getByRole('button',{name:/Accounts and profiles/}).click();
    await accounts.getByLabel('Profile PIN',{exact:true}).fill('0000');
    await accounts.getByRole('button',{name:'Unlock profile',exact:true}).click();
    await expect(accounts.getByRole('button',{name:'Unlock profile',exact:true})).toHaveCount(0);
    const refreshed=gate();
    for(const id of ['a','b'])await page.route(`https://search-${id}.test/catalog/**`,async route=>{await refreshed.promise;await answer(route,[]);});
    try {
      await accounts.getByRole('button',{name:'Close account',exact:true}).click(); await returnToSearch(page); await submit(page);
      await expect(page.locator('.search-results .media-card')).toHaveCount(0);
      await expect(page.getByLabel('Searching addon catalogs')).toBeVisible();
      expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('bridged-streams.search') && k !== 'bridged-streams.search-history.v1'))).toEqual([]);
    }finally{refreshed.release();}
  }finally{held.release();}
});
