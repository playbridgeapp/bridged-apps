import type { MediaType } from './types';

export type Tab = 'home' | 'search' | 'library' | 'settings';
export type MediaRoute = {
  kind: 'detail' | 'streams' | 'player';
  type: MediaType;
  id: string;
  videoId?: string;
  season?: number;
  episode?: number;
};
export type AppRoute = MediaRoute
  | { kind: 'tab'; tab: Tab; query?: string; panel?: 'accounts' | 'addons' }
  | { kind: 'catalog'; addonId: string; type: string; id: string };

const tabs = new Set(['home', 'search', 'library', 'settings']);
const mediaTypes = new Set(['movie', 'series', 'sport', 'library']);

function coordinate(value: string | null): number | undefined {
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

export function parseRoute(hash: string): AppRoute {
  try {
    const url = new URL(hash.replace(/^#/, '') || '/', 'https://routes.invalid');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return { kind: 'tab', tab: 'home' };
    if (parts[0] === 'catalog' && parts.length === 4) {
      return { kind: 'catalog', addonId: parts[1], type: parts[2], id: parts[3] };
    }
    if (mediaTypes.has(parts[0]) && parts.length >= 2 && parts.length <= 3
      && (!parts[2] || ['streams', 'player'].includes(parts[2]))) {
      return { kind: parts[2] === 'player' ? 'player' : parts[2] === 'streams' ? 'streams' : 'detail',
        type: parts[0] as MediaType, id: parts[1], videoId: url.searchParams.get('video') || undefined,
        season: coordinate(url.searchParams.get('season')), episode: coordinate(url.searchParams.get('episode')) };
    }
    if (tabs.has(parts[0]) && (parts.length === 1 || (parts[0] === 'settings' && parts.length === 2
      && ['accounts', 'addons'].includes(parts[1])))) {
      return { kind: 'tab', tab: parts[0] as Tab, query: parts[0] === 'search' ? url.searchParams.get('q') || undefined : undefined,
        panel: parts[1] as 'accounts' | 'addons' | undefined };
    }
  } catch { /* Malformed links return to Home. */ }
  return { kind: 'tab', tab: 'home' };
}

export function routeHash(route: AppRoute): string {
  const params = new URLSearchParams();
  let path: string;
  if (route.kind === 'tab') {
    path = route.tab === 'home' ? '/' : `/${route.tab}${route.panel ? `/${route.panel}` : ''}`;
    if (route.tab === 'search' && route.query) params.set('q', route.query);
  } else if (route.kind === 'catalog') {
    path = `/catalog/${[route.addonId, route.type, route.id].map(encodeURIComponent).join('/')}`;
  } else {
    path = `/${route.type}/${encodeURIComponent(route.id)}${route.kind === 'detail' ? '' : `/${route.kind}`}`;
    if (route.videoId) params.set('video', route.videoId);
    if (route.season !== undefined) params.set('season', String(route.season));
    if (route.episode !== undefined) params.set('episode', String(route.episode));
  }
  return `#${path}${params.size ? `?${params}` : ''}`;
}

type RouteState = { streamsRouter: 1; depth: number; parent?: string };

// pushState gives Gecko, Safari, and browser Back the same navigation stack.
// Hash routes also work when the site is hosted without an SPA rewrite rule.
export class HashRouter {
  private lastHash: string;
  private previousScrollRestoration: ScrollRestoration;
  private onHistory = () => {
    if (window.location.hash === this.lastHash) return; // popstate + hashchange can describe the same traversal.
    this.lastHash = window.location.hash;
    this.changed(parseRoute(this.lastHash));
  };

  constructor(private changed: (route: AppRoute) => void) {
    this.lastHash = window.location.hash;
    this.previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    window.addEventListener('popstate', this.onHistory);
    window.addEventListener('hashchange', this.onHistory);
    this.replace(parseRoute(this.lastHash));
  }

  private state(): RouteState {
    const state = history.state as Partial<RouteState> | null;
    return state?.streamsRouter === 1 && Number.isSafeInteger(state.depth) && state.depth! >= 0
      ? state as RouteState : { streamsRouter: 1, depth: 0 };
  }

  push(route: AppRoute) {
    const hash = routeHash(route);
    if (hash === window.location.hash) return;
    const state: RouteState = { streamsRouter: 1, depth: this.state().depth + 1, parent: window.location.hash };
    history.pushState(state, '', hash);
    this.lastHash = hash;
    this.changed(route);
  }

  replace(route: AppRoute) {
    this.lastHash = routeHash(route);
    history.replaceState(this.state(), '', this.lastHash);
  }

  back(fallback: AppRoute) {
    if (this.state().depth > 0) history.back();
    else { this.replace(fallback); this.changed(fallback); }
  }

  parent(): AppRoute | null {
    const parent = this.state().parent;
    return parent ? parseRoute(parent) : null;
  }

  destroy() {
    window.removeEventListener('popstate', this.onHistory);
    window.removeEventListener('hashchange', this.onHistory);
    history.scrollRestoration = this.previousScrollRestoration;
  }
}
