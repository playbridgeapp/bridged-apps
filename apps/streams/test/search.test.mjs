import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchSession, SEARCH_BATCH_MS, SEARCH_DEADLINE_MS, SEARCH_CACHE_TTL_MS, SEARCH_SOURCE_DEBOUNCE_MS, SEARCH_INTERACTION_SETTLE_MS, searchSources } from '../src/lib/search.ts';

const item = (id, name = id) => ({ id, type: 'movie', name });
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const delay = (ms, result) => () => new Promise(resolve => setTimeout(() => resolve(result), ms));
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const states = [];
  const session = new SearchSession(s => states.push(structuredClone(s)));
  session.setIdentity('account/profile/sources');
  return { session, states, get state() { return states.at(-1); } };
}
async function flush(t) { await drain(); t.mock.timers.tick(SEARCH_BATCH_MS); await drain(); }
async function advance(t, ms) { t.mock.timers.tick(ms); await flush(t); }

test('fast results publish in a batch without waiting for a slow source', async t => {
  const f = fixture(t);
  f.session.search('query', [delay(2000, [item('slow')]), delay(100, [item('fast')])]);
  await drain(); t.mock.timers.tick(100); await drain();
  assert.deepEqual(f.state.items, []);
  await advance(t, 31);
  assert.deepEqual(f.state.items.map(x => x.id), ['fast']);
  assert.equal(f.state.pending, 1);
  await advance(t, 2000);
  assert.deepEqual(f.state.items.map(x => x.id), ['fast', 'slow']);
  assert.equal(f.state.pending, 0);
});

test('duplicate priority and same-batch order are deterministic; published positions stay pinned', async t => {
  const f = fixture(t);
  const preferred = { ...item('dup', 'Preferred'), description: 'Details' };
  f.session.search('q', [delay(200, [item('first'), preferred]), delay(100, [item('later'), { ...item('dup', 'Fallback'), poster: 'https://art.test/poster.jpg' }])]);
  await drain(); await advance(t, 100);
  const positions = f.state.items.map(x => x.id);
  assert.deepEqual(positions, ['later', 'dup']);
  await advance(t, 100);
  assert.deepEqual(f.state.items.map(x => x.id), [...positions, 'first']);
  assert.equal(f.state.items[1].name, 'Preferred');
  assert.equal(f.state.items[1].poster, 'https://art.test/poster.jpg');
  assert.equal(f.state.items[1].description, 'Details');
  f.session.search('other', [() => Promise.resolve([item('a'), preferred]), () => Promise.resolve([item('b'), item('dup', 'Fallback')])]);
  await flush(t);
  assert.deepEqual(f.state.items.map(x => x.id), ['a', 'dup', 'b']);
  assert.equal(f.state.items[1].name, 'Preferred');
  f.session.search('one-batch', [delay(10, [item('a')]), delay(0, [item('b')])]);
  await drain(); t.mock.timers.tick(0); await drain(); t.mock.timers.tick(10); await flush(t);
  assert.deepEqual(f.state.items.map(x => x.id), ['a', 'b']);
});

test('deadline settles and aborts a hung transport even if it ignores its signal; partial results are not cached', async t => {
  const f = fixture(t); let signal;
  const providers = [() => Promise.resolve([item('ready')]), s => { signal = s; return new Promise(() => {}); }];
  f.session.search('q', providers); await flush(t);
  assert.equal(f.state.pending, 1); assert.equal(f.state.items.length, 1);
  await advance(t, SEARCH_DEADLINE_MS);
  assert.equal(f.state.pending, 0); assert.equal(f.state.timedOut, 1); assert.equal(f.state.failed, 0);
  assert.equal(signal.aborted, true);
  f.session.search('q', providers);
  assert.equal(f.state.cached, false); assert.deepEqual(f.state.items, []);
  f.session.clear();
});

test('rejection preserves successful results and never caches a partial or all-failed query', async t => {
  const f = fixture(t);
  const failed = () => Promise.reject(new Error('synthetic failure'));
  f.session.search('q', [failed, () => Promise.resolve([item('good')])]); await flush(t);
  assert.equal(f.state.failed, 1); assert.equal(f.state.pending, 0); assert.equal(f.state.items.length, 1);
  f.session.search('q', [failed]); assert.equal(f.state.cached, false); await flush(t);
  assert.deepEqual(f.state.items, []); assert.equal(f.state.failed, 1);
  f.session.search('q', [failed]); assert.equal(f.state.cached, false); f.session.clear();
});

