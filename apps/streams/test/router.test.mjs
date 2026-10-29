import test from 'node:test';
import assert from 'node:assert/strict';
import { HashRouter, isRootTab, parseRoute, routeHash } from '../src/lib/router.ts';

const tab = (name, query) => ({ kind: 'tab', tab: name, ...(query ? { query } : {}) });
const detail = { kind: 'detail', type: 'movie', id: 'tt-router' };

function browser(t, hash = '#/', historyEvents = true) {
  const originalWindow = globalThis.window;
  const originalHistory = globalThis.history;
  const events = new EventTarget();
  const entries = [{ hash, state: null }];
  let index = 0;
  const location = { hash };
  const history = {
    scrollRestoration: 'auto',
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    replaceState(state, _, hash) { entries[index] = { state, hash }; location.hash = hash; },
    pushState(state, _, hash) { entries.splice(++index, entries.length, { state, hash }); location.hash = hash; },
    go(delta) {
      setTimeout(() => {
        index += delta;
        assert.ok(index >= 0 && index < entries.length);
        location.hash = entries[index].hash;
        if (historyEvents) {
          events.dispatchEvent(new Event('popstate'));
          events.dispatchEvent(new Event('hashchange'));
        }
      }, 0);
    },
    back() { this.go(-1); }
  };
  globalThis.window = { location, addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events) };
  globalThis.history = history;
  const changes = [];
  const router = new HashRouter((route, motion) => changes.push({ route, motion }));
  t.after(() => { router.destroy(); globalThis.window = originalWindow; globalThis.history = originalHistory; });
  return { router, history, location, changes, tick: () => new Promise(resolve => setTimeout(resolve, 5)) };
}

test('tab URLs normalize to the base while legacy inbound links still parse', () => {
  for (const name of ['home', 'search', 'library', 'settings']) assert.equal(routeHash(tab(name, 'film')), '#/');
  assert.deepEqual(parseRoute('#/search?q=film'), { kind: 'tab', tab: 'search', query: 'film', panel: undefined });
  for (const panel of ['accounts', 'addons', 'playback', 'integrations']) {
    const route = { kind: 'tab', tab: 'settings', panel };
    assert.equal(routeHash(route), `#/settings/${panel}`);
    assert.equal(isRootTab(route), false);
    assert.equal(parseRoute(routeHash(route)).panel, panel);
  }
  for (const kind of ['detail', 'streams', 'player']) {
    const route = { ...detail, kind, videoId: 'episode:1', season: 1, episode: 2 };
    assert.deepEqual(parseRoute(routeHash(route)), route);
  }
  const catalog = { kind: 'catalog', addonId: 'addon', type: 'movie', id: 'films' };
  assert.deepEqual(parseRoute(routeHash(catalog)), catalog);
});

test('all tabs use one entry and search replacements stay in memory', async t => {
  const { router, history, location, changes } = browser(t);
  for (const name of ['library', 'search', 'settings', 'home', 'search']) {
    await router.selectRootTab(tab(name));
    assert.equal(history.length, 1);
    assert.equal(history.state.depth, 0);
    assert.equal(location.hash, '#/');
    assert.equal(changes.at(-1).route.tab, name);
  }
  router.replace(tab('search', 'film'));
  assert.equal(location.hash, '#/');
  assert.equal(history.length, 1);
  router.push(detail);
  router.back(tab('home'));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(changes.at(-1), { route: tab('search', 'film'), motion: 'back' });
});

for (const [hash, name] of [['#/library', 'library'], ['#/settings', 'settings'], ['#/search?q=film', 'search']]) {
  test(`legacy ${name} entry normalizes without injecting Home`, t => {
    const { history, location } = browser(t, hash);
    assert.equal(history.length, 1);
    assert.equal(history.state.depth, 0);
    assert.equal(location.hash, '#/');
  });
}

test('Back and Forward preserve the originating Library tab beneath pushed screens', async t => {
  const { router, history, changes, tick } = browser(t);
  await router.selectRootTab(tab('library'));
  router.push(detail);
  router.push({ ...detail, kind: 'streams' });
  router.back(detail); await tick();
  assert.equal(changes.at(-1).route.kind, 'detail');
  router.back(tab('home')); await tick();
  assert.equal(changes.at(-1).route.tab, 'library');
  history.go(1); await tick();
  assert.equal(changes.at(-1).route.kind, 'detail');
  history.back(); await tick();
  assert.equal(changes.at(-1).route.tab, 'library');
});

test('Settings panel Back returns to Settings even when opened from Home', async t => {
  const { router, changes, history, tick } = browser(t);
  router.push({ kind: 'tab', tab: 'settings', panel: 'addons' });
  assert.equal(history.state.depth, 1);
  router.back(tab('settings')); await tick();
  assert.equal(changes.at(-1).route.tab, 'settings');
  assert.equal(changes.at(-1).route.panel, undefined);
});

