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
    if (!sessionStorage.getItem('search-test-no-cache')) localStorage.setItem('bridged-streams.startup-cache.v1.local-addons', JSON.stringify({ scope: 'browser', value: defs }));
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
  await settings(page); await page.getByRole('button', { name:/^Addons / }).click();
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

test('source changes debounce into an automatic rerun without clearing the query or current cards', async ({ page }) => {
  await submit(page); await expect(page.locator('.search-results .media-card')).toHaveCount(2);
  await expect(page.locator('.search-pending')).toHaveCount(0);
  const old=gate(), fresh=gate();let updating=false,aborted=0,reruns=0;
  page.on('requestfailed',r=>{if(r.url().includes('/catalog/'))aborted++;});
  for(const id of ['a','b'])await page.route(`https://search-${id}.test/catalog/**`,async route=>{
    const refresh=updating;
    if(refresh)reruns++;
    await (refresh?fresh:old).promise;
    await answer(route,[meta(id.toUpperCase())]);
  });
  try {
    await submit(page); await expect(page.locator('.search-pending')).toBeVisible();
    await settings(page); await page.getByRole('button',{name:/^Addons /}).click();
    updating=true;
    await page.getByRole('checkbox',{name:'Disable Search A',exact:true}).uncheck();
    await expect.poll(()=>aborted).toBe(2);
    await page.getByRole('dialog',{name:'Manage addons'}).getByRole('button',{name:'Close',exact:true}).click();
    await returnToSearch(page);
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('textbox',{name:'Search movies, TV shows, and sports',exact:true})).toHaveValue('Sample');
    await expect(page.locator('.search-results .media-card')).toHaveCount(2);
    await expect(page.getByLabel('Searching addon catalogs')).toHaveCount(0);
    await expect.poll(()=>reruns).toBe(1);
    fresh.release();await expect(page.locator('.search-results .media-card')).toHaveCount(1);
    await expect(page.locator('.search-results .media-card')).toHaveAttribute('aria-label','View details for B');
    await expect(page.getByText(/Submit again/)).toHaveCount(0);
  }finally{old.release();fresh.release();}
});