test('new queries, clear and scope invalidation abort every old request and fence ignored late completions/cache writes', async t => {
  const f = fixture(t); const signals = []; const resolve = [];
  const held = signal => { signals.push(signal); return new Promise(r => resolve.push(r)); };
  f.session.search('old', [held, held]); await drain();
  f.session.search('new', [() => Promise.resolve([item('new')])]);
  assert.ok(signals.every(s => s.aborted)); await flush(t);
  const writes = f.states.length;
  resolve.forEach(r => r([item('old')])); await advance(t, 10000);
  assert.equal(f.states.length, writes); assert.equal(f.state.items[0].id, 'new');
  f.session.search('old', [held]); assert.equal(f.state.cached, false); await drain();
  f.session.clear(); assert.equal(signals.at(-1).aborted, true);
  resolve.at(-1)([item('late')]); await flush(t); assert.deepEqual(f.state.items, []);
  f.session.search('old', [held]); await drain();
  f.session.setIdentity('different-user/profile'); assert.equal(signals.at(-1).aborted, true);
  resolve.at(-1)([item('late')]); await flush(t); assert.deepEqual(f.state.items, []);
});

test('same query in flight joins one lookup; exact completed repeats seed previews and refresh without blanking', async t => {
  const f = fixture(t); let calls = 0;
  const provider = () => { calls++; return Promise.resolve([item('cached')]); };
  f.session.search('q', [provider]); f.session.search('q', [provider]); await flush(t);
  assert.equal(calls, 1);
  f.session.search('q', [delay(200, [item('cached', 'Updated'), item('added')])]);
  assert.equal(f.state.cached, true); assert.equal(f.state.items[0].id, 'cached'); assert.equal(f.state.pending, 1);
  f.session.search('q', [provider]); assert.equal(calls, 1);
  await drain(); await advance(t, 200);
  assert.deepEqual(f.state.items.map(x => x.id), ['cached', 'added']);
  assert.equal(f.state.items[0].name, 'Updated');
});

test('successful refresh drops obsolete previews immediately when there is no interaction', async t => {
  const f = fixture(t);
  f.session.search('q', [() => Promise.resolve([item('old'), item('keep')])]); await flush(t);
  f.session.search('q', [() => Promise.resolve([item('keep'), item('new')])]); await flush(t);
  assert.deepEqual(f.state.items.map(x => x.id), ['keep', 'new']);
  f.session.search('q', [() => new Promise(() => {})]);
  assert.deepEqual(f.state.items.map(x => x.id), ['keep', 'new']); f.session.clear();
});

test('only the prefix needed to protect interaction is pinned; release reconciles after click settles', async t => {
  const f = fixture(t);
  f.session.search('q', [() => Promise.resolve([item('old-before'), item('pressed'), item('old-after'), item('keep')])]); await flush(t);
  f.session.protectThrough(1);
  f.session.search('q', [() => Promise.resolve([item('keep'), item('new')])]); await flush(t);
  assert.deepEqual(f.state.items.map(x => x.id), ['old-before', 'pressed', 'keep', 'new']);
  f.session.protectThrough(null);
  t.mock.timers.tick(SEARCH_INTERACTION_SETTLE_MS - 1); await drain();
  assert.equal(f.state.items[1].id, 'pressed');
  await advance(t, 1);
  assert.deepEqual(f.state.items.map(x => x.id), ['keep', 'new']);
  f.session.search('q', [() => new Promise(() => {})]);
  assert.deepEqual(f.state.items.map(x => x.id), ['keep', 'new']); f.session.clear();
});

test('TTL expires and LRU evicts within the session; successful empty matches cache, no-source searches do not', async t => {
  const f = fixture(t), provider = () => Promise.resolve([]);
  f.session.search('empty', [provider]); await flush(t);
  f.session.search('empty', [provider]); assert.equal(f.state.cached, true); await flush(t);
  await advance(t, SEARCH_CACHE_TTL_MS);
  f.session.search('empty', [provider]); assert.equal(f.state.cached, false); await flush(t);
  for (let i = 0; i < 12; i++) { f.session.search('q'+i, [provider]); await flush(t); }
  f.session.search('q0', [provider]); assert.equal(f.state.cached, true); await flush(t);
  f.session.search('new', [provider]); await flush(t);
  f.session.search('q1', [provider]); assert.equal(f.state.cached, false); await flush(t);
  f.session.search('none', []); assert.equal(f.state.total, 0);
  f.session.search('none', [provider]); assert.equal(f.state.cached, false); f.session.clear();
});

