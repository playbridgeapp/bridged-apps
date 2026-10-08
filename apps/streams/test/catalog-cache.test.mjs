import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const counts = { get: 0, set: 0, remove: 0 };
globalThis.localStorage = {
  getItem: (k) => { counts.get++; return store.has(k) ? store.get(k) : null; },
  setItem: (k, v) => { counts.set++; store.set(k, String(v)); },
  removeItem: (k) => { counts.remove++; store.delete(k); }
};
const { cachedCatalog, saveCatalogCache, clearCatalogCache, flushCatalogCache } = await import('../src/lib/catalog-cache.ts');
const KEY = 'bridged-streams.catalog-cache.v1';
const item = (n) => ({ id: `id${n}`, name: `Name ${n}`, type: 'movie' });

test('multiple saves coalesce into one write', async () => {
  clearCatalogCache();
  counts.set = 0;
  saveCatalogCache('a', [item(1)]);
  saveCatalogCache('b', [item(2)]);
  saveCatalogCache('c', [item(3)]);
  assert.equal(counts.set, 0);
  assert.equal(cachedCatalog('b')[0].id, 'id2');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(counts.set, 1);
  assert.deepEqual(Object.keys(JSON.parse(store.get(KEY))).sort(), ['a', 'b', 'c']);
  flushCatalogCache();
  assert.equal(counts.set, 1);
});

test('flush writes pending data immediately', () => {
  clearCatalogCache();
  counts.set = 0;
  saveCatalogCache('x', [item(9)]);
  flushCatalogCache();
  assert.equal(counts.set, 1);
  assert.equal(JSON.parse(store.get(KEY)).x.items[0].id, 'id9');
});

test('clear removes memory, pending write and stored key', async () => {
  saveCatalogCache('y', [item(1)]);
  counts.set = 0;
  clearCatalogCache();
  assert.deepEqual(cachedCatalog('y'), []);
  assert.equal(store.has(KEY), false);
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(counts.set, 0);
});

test('rows and items are trimmed', () => {
  clearCatalogCache();
  for (let i = 0; i < 30; i++) saveCatalogCache(`k${i}`, Array.from({ length: 40 }, (_, n) => item(n)));
  flushCatalogCache();
  const saved = JSON.parse(store.get(KEY));
  assert.equal(Object.keys(saved).length, 24);
  assert.ok(Object.values(saved).every((row) => row.items.length === 24));
});

test('lazy parse reads storage once across many calls', async () => {
  // fresh module instance to reset memory
  store.set(KEY, JSON.stringify({ a: { items: [item(1)], savedAt: 1 } }));
  const fresh = await import('../src/lib/catalog-cache.ts?fresh');
  counts.get = 0;
  for (let i = 0; i < 10; i++) assert.equal(fresh.cachedCatalog('a').length, 1);
  assert.equal(counts.get, 1);
});
