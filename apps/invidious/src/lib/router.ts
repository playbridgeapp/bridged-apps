export type Tab = 'home' | 'subscriptions' | 'library' | 'settings';

export type Route =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'search'; query: string }
  | { kind: 'watch'; id: string; list?: string }
  | { kind: 'channel'; id: string }
  | { kind: 'playlist'; id: string };

const TABS = new Set<Tab>(['home', 'subscriptions', 'library', 'settings']);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRoute(hash: string): Route {
  let url: URL;
  try {
    url = new URL(hash.replace(/^#/, '') || '/', 'https://routes.invalid');
  } catch {
    return { kind: 'tab', tab: 'home' };
  }
  const [head, value] = url.pathname.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return ''; }
  });
  if (!head) return { kind: 'tab', tab: 'home' };
  if (TABS.has(head as Tab)) return { kind: 'tab', tab: head as Tab };
  if (head === 'search') return { kind: 'search', query: (url.searchParams.get('q') || '').slice(0, 200) };
  if (head === 'watch' && value && ID.test(value)) {
    const list = url.searchParams.get('list');
    return { kind: 'watch', id: value, ...(list && ID.test(list) ? { list } : {}) };
  }
  if (head === 'channel' && value && ID.test(value)) return { kind: 'channel', id: value };
  if (head === 'playlist' && value && ID.test(value)) return { kind: 'playlist', id: value };
  return { kind: 'tab', tab: 'home' };
}

export function routeHash(route: Route): string {
  switch (route.kind) {
    case 'tab': return route.tab === 'home' ? '#/' : `#/${route.tab}`;
    case 'search': return `#/search?q=${encodeURIComponent(route.query)}`;
    case 'watch': return `#/watch/${encodeURIComponent(route.id)}${route.list ? `?list=${encodeURIComponent(route.list)}` : ''}`;
    case 'channel': return `#/channel/${encodeURIComponent(route.id)}`;
    case 'playlist': return `#/playlist/${encodeURIComponent(route.id)}`;
  }
}

/** How many app pages sit above the entry the app opened on, kept in each history entry. */
function depth(): number {
  const value = (history.state as { appDepth?: unknown } | null)?.appDepth;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function showHash(hash: string): void {
  history.replaceState({ appDepth: 0 }, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/**
 * Home rewinds to the entry the app opened on instead of adding one, so Back
 * from Home leaves the app (to the PlayBridge dashboard in a bridged-app session).
 */
function goHome(): void {
  const home = routeHash({ kind: 'tab', tab: 'home' });
  const steps = depth();
  if (!steps) {
    if (location.hash !== home && location.hash !== '') showHash(home);
    return;
  }
  // The opening entry may be another page (a shared link); show Home there.
  window.addEventListener('popstate', () => {
    if (location.hash !== home && location.hash !== '') showHash(home);
  }, { once: true });
  history.go(-steps);
}

export function navigate(route: Route): void {
  if (route.kind === 'tab' && route.tab === 'home') { goHome(); return; }
  const hash = routeHash(route);
  if (location.hash === hash) return;
  const next = depth() + 1;
  history.pushState({ appDepth: next }, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Swaps the current page's address without adding a history entry. */
export function replaceRoute(route: Route): void {
  history.replaceState(history.state, '', routeHash(route));
}

let autoplayId: string | null = null;

/** Opens the next video after the page's player finishes one, and starts it as soon as it loads. */
export function openVideo(id: string, list?: string): void {
  autoplayId = id;
  navigate({ kind: 'watch', id, ...(list ? { list } : {}) });
}

/** True once for the video [openVideo] asked to start. */
export function takeAutoplay(id: string): boolean {
  const start = autoplayId === id;
  if (start) autoplayId = null;
  return start;
}

/** A pasted link: a page this app can open directly, or a channel name the instance must resolve. */
export type LinkTarget = { route: Route } | { resolve: string };

/**
 * Reads a YouTube or Invidious link (videos, Shorts, youtu.be, playlists,
 * channels). Plain search text returns null.
 */
export function linkTarget(text: string): LinkTarget | null {
  const value = text.trim();
  if (!/^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(value) && !/^https?:\/\//i.test(value)) return null;
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { return null; }
  const parts = url.pathname.split('/').filter(Boolean);
  const list = url.searchParams.get('list') || undefined;
  const watch = (id: string | null | undefined): LinkTarget | null =>
    id && ID.test(id) ? { route: { kind: 'watch', id, ...(list && ID.test(list) ? { list } : {}) } } : null;
  if (url.hostname.toLowerCase().replace(/^www\./, '') === 'youtu.be') return watch(parts[0]);
  const [head, second] = parts;
  if (head === 'watch') return watch(url.searchParams.get('v'));
  if (['shorts', 'live', 'embed', 'v'].includes(head)) return watch(second);
  if (head === 'playlist') return list && ID.test(list) ? { route: { kind: 'playlist', id: list } } : null;
  if (head === 'channel' && second && ID.test(second)) return { route: { kind: 'channel', id: second } };
  if (head?.startsWith('@') || head === 'c' || head === 'user') return { resolve: `https://www.youtube.com/${parts.slice(0, head.startsWith('@') ? 1 : 2).join('/')}` };
  return null;
}