test('cache bounds include item and character budgets, not only query count', async t => {
  const f = fixture(t);
  f.session.search('large', [() => Promise.resolve(Array.from({length:1201},(_,i) => item(''+i)))]); await flush(t);
  f.session.search('large', [() => Promise.resolve([])]); assert.equal(f.state.cached, false); await flush(t);
  f.session.search('huge', [() => Promise.resolve([{...item('huge'),description:'x'.repeat(1_000_001)}])]); await flush(t);
  f.session.search('huge', [() => Promise.resolve([])]); assert.equal(f.state.cached, false); await flush(t);
  for (const q of ['a','b','c']) { f.session.search(q, [() => Promise.resolve(Array.from({length:500},(_,i) => item(q+i)))]); await flush(t); }
  f.session.search('a', [() => Promise.resolve([])]); assert.equal(f.state.cached, false); f.session.clear();
});

test('account/profile/PIN identity changes clear cached previews and pending work', async t => {
  const f = fixture(t);
  const identities = [['user-a',1,null],['user-a',2,null],['user-a',2,2],['user-b',2,2],null];
  for (let i=0;i<identities.length;i++) {
    f.session.setIdentity(JSON.stringify(identities[i]));
    f.session.search('q',[()=>Promise.resolve([item('private-preview')])]); await flush(t);
    f.session.setIdentity(JSON.stringify(identities[(i+1)%identities.length]));
    f.session.search('q',[()=>new Promise(()=>{})]);
    assert.equal(f.state.cached,false); assert.deepEqual(f.state.items,[]); f.session.clear();
  }
});

test('failed refresh does not replace or renew the last complete snapshot', async t => {
  const f = fixture(t);
  f.session.search('q',[()=>Promise.resolve([item('complete')])]); await flush(t);
  f.session.search('q',[()=>Promise.resolve([item('partial')]),()=>Promise.reject(new Error('unavailable'))]); await flush(t);
  f.session.search('q',[()=>new Promise(()=>{})]); assert.deepEqual(f.state.items.map(x=>x.id),['complete']);
  f.session.clear(); await advance(t,SEARCH_CACHE_TTL_MS);
  f.session.search('q',[()=>new Promise(()=>{})]); assert.equal(f.state.cached,false); f.session.clear();
});

test('scope changes cancel an already queued publication before it can update UI or cache', async t => {
  const f = fixture(t);
  f.session.search('q',[()=>Promise.resolve([item('old-scope')])]); await drain();
  f.session.setIdentity('new-scope'); const writes=f.states.length;
  await advance(t,SEARCH_BATCH_MS);
  assert.equal(f.states.length,writes); assert.deepEqual(f.state.items,[]);
  f.session.setIdentity('account/profile/sources');
  f.session.search('q',[()=>new Promise(()=>{})]);
  assert.equal(f.state.cached,false); f.session.clear();
});

test('late success after its hard deadline cannot change UI or cache', async t => {
  const f=fixture(t);
  f.session.search('q',[delay(9000,[item('too-late')]),()=>Promise.resolve([item('ready')])]);
  await flush(t); await advance(t,SEARCH_DEADLINE_MS);
  assert.equal(f.state.timedOut,1); const writes=f.states.length;
  await advance(t,1000); assert.equal(f.states.length,writes);
  assert.deepEqual(f.state.items.map(x=>x.id),['ready']);
  f.session.search('q',[()=>new Promise(()=>{})]); assert.equal(f.state.cached,false); f.session.clear();
});

test('source refresh bursts cancel immediately, preserve previews and rerun the submitted query once', async t => {
  const f=fixture(t), queries=[], signals=[];
  f.session.configure('identity','v1',q=>[()=>Promise.resolve([item(q)])]);
  f.session.search('submitted'); await flush(t);
  f.session.search('submitted',[s=>{signals.push(s);return new Promise(()=>{});}]); await drain();
  const load=q=>[()=>{queries.push(q);return Promise.resolve([item('fresh')]);}];
  assert.equal(f.session.configure('identity','v2',load),'sources');
  assert.equal(signals[0].aborted,true);
  assert.deepEqual(f.state.items.map(x=>x.id),['submitted']); assert.equal(f.state.queued,true);
  await advance(t,200);
  f.session.configure('identity','v3',load);
  t.mock.timers.tick(SEARCH_SOURCE_DEBOUNCE_MS-1); await drain(); assert.deepEqual(queries,[]);
  await advance(t,1);
  assert.deepEqual(queries,['submitted']); assert.deepEqual(f.state.items.map(x=>x.id),['fresh']);
  f.session.search('submitted',[()=>new Promise(()=>{})]);
  assert.equal(f.state.cached,true); f.session.clear();
});