test('sign-out invalidates a query cache even when its catalog targets stay the same', async ({ page }) => {
  await page.addInitScript(defs => {
    localStorage.setItem('bridged-streams.stremio-session.v1', JSON.stringify({authKey:'synthetic-not-a-real-key',user:{_id:'synthetic-user',email:'synthetic@example.invalid'}}));
    localStorage.setItem('bridged-streams.startup-cache.v1.stremio-addons', JSON.stringify({ scope: 'synthetic-user', value: defs }));
  }, definitions);
  await page.route('https://api.strem.io/api/**', route => {
    const method=route.request().url().split('/').pop();
    // The account carries the same catalogs as this browser, so signing out leaves the targets unchanged.
    const result=method==='getUser'?{_id:'synthetic-user',email:'synthetic@example.invalid'}:method==='addonCollectionGet'?{addons:definitions.map(def=>({transportUrl:def.manifestUrl,manifest:def.manifest}))}:[];
    return route.fulfill({json:{result},headers});
  });
  await page.reload(); await returnToSearch(page); await submit(page);
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
    localStorage.setItem('bridged-streams.profile-launch.v1','remember');
  });
  await page.route('https://cloud.search.test/**',route=>route.fulfill({json:route.request().url().includes('sync_pull_profiles')?[{profile_index:1,name:'Main'},{profile_index:2,name:'Locked',pin_enabled:true}]:route.request().url().includes('verify_profile_pin')?{unlocked:true}:route.request().url().includes('/addons?')?definitions.map(def=>({url:def.manifestUrl,enabled:true})):[],headers}));
  await page.reload();
  await returnToSearch(page);
  await submit(page); await expect(page.locator('.search-results .media-card')).toHaveCount(2); await expect(page.locator('.search-pending')).toHaveCount(0);
  await settings(page); await page.getByRole('button',{name:/Accounts and profiles/}).click();
  const accounts=page.getByRole('dialog',{name:'Accounts'});
  // Entering the locked profile verifies its PIN, then switches and invalidates the previews.
  await accounts.getByRole('radio',{name:'Locked, PIN required',exact:true}).click();
  const profiles=page.getByRole('dialog',{name:"Who's watching?"});
  await profiles.getByLabel('Profile PIN',{exact:true}).fill('0000');
  await expect(profiles).toHaveCount(0);
  await expect(accounts.getByRole('radio',{name:'Locked, PIN required',exact:true})).toHaveAttribute('aria-checked','true');
  await accounts.getByRole('button',{name:'Close account',exact:true}).click(); await returnToSearch(page);
  const held=gate();
  for(const id of ['a','b'])await page.route(`https://search-${id}.test/catalog/**`,async route=>{await held.promise;await answer(route,[meta(id)]);});
  try {
    await submit(page); await expect(page.locator('.search-results .media-card')).toHaveCount(0);
    await expect(page.getByLabel('Searching addon catalogs')).toBeVisible();
    held.release(); await expect(page.locator('.search-results .media-card')).toHaveCount(2); await expect(page.locator('.search-pending')).toHaveCount(0);
    await settings(page); await page.getByRole('button',{name:/Accounts and profiles/}).click();
    await accounts.getByRole('radio',{name:'Main',exact:true}).click();
    await expect(accounts.getByRole('radio',{name:'Main',exact:true})).toHaveAttribute('aria-checked','true');
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

for (const entry of ['submitted','cached-deep-link']) test(`a ${entry} search survives startup manifest replacement`, async ({ page }) => {
  const manifests=gate(),fresh=gate();let updated=false,requests=0;
  for(const def of definitions) {
    await page.route(def.manifestUrl,async route=>{await manifests.promise;await route.fulfill({json:{...def.manifest,version:'2.0.0'},headers});});
    await page.route(`${new URL(def.manifestUrl).origin}/catalog/**`,async route=>{
      requests++;const isUpdated=updated;
      if(isUpdated)await fresh.promise;
      await answer(route,[meta(def.manifest.id,isUpdated?'Fresh '+def.manifest.id:'Cached '+def.manifest.id)]);
    });
  }
  try {
    await page.goto(entry==='submitted'?'/?entry=submitted#/':'/?entry=cached-deep-link#/search?q=Sample');
    if(entry==='submitted'){await returnToSearch(page);await submit(page);}
    await expect(page.locator('.search-results .media-card')).toHaveCount(2);
    await expect(page.locator('.search-pending')).toHaveCount(0);
    const first=await page.locator('.search-results .media-card').first().elementHandle();
    updated=true;manifests.release();
    await expect.poll(()=>requests).toBe(4);
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('.search-results .media-card')).toHaveCount(2);
    expect(await page.locator('.search-results .media-card').first().evaluate((node,old)=>node===old,first)).toBe(true);
    await expect(page.getByLabel('Searching addon catalogs')).toHaveCount(0);
    fresh.release();
    await expect(page.getByRole('button',{name:'View details for Fresh a',exact:true})).toBeVisible();
    await expect(page.locator('.search-pending')).toHaveCount(0);
    expect(requests).toBe(4);
    await expect(page.getByText(/Submit again/)).toHaveCount(0);
  }finally{manifests.release();fresh.release();}
});

test('an uncached deep link waits for restore then searches instead of losing its route intent',async({page})=>{
  const held=gate();let requests=0;
  await page.evaluate(()=>{sessionStorage.setItem('search-test-no-cache','1');localStorage.removeItem('bridged-streams.startup-cache.v1.local-addons');});
  for(const def of definitions){
    await page.route(def.manifestUrl,async route=>{await held.promise;await route.fulfill({json:{...def.manifest,version:'3'},headers});});
    await page.route(`${new URL(def.manifestUrl).origin}/catalog/**`,route=>{requests++;return answer(route,[meta(def.manifest.id,'Restored '+def.manifest.id)]);});
  }
  try{
    await page.goto('/?restore=1#/search?q=Restored');
    await expect(page).toHaveURL(/#\/$/);expect(requests).toBe(0);
    held.release();
    await expect(page.locator('.search-results .media-card')).toHaveCount(2);
    await expect(page.getByRole('textbox',{name:'Search movies, TV shows, and sports',exact:true})).toHaveValue('Restored');
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('.search-pending')).toHaveCount(0);expect(requests).toBe(2);
  }finally{held.release();}
});

