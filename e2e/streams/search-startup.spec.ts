import { expect, test, type Route } from '@playwright/test';

const headers = { 'access-control-allow-origin':'*' };
const addon = (id:string,version='1.0.0') => ({manifestUrl:`https://startup-${id}.test/manifest.json`,manifest:{id,name:`Synthetic ${id}`,version,resources:['catalog'],types:['movie'],catalogs:[{id:'search',type:'movie',name:'Search',extra:[{name:'search',isRequired:true}]}]}});
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return{promise,release};}
async function answer(route:Route,id:string,fresh:boolean){try{await route.fulfill({json:{metas:[{id,type:'movie',name:(fresh?'Fresh ':'Old ')+id}]},headers});}catch{/* Cancelled by a newer source configuration. */}}

// A saved non-primary Nuvio profile is known before its asynchronous validation.
test('search submitted during Nuvio profile hydration survives cached-source then refreshed-manifest bursts',async({page})=>{
  const a=addon('a'),b=addon('b'),profiles=gate(),manifest=gate();let manifestRequests=0,searches=0,fresh=false;
  await page.addInitScript(({a,b})=>{
    localStorage.setItem('bridged-streams.addons.v1',JSON.stringify([a.manifestUrl]));
    localStorage.setItem('bridged-streams.startup-cache.v1.local-addons',JSON.stringify({scope:'browser',value:[a]}));
    localStorage.setItem('bridged-streams.nuvio-session.v1',JSON.stringify({backendUrl:'https://cloud.startup.test',publishableKey:'synthetic-public',accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,user:{id:'synthetic-user',email:'synthetic@example.invalid'}}));
    localStorage.setItem('bridged-streams.nuvio-profile.v1',JSON.stringify({userId:'synthetic-user',index:2}));
    localStorage.setItem('bridged-streams.startup-cache.v1.nuvio-addons',JSON.stringify({scope:'https://cloud.startup.test:synthetic-user:2',value:[b]}));
  },{a,b});
  await page.route('https://cloud.startup.test/**',async route=>{
    const url=route.request().url();
    if(url.includes('sync_pull_profiles')){await profiles.promise;await route.fulfill({json:[{profile_index:1,name:'Main'},{profile_index:2,name:'Saved profile'}],headers});}
    else await route.fulfill({json:url.includes('/addons?')?[{url:b.manifestUrl,enabled:true}]:[],headers});
  });
  await page.route(a.manifestUrl,route=>route.fulfill({json:a.manifest,headers}));
  await page.route(b.manifestUrl,async route=>{manifestRequests++;await manifest.promise;await route.fulfill({json:addon('b','2.0.0').manifest,headers});});
  for(const id of ['a','b'])await page.route(`https://startup-${id}.test/catalog/**`,route=>{searches++;return answer(route,id,fresh);});
  try{
    await page.goto('/#/search');
    await page.getByRole('textbox',{name:'Search movies, TV shows, and sports',exact:true}).fill('Sample');
    await page.locator('.search-submit').click();
    await expect(page.locator('.search-results .media-card')).toHaveCount(1);
    await expect(page.locator('.search-pending')).toHaveCount(0);
    const first=await page.locator('.search-results .media-card').elementHandle();
    fresh=true;profiles.release();
    await expect.poll(()=>manifestRequests).toBe(1);
    manifest.release();
    await expect(page.getByRole('button',{name:'View details for Fresh b',exact:true})).toBeVisible();
    await expect(page.locator('.search-results .media-card')).toHaveCount(2);
    expect(await page.locator('.search-results .media-card').first().evaluate((node,old)=>node===old,first)).toBe(true);
    await expect(page.locator('.search-pending')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('textbox',{name:'Search movies, TV shows, and sports',exact:true})).toHaveValue('Sample');
    expect(searches).toBe(3);
    await expect(page.getByText(/Submit again/)).toHaveCount(0);
  }finally{profiles.release();manifest.release();}
});

test('cached deep-link search survives a Stremio background add-on collection refresh',async({page})=>{
  const a=addon('a'),b=addon('b'),collection=gate();let fresh=false,searches=0,collections=0;
  await page.addInitScript(({a,b})=>{
    localStorage.setItem('bridged-streams.addons.v1',JSON.stringify([a.manifestUrl]));
    localStorage.setItem('bridged-streams.startup-cache.v1.local-addons',JSON.stringify({scope:'browser',value:[a]}));
    localStorage.setItem('bridged-streams.stremio-session.v1',JSON.stringify({authKey:'synthetic-not-a-real-key',user:{_id:'synthetic-user',email:'synthetic@example.invalid'}}));
    localStorage.setItem('bridged-streams.startup-cache.v1.stremio-addons',JSON.stringify({scope:'synthetic-user',value:[b]}));
  },{a,b});
  await page.route('https://api.strem.io/api/**',async route=>{
    const method=route.request().url().split('/').pop();let result:unknown=[];
    if(method==='getUser')result={_id:'synthetic-user',email:'synthetic@example.invalid'};
    if(method==='addonCollectionGet'){collections++;await collection.promise;result={addons:[{transportUrl:b.manifestUrl,manifest:addon('b','2.0.0').manifest}]};}
    await route.fulfill({json:{result},headers});
  });
  await page.route(a.manifestUrl,route=>route.fulfill({json:a.manifest,headers}));
  for(const id of ['a','b'])await page.route(`https://startup-${id}.test/catalog/**`,route=>{searches++;return answer(route,id,fresh);});
  try{
    await page.clock.install();
    await page.goto('/#/search?q=Sample');
    await expect(page.locator('.search-results .media-card')).toHaveCount(2);
    await expect(page.locator('.search-pending')).toHaveCount(0);
    fresh=true;
    await page.clock.fastForward(10*60_000+1);
    await expect.poll(()=>collections).toBe(1);
    collection.release();
    await page.clock.runFor(600);
    await expect(page.getByRole('button',{name:'View details for Fresh b',exact:true})).toBeVisible();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('.search-results .media-card')).toHaveCount(2);
    await expect(page.locator('.search-pending')).toHaveCount(0);expect(searches).toBe(4);
  }finally{collection.release();}
});