test('old configuration cache is discarded, and clear/new submissions/identity changes cancel queued reruns', async t => {
  const f=fixture(t);let calls=0;
  const targets=q=>[()=>{calls++;return Promise.resolve([item(q)]);}];
  f.session.configure('identity','v1',targets); f.session.search('first'); await flush(t);
  f.session.configure('identity','v2',targets);
  f.session.search('first'); assert.equal(f.state.cached,false); assert.equal(f.state.items[0].id,'first');
  await flush(t); await advance(t,SEARCH_SOURCE_DEBOUNCE_MS); assert.equal(calls,2);
  f.session.configure('identity','v3',targets); f.session.clear();
  await advance(t,SEARCH_SOURCE_DEBOUNCE_MS); assert.equal(calls,2); assert.deepEqual(f.state.items,[]);
  f.session.search('first');await flush(t);
  f.session.configure('identity','v4',targets); f.session.search('second');await flush(t);
  await advance(t,SEARCH_SOURCE_DEBOUNCE_MS); assert.equal(f.state.items[0].id,'second');assert.equal(calls,4);
  f.session.configure('identity','v5',targets);
  assert.equal(f.session.configure('different-user','v5',targets),'identity');
  await advance(t,SEARCH_SOURCE_DEBOUNCE_MS);assert.equal(calls,4);assert.deepEqual(f.state.items,[]);
});

test('an empty source set still preserves submitted intent until restored targets arrive', async t => {
  const f=fixture(t);
  f.session.configure('identity','empty',()=>[]); f.session.search('deep-link');
  assert.equal(f.state.total,0);
  f.session.configure('identity','restored',q=>[()=>Promise.resolve([item(q)])]);
  await advance(t,SEARCH_SOURCE_DEBOUNCE_MS);
  assert.equal(f.state.items[0].id,'deep-link');
});

test('source configuration fingerprints include manifest metadata and enablement without changing identity', () => {
  const addon={manifestUrl:'https://addon.test/manifest.json',manifest:{id:'test',name:'Test',version:'1',types:['movie'],resources:['catalog'],catalogs:[{id:'all',type:'movie',name:'All',extra:[{name:'search'}]}]}};
  const initial=searchSources([addon]);
  for(const change of [{...addon,disabledFeatures:['catalog']},{...addon,manifest:{...addon.manifest,version:'2'}},{...addon,manifest:{...addon.manifest,catalogs:[]}}]) assert.notEqual(searchSources([change]),initial);
});


test('temporarily unavailable source configuration preserves previews and submitted intent until recovery', async t => {
  const f=fixture(t);
  f.session.configure('identity','v1',q=>[()=>Promise.resolve([item(q)])]);
  f.session.search('submitted');await flush(t);
  f.session.configure('identity','unavailable',()=>[]);await advance(t,SEARCH_SOURCE_DEBOUNCE_MS);
  assert.equal(f.state.total,0);assert.equal(f.state.items[0].id,'submitted');
  f.session.configure('identity','recovered',q=>[()=>Promise.resolve([item('fresh-'+q)])]);await advance(t,SEARCH_SOURCE_DEBOUNCE_MS);
  assert.deepEqual(f.state.items.map(x=>x.id),['fresh-submitted']);
});

test('an old interaction reconciliation cannot publish after a privacy boundary', async t => {
  const f=fixture(t);
  f.session.search('q',[()=>Promise.resolve([item('stale'),item('keep')])]);await flush(t);
  f.session.protectThrough(0);
  f.session.search('q',[()=>Promise.resolve([item('keep')])]);await flush(t);
  f.session.protectThrough(null);
  f.session.setIdentity('another-user');const writes=f.states.length;
  await advance(t,SEARCH_INTERACTION_SETTLE_MS);
  assert.equal(f.states.length,writes);assert.deepEqual(f.state.items,[]);
});