test('successful cache refresh drops stale cards except the prefix protecting an active press',async({page})=>{
  await page.route('https://search-a.test/catalog/**',route=>answer(route,[meta('keep'),meta('pressed')]));
  await page.route('https://search-b.test/catalog/**',route=>answer(route,[meta('unseen')]));
  await submit(page);await expect(page.locator('.search-results .media-card')).toHaveCount(3);
  await expect(page.locator('.search-pending')).toHaveCount(0);
  const held=gate();
  await page.route('https://search-a.test/catalog/**',async route=>{await held.promise;await answer(route,[meta('keep'),meta('new')]);});
  await page.route('https://search-b.test/catalog/**',async route=>{await held.promise;await answer(route,[]);});
  try{
    await submit(page);await expect(page.locator('.search-pending')).toBeVisible();
    const pressed=page.getByRole('button',{name:'View details for pressed',exact:true});
    const node=await pressed.elementHandle();
    await pressed.dispatchEvent('pointerdown',{pointerId:1});
    held.release();await expect(page.locator('.search-pending')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'View details for unseen',exact:true})).toHaveCount(0);
    expect(await pressed.evaluate((element,old)=>element===old,node)).toBe(true);
    await pressed.dispatchEvent('pointercancel',{pointerId:1});
    await expect(pressed).toHaveCount(0);
    await expect(page.locator('.search-results .media-card')).toHaveCount(2);
    await expect(page.getByText(/Some previous previews/)).toHaveCount(0);
  }finally{held.release();}
});

test('idle successful refresh shows exactly fresh matches including an authoritative no-match',async({page})=>{
  await submit(page);await expect(page.locator('.search-results .media-card')).toHaveCount(2);
  await expect(page.locator('.search-pending')).toHaveCount(0);
  for(const id of ['a','b'])await page.route(`https://search-${id}.test/catalog/**`,route=>answer(route,[]));
  await submit(page);
  await expect(page.locator('.search-results .media-card')).toHaveCount(0);
  await expect(page.getByText('No results.',{exact:true})).toBeVisible();
});

test('removing stale cards below a press does not clamp the viewport and move its target',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('https://search-a.test/catalog/**',route=>answer(route,Array.from({length:100},(_,i)=>meta('old-'+i))));
  await page.route('https://search-b.test/catalog/**',route=>answer(route,[]));
  await submit(page);await expect(page.locator('.search-results .media-card')).toHaveCount(100);
  await expect(page.locator('.search-pending')).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);
  const held=gate();
  await page.route('https://search-a.test/catalog/**',async route=>{await held.promise;await answer(route,[meta('new')]);});
  await page.route('https://search-b.test/catalog/**',async route=>{await held.promise;await answer(route,[]);});
  try{
    await submit(page);await expect(page.locator('.search-pending')).toBeVisible();
    const pressed=page.getByRole('button',{name:'View details for old-84',exact:true});
    await pressed.scrollIntoViewIfNeeded();const before=await pressed.boundingBox();
    await pressed.dispatchEvent('pointerdown',{pointerId:1});
    held.release();await expect(page.locator('.search-pending')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'View details for old-99',exact:true})).toHaveCount(0);
    const after=await pressed.boundingBox();
    expect(Math.abs(after!.y-before!.y)).toBeLessThan(1);
    await pressed.dispatchEvent('pointercancel',{pointerId:1});
    await expect(pressed).toHaveCount(0);await expect(page.locator('.search-results .media-card')).toHaveCount(1);
  }finally{held.release();}
});
