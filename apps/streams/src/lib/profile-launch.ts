import type { NuvioProfile, NuvioSession } from './nuvio.ts';

/** Nuvio's "Remember last profile" setting; Nuvio defaults to asking on every launch. */
export type ProfileLaunchMode = 'ask' | 'remember';
export type PinResult = { ok: true } | { ok: false; message: string; retryAfterSeconds?: number };

const MODE_KEY = 'bridged-streams.profile-launch.v1';
// sessionStorage survives a reload of the same tab and ends with the tab, like an app process.
const CHOSEN_KEY = 'bridged-streams.nuvio-profile-chosen.v1';
const PROFILES_KEY = 'bridged-streams.nuvio-profiles.v1';
const DEFAULT_AVATAR_COLOR = '#1E88E5';

export function savedProfileLaunchMode(): ProfileLaunchMode {
  try { return localStorage.getItem(MODE_KEY) === 'remember' ? 'remember' : 'ask'; } catch { return 'ask'; }
}

export function saveProfileLaunchMode(mode: ProfileLaunchMode): void {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage unavailable */ }
}

type ChosenProfile = { backend: string; user: string; index: number };

/** True when this tab already entered this profile; a reload keeps it, a new tab asks again. */
export function chosenInThisTab(session: NuvioSession, index: number): boolean {
  try {
    const value = JSON.parse(sessionStorage.getItem(CHOSEN_KEY) || 'null') as ChosenProfile | null;
    return !!value && value.backend === session.backendUrl && value.user === session.user.id && value.index === index;
  } catch { return false; }
}

export function rememberChosenInThisTab(session: NuvioSession | null, index: number | null): void {
  try {
    if (!session || index === null) sessionStorage.removeItem(CHOSEN_KEY);
    else sessionStorage.setItem(CHOSEN_KEY, JSON.stringify({ backend: session.backendUrl, user: session.user.id, index } satisfies ChosenProfile));
  } catch { /* storage unavailable */ }
}

export type ProfileGateInput = {
  profiles: NuvioProfile[];
  activeIndex: number;
  unlockedIndex: number | null;
  mode: ProfileLaunchMode;
  chosenInThisTab: boolean;
};

/**
 * Mirrors Nuvio's AppGate: a remembered profile opens directly only without a PIN, a lone
 * unlocked profile never asks, and everything else goes through "Who's watching?".
 */
export function profileGateRequired({ profiles, activeIndex, unlockedIndex, mode, chosenInThisTab }: ProfileGateInput): boolean {
  if (!profiles.length) return false;
  const active = profiles.find((profile) => profile.profile_index === activeIndex);
  if (!active) return true;
  if (active.pin_enabled) return unlockedIndex !== activeIndex;
  if (profiles.length === 1) return false;
  return mode === 'ask' && !chosenInThisTab;
}

type DisplayProfile = Pick<NuvioProfile, 'profile_index' | 'name' | 'pin_enabled' | 'avatar_color_hex'>;
type CachedProfiles = { backend: string; user: string; profiles: DisplayProfile[] };

/** Names, colours and lock state only, so the picker can paint before profiles are validated. */
export function cachedNuvioProfiles(session: NuvioSession): NuvioProfile[] {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILES_KEY) || 'null') as CachedProfiles | null;
    if (!value || value.backend !== session.backendUrl || value.user !== session.user.id || !Array.isArray(value.profiles)) return [];
    return value.profiles.filter((profile) => profile && Number.isInteger(profile.profile_index) && typeof profile.name === 'string');
  } catch { return []; }
}

export function saveNuvioProfilesForDisplay(session: NuvioSession | null, profiles: NuvioProfile[] = []): void {
  try {
    if (!session) { localStorage.removeItem(PROFILES_KEY); return; }
    const value: CachedProfiles = { backend: session.backendUrl, user: session.user.id, profiles: profiles.map((profile) => ({
      profile_index: profile.profile_index, name: profile.name, pin_enabled: profile.pin_enabled === true,
      avatar_color_hex: profile.avatar_color_hex
    })) };
    localStorage.setItem(PROFILES_KEY, JSON.stringify(value));
  } catch { /* storage unavailable */ }
}

export function profileColor(profile: Pick<NuvioProfile, 'avatar_color_hex'>): string {
  const hex = profile.avatar_color_hex?.trim();
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_AVATAR_COLOR;
}

/** Dark text on light avatar colours, white on dark ones, whichever contrasts more. */
export function profileInkColor(background: string): string {
  const channel = (offset: number) => {
    const value = parseInt(background.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#0b0d10' : '#ffffff';
}
