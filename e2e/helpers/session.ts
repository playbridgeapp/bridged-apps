export type LiveSession = {
  id: string;
  url: string;
  token: string;
  userId: string;
  username: string;
  serverName: string;
  isDemo: false;
  connected: true;
  lastActive: number;
};

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Returns a SavedAccount-shaped session, or null if required env is missing. */
export function liveSessionFromEnv(): LiveSession | null {
  return sessionFrom(
    process.env.JELLYFIN_URL,
    process.env.JELLYFIN_TOKEN,
    process.env.JELLYFIN_USER_ID,
    process.env.JELLYFIN_USERNAME,
    process.env.JELLYFIN_SERVER_NAME
  );
}

function sessionFrom(
  url?: string,
  token?: string,
  userId?: string,
  username?: string,
  serverName?: string
): LiveSession | null {
  const trimmedUrl = url?.trim();
  const trimmedToken = token?.trim();
  const trimmedUserId = userId?.trim();
  if (!trimmedUrl || !trimmedToken || !trimmedUserId) return null;
  const cleanUrl = trimSlash(trimmedUrl);
  return {
    id: `${cleanUrl}_${trimmedUserId}`,
    url: cleanUrl,
    token: trimmedToken,
    userId: trimmedUserId,
    username: username?.trim() || 'admin',
    serverName: serverName?.trim() || 'Jellyfin',
    isDemo: false,
    connected: true,
    lastActive: Date.now()
  };
}

/** Second live server for switch-account tests (`JELLYFIN_B_*`). */
export function liveSessionBFromEnv(): LiveSession | null {
  return sessionFrom(
    process.env.JELLYFIN_B_URL,
    process.env.JELLYFIN_B_TOKEN,
    process.env.JELLYFIN_B_USER_ID,
    process.env.JELLYFIN_B_USERNAME,
    process.env.JELLYFIN_B_SERVER_NAME
  );
}