test('a cold Settings panel has a base entry that returns to Settings', async t => {
  const { router, history, location, changes, tick } = browser(t, '#/settings/addons');
  assert.equal(history.length, 2);
  assert.equal(location.hash, '#/settings/addons');
  router.back(tab('settings')); await tick();
  assert.equal(location.hash, '#/');
  assert.equal(changes.at(-1).route.tab, 'settings');
});

test('rapid tab selection drops the entire pushed stack and the latest selection wins', async t => {
  const { router, history, location, changes } = browser(t);
  await router.selectRootTab(tab('library'));
  router.push(detail);
  router.push({ ...detail, kind: 'streams' });
  const count = changes.length;
  await Promise.all([router.selectRootTab(tab('search')), router.selectRootTab(tab('settings'))]);
  assert.equal(history.state.depth, 0);
  assert.equal(location.hash, '#/');
  assert.equal(changes.length, count + 1);
  assert.equal(changes.at(-1).route.tab, 'settings');
  router.push(detail);
  assert.equal(history.length, 2); // The old forward stack is replaced by the new pushed screen.
});

test('closing a cold title uses the in-memory fallback tab', t => {
  const { router, location, changes } = browser(t, '#/movie/tt-router');
  router.back(tab('library'));
  assert.equal(location.hash, '#/');
  assert.equal(changes.at(-1).route.tab, 'library');
});

test('a missing history traversal times out without resetting depth or freezing later tab taps', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { router, history, location, changes } = browser(t);
  t.mock.method(history, 'go', () => {});
  router.push(detail);
  const count = changes.length;
  const selection = router.selectRootTab(tab('search'));
  t.mock.timers.tick(499);
  assert.equal(changes.length, count);
  t.mock.timers.tick(1);
  await selection;
  assert.equal(location.hash, '#/');
  assert.equal(history.state.depth, 1);
  assert.equal(changes.length, count + 1);
  assert.equal(changes.at(-1).route.tab, 'search');

  const next = router.selectRootTab(tab('settings'));
  t.mock.timers.tick(500);
  await next;
  assert.equal(changes.length, count + 2);
  assert.equal(changes.at(-1).route.tab, 'settings');
  assert.equal(history.state.depth, 1);
});

test('a traversal without history events still settles at the base after the timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { router, history, location, changes } = browser(t, '#/', false);
  router.push(detail);
  const count = changes.length;
  const selection = router.selectRootTab(tab('search'));
  t.mock.timers.tick(500);
  await selection;
  assert.equal(location.hash, '#/');
  assert.equal(history.state.depth, 0);
  assert.equal(changes.length, count + 1);
  assert.equal(changes.at(-1).route.tab, 'search');
  await router.selectRootTab(tab('settings'));
  assert.equal(changes.length, count + 2);
  assert.equal(changes.at(-1).route.tab, 'settings');
});

test('late history events after a timeout do not apply the tab selection twice', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { router, history, location, changes } = browser(t);
  const go = history.go.bind(history);
  t.mock.method(history, 'go', () => {});
  router.push(detail);
  const count = changes.length;
  const selection = router.selectRootTab(tab('search'));
  t.mock.timers.tick(500);
  await selection;
  assert.equal(history.state.depth, 1);
  assert.equal(changes.length, count + 1);

  go(-1);
  t.mock.timers.tick(0);
  assert.equal(location.hash, '#/');
  assert.equal(history.state.depth, 0);
  assert.equal(changes.length, count + 1);
  assert.equal(changes.at(-1).route.tab, 'search');
  await router.selectRootTab(tab('settings'));
  assert.equal(changes.length, count + 2);
  assert.equal(changes.at(-1).route.tab, 'settings');
});

test('addon-declared content types have links; reserved and path-like types do not', () => {
  for (const type of ['Tube', 'JAV', 'Live', 'Porn']) {
    const route = { kind: 'detail', type, id: 'tbl:abc 1', videoId: undefined, season: undefined, episode: undefined };
    assert.equal(routeHash(route), `#/${type}/tbl%3Aabc%201`);
    assert.deepEqual(parseRoute(routeHash(route)), route);
  }
  assert.deepEqual(parseRoute('#/Live%20TV/ch1/streams'), { kind: 'streams', type: 'Live TV', id: 'ch1', videoId: undefined, season: undefined, episode: undefined });
  for (const hash of ['#/settings/x', '#/Search/abc', '#/../abc', '#/%2Fetc/abc']) assert.equal(parseRoute(hash).kind === 'detail', false, hash);
});

test('opening Back consumes only its transient entry and player replacement returns to detail', async t => {
  const { router, history, changes, tick } = browser(t);
  router.push(detail);
  let cancelled = 0;
  router.beginTransient(() => cancelled++);
  history.back(); await tick();
  assert.equal(cancelled, 1);
  assert.equal(changes.at(-1).route.kind, 'detail');
  router.beginTransient(() => cancelled++);
  router.replaceTransient({ ...detail, kind: 'player' });
  assert.equal(changes.at(-1).route.kind, 'player');
  history.back(); await tick();
  assert.equal(changes.at(-1).route.kind, 'detail');
  assert.equal(cancelled, 1);
});
