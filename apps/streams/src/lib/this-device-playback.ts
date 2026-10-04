export type PlayerOpeningOrientation = 'auto' | 'portrait' | 'landscape';
export interface ThisDevicePlaybackPreferences {
  useNativePlayer: boolean;
  initialOrientation: PlayerOpeningOrientation;
}
const key = 'bridged-streams.this-device-playback';
const defaults: ThisDevicePlaybackPreferences = { useNativePlayer: true, initialOrientation: 'landscape' };
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function normalizeThisDevicePlayback(value: unknown): ThisDevicePlaybackPreferences {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    useNativePlayer: typeof source.useNativePlayer === 'boolean' ? source.useNativePlayer : defaults.useNativePlayer,
    initialOrientation: typeof source.initialOrientation === 'string' && ['auto', 'portrait', 'landscape'].includes(source.initialOrientation)
      ? source.initialOrientation as PlayerOpeningOrientation : defaults.initialOrientation
  };
}
export function loadThisDevicePlayback(storage?: PreferenceStorage): ThisDevicePlaybackPreferences {
  try { return normalizeThisDevicePlayback(JSON.parse((storage ?? localStorage).getItem(key) || 'null')); }
  catch { return { ...defaults }; }
}
export function saveThisDevicePlayback(value: ThisDevicePlaybackPreferences, storage?: PreferenceStorage): void {
  try { (storage ?? localStorage).setItem(key, JSON.stringify(normalizeThisDevicePlayback(value))); }
  catch { /* Playback remains usable if site storage is unavailable. */ }
}
export function playbackOpeningOrientation(destinationId: string, supported: boolean,
  preferences: ThisDevicePlaybackPreferences): PlayerOpeningOrientation | undefined {
  return destinationId === 'this-device' && supported && preferences.useNativePlayer ? preferences.initialOrientation : undefined;
}
