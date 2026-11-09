const TOKEN_KEY = 'bridged-invidious.token.v1';

/** What the app asks the instance for: the subscription feed, subscriptions, watch history and playlists. */
export const TOKEN_SCOPES = ['GET:feed', ':subscriptions*', ':history*', ':playlists*', 'POST:tokens/unregister'];
const TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

export interface StoredToken {
  instance: string;
  /** The token exactly as the instance issued it; sent as the Bearer value. */
  token: string;
  session: string;
}

/** The instance page where the user signs in and approves the app. */
export function authorizeUrl(instance: string, callbackUrl: string): string {
  const params = new URLSearchParams({
    scopes: TOKEN_SCOPES.join(','),
    callback_url: callbackUrl,
    expire: String(TOKEN_LIFETIME_SECONDS)
  });
  return `${instance}/authorize_token?${params}`;
}

/** The session id inside an issued token, or null when the value isn't a token. */
export function tokenSession(token: string): string | null {
  try {
    const value: unknown = JSON.parse(token);
    const session = (value as { session?: unknown })?.session;
    return typeof session === 'string' && session.length > 0 && session.length < 512 ? session : null;
  } catch {
    return null;
  }
}

/** Reads a token the instance appended to the callback URL. */
export function tokenFromCallback(search: string): string | null {
  const token = new URLSearchParams(search).get('token');
  return token && token.length < 8192 && tokenSession(token) ? token : null;
}

export function loadToken(instance: string): StoredToken | null {
  try {
    const value = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null') as StoredToken | null;
    return value && value.instance === instance && tokenSession(value.token) ? value : null;
  } catch {
    return null;
  }
}

export function saveToken(instance: string, token: string): StoredToken | null {
  const session = tokenSession(token);
  if (!session) return null;
  const stored = { instance, token, session };
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(stored)); } catch { return null; }
  return stored;
}

export function clearToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* Storage may be unavailable. */ }
}

export const TOKEN_STORAGE_KEY = TOKEN_KEY;
