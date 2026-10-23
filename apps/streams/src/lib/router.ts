import type { MediaType } from './types';
import type { NavigationMotion } from './screen-transition';

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
  | { kind: 'tab'; tab: Tab; query?: string; panel?: 'accounts' | 'addons' | 'integrations' }
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
      && ['accounts', 'addons', 'integrations'].includes(parts[1])))) {
      return { kind: 'tab', tab: parts[0] as Tab, query: parts[0] === 'search' ? url.searchParams.get('q') || undefined : undefined,
        panel: parts[1] as 'accounts' | 'addons' | 'integrations' | undefined };
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

const HOME_HASH = routeHash({ kind: 'tab', tab: 'home' });

/** A bottom-tab destination, as opposed to a screen pushed on top of a tab. */
export function isRootTab(route: AppRoute): route is { kind: 'tab'; tab: Tab; query?: string } {
  return route.kind === 'tab' && !route.panel;
}

// pushState gives Gecko, Safari, and browser Back the same navigation stack.
// Hash routes also work when the site is hosted without an SPA rewrite rule.
export class HashRouter {
  private lastHash: string;
  private requestedBack = false;
  private traversal: (() => void) | null = null;
  private previousScrollRestoration: ScrollRestoration;
  private onHistory = () => {
    if (this.traversal) {
      // An internal history.go() towards the root: settle it without showing intermediate screens.
      this.lastHash = window.location.hash;
      const settle = this.traversal;
      this.traversal = null;
      settle();
      return;
    }
    if (window.location.hash === this.lastHash) return; // popstate + hashchange can describe the same traversal.
    this.lastHash = window.location.hash;
    const motion = this.requestedBack ? 'back' : 'history';
    this.requestedBack = false;
    this.changed(parseRoute(this.lastHash), motion);
  };

  constructor(private changed: (route: AppRoute, motion: NavigationMotion) => void) {
    this.lastHash = window.location.hash;
    this.previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    window.addEventListener('popstate', this.onHistory);
    window.addEventListener('hashchange', this.onHistory);
    const initial = parseRoute(this.lastHash);
    this.replace(initial);
    // A fresh link straight into Search, Library or Settings gets Home beneath it, so Back
    // goes Home before leaving the app, as with native bottom tabs.
    if (isRootTab(initial) && initial.tab !== 'home' && this.state().depth === 0) {
      history.replaceState({ streamsRouter: 1, depth: 0 } satisfies RouteState, '', HOME_HASH);
      history.pushState({ streamsRouter: 1, depth: 1, parent: HOME_HASH } satisfies RouteState, '', this.lastHash);
    }
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
    this.changed(route, 'push');
  }

  replace(route: AppRoute) {
    this.lastHash = routeHash(route);
    history.replaceState(this.state(), '', this.lastHash);
  }

  /**
   * Switch bottom tabs like a native app: tab changes never stack history. The stack below
   * a tab is at most [Home, tab], so Back from any tab returns Home and Back from Home leaves.
   * Screens pushed above the current tab are dropped.
   */
  async selectRootTab(route: AppRoute) {
    const hash = routeHash(route);
    if (hash === window.location.hash) return;
    const { depth } = this.state();
    const home = hash === HOME_HASH;
    if (depth === 0 && window.location.hash === HOME_HASH) {
      if (!home) this.push(route);
      return;
    }
    if (depth > 0) {
      const target = home ? 0 : 1;
      if (depth > target) await this.traverse(target - depth);
      // Entry 1 is a root tab only when the entry below it is Home; otherwise rebuild.
      if (!home && this.state().parent !== HOME_HASH) await this.traverse(-this.state().depth);
    }
    if (this.state().depth === 0) {
      history.replaceState({ streamsRouter: 1, depth: 0 } satisfies RouteState, '', HOME_HASH);
      this.lastHash = HOME_HASH;
      if (!home) history.pushState({ streamsRouter: 1, depth: 1, parent: HOME_HASH } satisfies RouteState, '', hash);
    } else history.replaceState({ streamsRouter: 1, depth: 1, parent: HOME_HASH } satisfies RouteState, '', hash);
    this.lastHash = hash;
    this.changed(route, home ? 'back' : 'push');
  }

  private traverse(delta: number): Promise<void> {
    if (!delta) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; window.clearTimeout(timer); resolve(); } };
      this.traversal = finish;
      // Some engines skip popstate for a cross-document-free traversal; never hang navigation.
      const timer = window.setTimeout(() => { if (this.traversal === finish) this.traversal = null; finish(); }, 500);
      history.go(delta);
    });
  }

  back(fallback: AppRoute) {
    if (this.state().depth > 0) { this.requestedBack = true; history.back(); }
    else { this.replace(fallback); this.changed(fallback, 'back'); }
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
