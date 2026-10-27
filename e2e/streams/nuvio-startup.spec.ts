import {expect,test,type Page} from '@playwright/test';
const headers={'access-control-allow-origin':'*'};
const backend='https://startup-privacy.test';
const addon={manifestUrl:'https://startup-catalog.test/manifest.json',manifest:{id:'private-fixture',name:'Fixture',version:'1',types:['movie'],resources:['catalog','meta'],catalogs:[{id:'home',name:'Cached home',type:'movie'},{id:'search',name:'Search',type:'movie',extra:[{name:'search',isRequired:true}]}]}};
const preview={id:'fixture-title',type:'movie',name:'Authorized cached title'};
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return{promise,release};}
async function setup(page:Page, options:{protected?:boolean;cacheUser?:string;expired?:boolean;checkedAgo?:number}={}){
 await page.addInitScript(({backend,addon,preview,options})=>{
  const session={backendUrl:backend,publishableKey:'synthetic-public',accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:Date.now()+(options.expired?-1:3600_000),user:{id:'fixture-user',email:'fixture@example.invalid'}};
  localStorage.setItem('bridged-streams.nuvio-session.v1',JSON.stringify(session));
  localStorage.setItem('bridged-streams.nuvio-profile.v1',JSON.stringify({userId:'fixture-user',index:2}));
  const user=options.cacheUser||'fixture-user',scope=`${backend}:${user}:2`;
  localStorage.setItem('bridged-streams.nuvio-startup-authorization.v1',JSON.stringify({backend,user,profile:2,protected:!!options.protected,checkedAt:Date.now()-(options.checkedAgo||0)}));
  localStorage.setItem('bridged-streams.startup-cache.v1.nuvio-addons',JSON.stringify({scope,value:[addon],savedAt:Date.now()}));
  localStorage.setItem('bridged-streams.catalog-cache.v1',JSON.stringify({[JSON.stringify([null,scope,`${addon.manifestUrl}:movie:home`])]:{items:[preview],savedAt:Date.now()}}));
 },{backend,addon,preview,options});
 await page.route('https://startup-catalog.test/**',route=>route.fulfill({json:route.request().url().endsWith('manifest.json')?addon.manifest:route.request().url().includes('/meta/')?{meta:preview}:{metas:[preview]},headers}));
}
const cards=(page:Page)=>page.getByRole('button',{name:'View details for Authorized cached title',exact:true});
for(const result of ['unprotected','protected','deleted','failed','revoked'] as const)test(`recent cached Nuvio Home reconciles ${result} validation`,async({page})=>{
 await setup(page);const profiles=gate();
 await page.route(`${backend}/**`,async route=>{
  if(route.request().url().includes('sync_pull_profiles')){
   await profiles.promise;
   if(result==='revoked'||result==='failed'){await route.fulfill({status:result==='revoked'?401:503,json:{message:'Synthetic unavailable'},headers});return;}
   await route.fulfill({json:result==='deleted'?[{profile_index:1,name:'Other'}]:[{profile_index:2,name:'Saved',pin_enabled:result==='protected'}],headers});
  }else await route.fulfill({json:route.request().url().includes('/addons?')?[{url:addon.manifestUrl,enabled:true}]:[],headers});
 });
 try{
  await page.goto('/');await expect(cards(page).first()).toBeVisible();
  if(result==='unprotected'){
   await cards(page).first().click();await expect(page.getByRole('dialog',{name:preview.name,exact:true})).toBeVisible();
  }
  profiles.release();
  if(result==='unprotected')await expect(page.getByRole('dialog',{name:preview.name,exact:true})).toBeVisible();
  else {
   await expect(cards(page)).toHaveCount(0);
   await expect.poll(()=>page.evaluate(()=>localStorage.getItem('bridged-streams.startup-cache.v1.nuvio-addons'))).toBe(null);
   await page.waitForTimeout(250);await expect(cards(page)).toHaveCount(0);
   if(result==='revoked')expect(await page.evaluate(()=>localStorage.getItem('bridged-streams.nuvio-session.v1'))).toBe(null);
  }
 }finally{profiles.release();}
});
for(const options of [{protected:true},{cacheUser:'other-user'},{checkedAgo:24*60*60_000+1000}])test(`ineligible cache stays hidden before authorization ${JSON.stringify(options)}`,async({page})=>{
 await setup(page,options);const profiles=gate();
 await page.route(`${backend}/**`,async route=>{await profiles.promise;await route.fulfill({json:route.request().url().includes('sync_pull_profiles')?[{profile_index:2,name:'Saved',pin_enabled:true}]:{},headers});});
 try{await page.goto('/');await page.waitForTimeout(500);await expect(cards(page)).toHaveCount(0);profiles.release();await page.waitForTimeout(300);await expect(cards(page)).toHaveCount(0);}finally{profiles.release();}
});

