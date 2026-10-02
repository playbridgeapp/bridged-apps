import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePluginHeaders } from '../src/lib/plugin-headers.ts';

test('Castle-style headers keep playback requirements and omit client-controlled headers', () => {
  const input = { 'User-Agent': 'Mozilla/5.0', Accept: 'video/*', 'Accept-Language': 'en-US',
    'Accept-Encoding': 'gzip, deflate', Connection: 'keep-alive', 'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Site': 'cross-site', DNT: '1',
    Referer: 'https://provider.test/', Origin: 'https://provider.test', Authorization: 'Bearer test-token', Cookie: 'session=test' };
  assert.deepEqual(normalizePluginHeaders(input), { 'User-Agent': 'Mozilla/5.0', Accept: 'video/*', 'Accept-Language': 'en-US',
    Referer: 'https://provider.test/', Origin: 'https://provider.test', Authorization: 'Bearer test-token', Cookie: 'session=test' });
  assert.equal(input.Connection, 'keep-alive');
});

test('normalization is case insensitive and retains unknown application headers for eligibility checks', () => {
  assert.deepEqual(normalizePluginHeaders({ 'aCcEpT-EnCoDiNg': 'gzip', 'sEc-Fetch-Mode': 'cors', 'X-Provider-Token': 'required' }),
    { 'X-Provider-Token': 'required' });
  assert.equal(normalizePluginHeaders({ Connection: 'close' }), undefined);
  assert.equal(normalizePluginHeaders({}), undefined);
  assert.equal(normalizePluginHeaders(undefined), undefined);
});

test('malformed headers are rejected without including credentials in the error', () => {
  for (const headers of ['bad', [], { Authorization: 42 }, { 'bad name': 'test' }, { Cookie: 'secret\r\ninjected: value' }, { Connection: 'bad\nvalue' }]) {
    assert.throws(() => normalizePluginHeaders(headers), { message: 'Scraper returned invalid playback headers.' });
  }
});
