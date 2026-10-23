import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupMetadata } from '../src/lib/metadata-lookup.ts';
const meta = (name, id = 'tt1') => ({ id, type: 'movie', name });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const provider = (delay, value) => () => new Promise(resolve => setTimeout(() => resolve(value), delay));

test('ready fallback waits only a 300 ms priority grace', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let value;
  const result = lookupMetadata([provider(1800, null), provider(100, meta('fallback'))]).then(v => { value = v; });
  await flush(); t.mock.timers.tick(100); await flush();
  t.mock.timers.tick(299); await flush(); assert.equal(value, undefined);
  t.mock.timers.tick(1); await flush(); assert.equal(value.name, 'fallback');
  await result;
});

test('priority response within grace wins immediately', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = lookupMetadata([provider(200, meta('priority')), provider(100, meta('fallback'))]);
  await flush(); t.mock.timers.tick(200); await flush();
  assert.equal((await result).name, 'priority');
});

test('deadline aborts even a provider that ignores cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const result = lookupMetadata([s => { signal = s; return new Promise(() => {}); }]);
  await flush(); t.mock.timers.tick(8000); await flush();
  assert.equal(await result, null); assert.equal(signal.aborted, true);
});

test('late priority result upgrades fields without changing identity', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const updates = [];
  const result = lookupMetadata([provider(900, { ...meta('priority'), description: 'Better data' }), provider(100, meta('fallback'))], undefined, v => updates.push(v));
  await flush(); t.mock.timers.tick(100); await flush(); t.mock.timers.tick(300); await flush();
  assert.equal((await result).name, 'fallback');
  t.mock.timers.tick(500); await flush();
  assert.equal(updates[0].description, 'Better data'); assert.equal(updates[0].id, 'tt1');
});

test('navigation cancels late updates and pre-aborted lookups', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(), updates = [];
  const result = lookupMetadata([provider(900, meta('late')), provider(100, meta('fallback'))], controller.signal, v => updates.push(v));
  await flush(); t.mock.timers.tick(100); await flush(); t.mock.timers.tick(300); await flush(); await result;
  controller.abort(); t.mock.timers.tick(1000); await flush(); assert.deepEqual(updates, []);
  await assert.rejects(lookupMetadata([provider(1, meta('stale'))], controller.signal), { name: 'AbortError' });
});

test('foreign identity cannot replace the winning title', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const updates = [];
  const result = lookupMetadata([provider(900, meta('foreign', 'tt2')), provider(100, meta('fallback'))], undefined, v => updates.push(v));
  await flush(); t.mock.timers.tick(100); await flush(); t.mock.timers.tick(300); await flush(); await result;
  t.mock.timers.tick(500); await flush(); assert.deepEqual(updates, []);
});

test('leaving before the first result rejects and aborts every request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(), signals = [], updates = [];
  const providers = [100, 900].map(delay => signal => {
    signals.push(signal);
    return provider(delay, meta('stale'))();
  });
  const result = lookupMetadata(providers, controller.signal, value => updates.push(value));
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await flush(); controller.abort(); await rejected;
  assert.ok(signals.every(signal => signal.aborted));
  t.mock.timers.tick(10000); await flush();
  assert.deepEqual(updates, []);
});
