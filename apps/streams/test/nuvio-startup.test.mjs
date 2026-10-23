import test from 'node:test';
import assert from 'node:assert/strict';
import { nuvioStartupLeaseMs, eligibleStartupAuthorization, AUTHORIZATION_MAX_AGE_MS, cachedNuvioAuthorization, knownProtectedNuvioProfile, saveNuvioAuthorization, clearNuvioAuthorization } from '../src/lib/nuvio-startup.ts';
import { recentNuvioStartupCache, saveAddons } from '../src/lib/startup-cache.ts';
const now=1_800_000_000_000;
const session={backendUrl:'https://cloud.test',accessToken:'synthetic-access',refreshToken:'synthetic-refresh',user:{id:'user-a'},expiresAt:now+3600_000};
const record={backend:session.backendUrl,user:'user-a',profile:2,protected:false,checkedAt:now-1000};
const store=new Map();
globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
test('only a recent matching explicitly unprotected authorization permits startup display',()=>{
 assert.equal(eligibleStartupAuthorization(session,2,record,now),true);
 for(const patch of [{backend:'https://other.test'},{user:'other'},{profile:1},{protected:true},{protected:undefined},{checkedAt:now+1},{checkedAt:now-AUTHORIZATION_MAX_AGE_MS},{checkedAt:NaN}]) assert.equal(eligibleStartupAuthorization(session,2,{...record,...patch},now),false);
 // An expired access token is routine: validation refreshes it before any account request.
 assert.equal(eligibleStartupAuthorization({...session,expiresAt:now-1},2,record,now),true);
 assert.equal(eligibleStartupAuthorization({...session,refreshToken:''},2,record,now),false);
 assert.equal(eligibleStartupAuthorization(session,2,{...record,checkedAt:now-AUTHORIZATION_MAX_AGE_MS+1},now),true);
 for(const value of [null,{},'bad']) assert.equal(eligibleStartupAuthorization(session,2,value,now),false);
});
test('authorization is cleared on invalidation and a protected profile never becomes optimistic after unlock',()=>{
 const current={...session,expiresAt:Date.now()+3600_000};
 saveNuvioAuthorization(current,{profile_index:2,pin_enabled:false,name:'Profile'});
 assert.equal(cachedNuvioAuthorization(current,2),true);
 saveNuvioAuthorization(current,{profile_index:2,pin_enabled:true,name:'Profile'});
 assert.equal(cachedNuvioAuthorization(current,2),false);
 assert.equal(knownProtectedNuvioProfile(current,2),true);
 assert.equal(knownProtectedNuvioProfile(current,1),false);
 // Same rule as the app's lock: no pin_enabled flag means no PIN.
 saveNuvioAuthorization(current,{profile_index:2,name:'No PIN metadata'});
 assert.equal(cachedNuvioAuthorization(current,2),true);
 assert.equal(knownProtectedNuvioProfile(current,2),false);
 clearNuvioAuthorization();assert.equal(cachedNuvioAuthorization(current,2),false);
});
test('legacy, old, future or mismatched cache envelopes are not eligible before validation',()=>{
 const key='bridged-streams.startup-cache.v1.nuvio-addons';store.clear();
 assert.equal(recentNuvioStartupCache('scope',1000,now),false);
 for(const value of [{scope:'scope',value:[]},{scope:'other',value:[],savedAt:now},{scope:'scope',value:[],savedAt:now-1001},{scope:'scope',value:[],savedAt:now+1}]){
 store.set(key,JSON.stringify(value));assert.equal(recentNuvioStartupCache('scope',1000,now),false);
 }
 store.set(key,JSON.stringify({scope:'scope',value:[],savedAt:now}));assert.equal(recentNuvioStartupCache('scope',1000,now),true);
 store.set('bridged-streams.startup-cache.v1.nuvio-library',JSON.stringify({scope:'another-profile',value:[],savedAt:now}));
 assert.equal(recentNuvioStartupCache('scope',1000,now),false);
});
test('cache writers timestamp envelopes without changing their scoped array contract',()=>{
 store.clear();saveAddons('nuvio-addons','scope',[]);
 assert.equal(recentNuvioStartupCache('scope',1000),true);
});

test('offline display permission has a finite lease matching the cache age',t=>{
 t.mock.timers.enable({apis:['Date'],now});
 const current={...session,expiresAt:now+90_000};
 saveNuvioAuthorization(current,{profile_index:2,name:'Profile',pin_enabled:false});
 assert.equal(nuvioStartupLeaseMs(current,2),AUTHORIZATION_MAX_AGE_MS);
 t.mock.timers.tick(AUTHORIZATION_MAX_AGE_MS);assert.equal(cachedNuvioAuthorization(current,2),false);
});
