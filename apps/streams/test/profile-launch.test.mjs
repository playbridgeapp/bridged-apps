import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedNuvioProfiles, chosenInThisTab, profileAvatarImage, profileColor, profileGateRequired, profileInkColor, rememberChosenInThisTab, saveNuvioProfilesForDisplay, savedProfileLaunchMode, saveProfileLaunchMode } from '../src/lib/profile-launch.ts';

const storage = () => { const store = new Map(); return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }; };
globalThis.localStorage = storage();
globalThis.sessionStorage = storage();
const session = { backendUrl: 'https://cloud.test', publishableKey: 'k', accessToken: 'a', refreshToken: 'r', expiresAt: 0, user: { id: 'user-a', email: 'a@example.invalid' } };
const open = { profile_index: 1, name: 'Main' };
const kids = { profile_index: 2, name: 'Kids' };
const locked = { profile_index: 3, name: 'Locked', pin_enabled: true };
const gate = (patch) => profileGateRequired({ profiles: [open, kids, locked], activeIndex: 1, unlockedIndex: null, mode: 'ask', chosenInThisTab: false, ...patch });

test('a PIN profile always asks until it is unlocked in this page, whatever the launch mode', () => {
  for (const mode of ['ask', 'remember']) {
    assert.equal(gate({ mode, activeIndex: 3, chosenInThisTab: true }), true);
    assert.equal(gate({ mode, activeIndex: 3, unlockedIndex: 3 }), false);
    assert.equal(profileGateRequired({ profiles: [locked], activeIndex: 3, unlockedIndex: null, mode, chosenInThisTab: true }), true);
  }
});

test('an unlocked profile asks on a new visit in ask mode, but not after a same-tab reload or in remember mode', () => {
  assert.equal(gate({}), true);
  assert.equal(gate({ chosenInThisTab: true }), false);
  assert.equal(gate({ mode: 'remember' }), false);
});

test('a lone unlocked profile, or no profiles, never shows the picker; a missing profile always does', () => {
  assert.equal(profileGateRequired({ profiles: [open], activeIndex: 1, unlockedIndex: null, mode: 'ask', chosenInThisTab: false }), false);
  assert.equal(profileGateRequired({ profiles: [], activeIndex: 1, unlockedIndex: null, mode: 'ask', chosenInThisTab: false }), false);
  assert.equal(gate({ activeIndex: 0, mode: 'remember', chosenInThisTab: true }), true);
  assert.equal(gate({ activeIndex: 9, mode: 'remember' }), true);
});

test('launch mode defaults to asking, and the tab choice is scoped to the account and profile', () => {
  assert.equal(savedProfileLaunchMode(), 'ask');
  saveProfileLaunchMode('remember');
  assert.equal(savedProfileLaunchMode(), 'remember');
  rememberChosenInThisTab(session, 2);
  assert.equal(chosenInThisTab(session, 2), true);
  assert.equal(chosenInThisTab(session, 1), false);
  assert.equal(chosenInThisTab({ ...session, user: { id: 'user-b', email: '' } }, 2), false);
  rememberChosenInThisTab(null, null);
  assert.equal(chosenInThisTab(session, 2), false);
});

test('the display cache keeps names, colours and locks only, for the same account', () => {
  saveNuvioProfilesForDisplay(session, [{ ...locked, avatar_color_hex: '#FB8C00', uses_primary_addons: true, secret: 'x' }]);
  assert.deepEqual(cachedNuvioProfiles(session), [{ profile_index: 3, name: 'Locked', pin_enabled: true, avatar_color_hex: '#FB8C00' }]);
  assert.deepEqual(cachedNuvioProfiles({ ...session, backendUrl: 'https://other.test' }), []);
  saveNuvioProfilesForDisplay(null);
  assert.deepEqual(cachedNuvioProfiles(session), []);
});

test('avatars use the custom URL, then the public catalog image, then colour and initial', () => {
  const catalog = [{ id: 'fox', storage_path: 'animals/fox one.png' }];
  assert.equal(profileAvatarImage({ ...open, avatar_url: ' https://img.test/a.png ', avatar_id: 'fox' }, catalog, 'https://cloud.test/'), 'https://img.test/a.png');
  assert.equal(profileAvatarImage({ ...open, avatar_id: 'fox' }, catalog, 'https://cloud.test/'), 'https://cloud.test/storage/v1/object/public/avatars/animals/fox%20one.png');
  assert.equal(profileAvatarImage({ ...open, avatar_url: 'javascript:alert(1)', avatar_id: 'missing' }, catalog, 'https://cloud.test'), null);
  assert.equal(profileColor({ avatar_color_hex: 'red' }), '#1E88E5');
  assert.equal(profileInkColor('#FB8C00'), '#0b0d10');
  assert.equal(profileInkColor('#8E24AA'), '#ffffff');
});
