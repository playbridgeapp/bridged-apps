import type { NuvioProfile, NuvioSession } from './nuvio';

const KEY = 'bridged-streams.nuvio-startup-authorization.v1';
export const STARTUP_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;
// Display permission lasts as long as the cache it unlocks; background validation runs at once
// and hides everything if the profile gained a PIN, was deleted or the session was revoked.
export const AUTHORIZATION_MAX_AGE_MS = STARTUP_CACHE_MAX_AGE_MS;
export type StartupAuthorization = { backend: string; user: string; profile: number; protected: boolean; checkedAt: number };

/** A recent successful profile check is display permission only, never write/PIN authority. */
export function eligibleStartupAuthorization(session: NuvioSession, profile: number, value: unknown, now = Date.now()): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as StartupAuthorization;
  // An expired access token is routine (it lasts about an hour); validation refreshes it first.
  return Number.isSafeInteger(profile) && profile > 0 && !!session.refreshToken?.trim()
    && record.backend === session.backendUrl && record.user === session.user.id && record.profile === profile
    && record.protected === false && Number.isFinite(record.checkedAt)
    && record.checkedAt <= now && now - record.checkedAt < AUTHORIZATION_MAX_AGE_MS;
}

export function nuvioStartupLeaseMs(session: NuvioSession, profile: number): number {
  try {
    const record = JSON.parse(localStorage.getItem(KEY) || 'null') as StartupAuthorization;
    const now = Date.now();
    return eligibleStartupAuthorization(session, profile, record, now)
      ? record.checkedAt + AUTHORIZATION_MAX_AGE_MS - now : 0;
  } catch { return 0; }
}

export function cachedNuvioAuthorization(session: NuvioSession, profile: number): boolean {
  return nuvioStartupLeaseMs(session, profile) > 0;
}

/** True only when this exact profile was PIN-protected at its last check. */
export function knownProtectedNuvioProfile(session: NuvioSession, profile: number): boolean {
  try {
    const record = JSON.parse(localStorage.getItem(KEY) || 'null') as StartupAuthorization | null;
    return !!record && record.backend === session.backendUrl && record.user === session.user.id
      && record.profile === profile && record.protected !== false;
  } catch { return false; }
}

export function saveNuvioAuthorization(session: NuvioSession, profile: NuvioProfile, checkedAt = Date.now()): void {
  const record: StartupAuthorization = { backend: session.backendUrl, user: session.user.id,
    profile: profile.profile_index, protected: profile.pin_enabled === true, checkedAt };
  try { localStorage.setItem(KEY, JSON.stringify(record)); } catch { /* A cache is optional. */ }
}

export function clearNuvioAuthorization(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
