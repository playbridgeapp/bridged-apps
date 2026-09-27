/** Keep account sessions for the site origin across browser and app restarts. */
export function readPersistentSession<T>(key: string, valid: (value: unknown) => value is T): T | null {
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try {
      const raw = window[kind].getItem(key);
      if (!raw) continue;
      const value: unknown = JSON.parse(raw);
      if (!valid(value)) continue;
      if (kind === 'sessionStorage') writePersistentSession(key, value);
      return value;
    } catch { /* unavailable storage or invalid saved data */ }
  }
  return null;
}

export function writePersistentSession<T>(key: string, value: T | null): void {
  if (value === null) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
    try { sessionStorage.removeItem(key); } catch { /* storage unavailable */ }
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.removeItem(key);
  } catch {
    // Retain the current-tab session when persistent storage is unavailable.
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }
}