test('a protected cached profile has no content until explicit PIN unlock',async({page})=>{
 await setup(page,{protected:true});
 await page.route(`${backend}/**`,route=>route.fulfill({json:route.request().url().includes('sync_pull_profiles')?[{profile_index:2,name:'Protected',pin_enabled:true}]:route.request().url().includes('verify_profile_pin')?{unlocked:true}:route.request().url().includes('/addons?')?[{url:addon.manifestUrl,enabled:true}]:[],headers}));
 await page.goto('/');await expect(cards(page)).toHaveCount(0);
 const gate=page.getByRole('dialog',{name:"Who's watching?"});
 await gate.getByRole('button',{name:/^Protected, PIN required/}).click();
 await gate.getByLabel('Profile PIN',{exact:true}).fill('0000');
 await expect(gate).toHaveCount(0);
 await expect(cards(page).first()).toBeVisible();
});

test('a late catalog response cannot republish a profile after validation revokes display',async({page})=>{
 await setup(page);const profiles=gate(),catalog=gate();let requests=0;
 await page.route('https://startup-catalog.test/catalog/**',async route=>{requests++;await catalog.promise;await route.fulfill({json:{metas:[preview]},headers});});
 await page.route(`${backend}/**`,async route=>{await profiles.promise;await route.fulfill({json:[{profile_index:2,name:'Protected',pin_enabled:true}],headers});});
 try{
  await page.goto('/');await expect(cards(page).first()).toBeVisible();await expect.poll(()=>requests).toBeGreaterThan(0);
  profiles.release();await expect(cards(page)).toHaveCount(0);
  catalog.release();await page.waitForTimeout(250);await expect(cards(page)).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('bridged-streams.catalog-cache.v1'))).toBe(null);
 }finally{profiles.release();catalog.release();}
});

test('an expired access token with a recent unprotected check shows cached Home before the refresh',async({page})=>{
 await setup(page,{expired:true,checkedAgo:3*60*60_000});const refresh=gate();
 await page.route(`${backend}/**`,async route=>{
  const url=route.request().url();
  if(url.includes('grant_type=refresh_token')){await refresh.promise;await route.fulfill({json:{access_token:'synthetic-access-2',refresh_token:'synthetic-refresh-2',expires_in:3600,user:{id:'fixture-user',email:'fixture@example.invalid'}},headers});return;}
  await route.fulfill({json:url.includes('sync_pull_profiles')?[{profile_index:2,name:'Saved',pin_enabled:false}]:url.includes('/addons?')?[{url:addon.manifestUrl,enabled:true}]:[],headers});
 });
 try{
  await page.goto('/');await expect(cards(page).first()).toBeVisible();
  refresh.release();await page.waitForTimeout(300);await expect(cards(page).first()).toBeVisible();
 }finally{refresh.release();}
});

test('revoked expired refresh tokens sign out and remove cached titles',async({page})=>{
 await setup(page,{expired:true});
 await page.route(`${backend}/**`,route=>route.fulfill({status:400,json:{error_code:'refresh_token_not_found',msg:'Synthetic revoked session'},headers}));
 await page.goto('/');
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('bridged-streams.nuvio-session.v1'))).toBe(null);
 await expect(cards(page)).toHaveCount(0);
});

test('offline cached Home is display-only and disappears when its authorization lease expires',async({page,context})=>{
 await setup(page);const response=gate();
 await page.route(`${backend}/**`,async route=>{await response.promise;await route.abort();});
 try{
  await page.clock.install();await page.goto('/');await expect(cards(page).first()).toBeVisible();
  await context.setOffline(true);response.release();
  await page.clock.runFor(1000);await expect(cards(page).first()).toBeVisible();
  await page.clock.fastForward(24*60*60_000);await expect(cards(page)).toHaveCount(0);
 }finally{response.release();await context.setOffline(false);}
});
